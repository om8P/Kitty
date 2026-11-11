/**
 * The model seam: all Groq knowledge lives here (architecture 3, ADR-0005,
 * ADR-0009). It calls Groq through the `groq-sdk` package.
 *
 * Settings from the S10 trial (`docs/spike/S10.md`):
 * - The SDK never retries (`maxRetries: 0`). This seam owns pacing and retries.
 * - Pacing reads Groq's `x-ratelimit-*` headers. A call that wouldn't fit in
 *   the tokens left this minute waits for the window to refill, if that is
 *   short, or fails as `rate_limited`. A 429 waits once, then fails.
 * - Groq error messages contain the organization ID, so none is ever logged
 *   or returned. Failures are typed reasons only.
 *
 * It makes one call at a time across the app and never decides a purchase.
 */
import Groq from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { z } from "zod";

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const TIMEOUT_MS = 45_000;
/** The longest the seam waits for Groq's per-minute window before failing instead. */
const MAX_WAIT_MS = 20_000;
/** Extra tokens assumed on top of the estimate, because Groq counts more than `usage` reports (S10). */
const ESTIMATE_MARGIN_TOKENS = 300;

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Strict JSON-schema output. Groq can't combine it with tools. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** Leave unset for the model's default. Agent turns use `low`, reviews the default (S10). */
  reasoningEffort?: "low" | "medium" | "high";
};

export type ChatResult =
  | { ok: true; content: string; toolCalls: ToolCall[]; finishReason: string }
  | { ok: false; reason: "not_configured" | "rate_limited" | "quota" | "timeout" | "error" | "invalid_response" };

export interface Model {
  readonly configured: boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** Daily limits that survive a restart. See `./budget.ts`. */
export type UsageBudget = {
  /** Counts one request. Returns false once a daily cap is reached. */
  allow(): Promise<boolean>;
  /** Adds the tokens a finished call used. */
  record(tokens: number): Promise<void>;
};

const responseSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        finish_reason: z.string().nullable().optional(),
        message: z.looseObject({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.looseObject({
                id: z.string(),
                function: z.looseObject({ name: z.string(), arguments: z.string() }),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.looseObject({ total_tokens: z.number() }).nullable().optional(),
});

type Env = Record<string, string | undefined>;

export function createGroqModel(
  env: Env = process.env,
  options: {
    fetch?: typeof fetch;
    budget?: UsageBudget;
    /** Returns false once the daily budget is used up. Used when there is no full budget. */
    allow?: () => Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Model {
  const apiKey = env.GROQ_API_KEY?.trim();
  const model = env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const budget = options.budget;
  const allow = budget ? () => budget.allow() : options.allow;

  const client = apiKey
    ? new Groq({
        apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs ?? TIMEOUT_MS,
        logLevel: "off",
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : null;

  /** What the last response said about this minute's token window. */
  let window: { remaining: number; resetsAt: number } | null = null;

  // One call at a time keeps a burst of purchases under the per-minute token limit.
  let queue: Promise<unknown> = Promise.resolve();

  async function send(request: ChatRequest): Promise<ChatResult> {
    if (!client) return { ok: false, reason: "not_configured" };
    if (allow && !(await allow())) return { ok: false, reason: "quota" };

    const maxTokens = request.maxTokens ?? 1024;
    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: request.messages as ChatCompletionCreateParamsNonStreaming["messages"],
      temperature: 0.2,
      max_completion_tokens: maxTokens,
    };
    if (request.tools) {
      params.tools = request.tools;
      params.tool_choice = "auto";
    }
    if (request.jsonSchema) {
      params.response_format = {
        type: "json_schema",
        json_schema: { name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: true },
      };
    }
    if (request.reasoningEffort) params.reasoning_effort = request.reasoningEffort;

    // Pace: if the call wouldn't fit in this minute's window, wait for it to refill.
    const estimate = estimateTokens(request) + maxTokens + ESTIMATE_MARGIN_TOKENS;
    if (window && window.remaining < estimate && window.resetsAt > now()) {
      const wait = window.resetsAt - now();
      if (wait > MAX_WAIT_MS) return { ok: false, reason: "rate_limited" };
      await sleep(wait);
      window = null;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      let data: unknown;
      try {
        const result = await client.chat.completions.create(params).withResponse();
        window = readWindow(result.response.headers, now());
        data = result.data;
      } catch (error) {
        if (error instanceof Groq.RateLimitError) {
          window = readWindow(error.headers, now());
          const wait = retryWaitMs(error.headers);
          if (attempt === 0 && wait !== null && wait <= MAX_WAIT_MS) {
            await sleep(wait);
            window = null;
            continue;
          }
          return { ok: false, reason: "rate_limited" };
        }
        if (error instanceof Groq.APIConnectionTimeoutError) return { ok: false, reason: "timeout" };
        // A body the SDK couldn't read as JSON.
        if (error instanceof SyntaxError) return { ok: false, reason: "invalid_response" };
        return { ok: false, reason: "error" };
      }

      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) return { ok: false, reason: "invalid_response" };
      const tokens = parsed.data.usage?.total_tokens;
      if (budget && tokens) await budget.record(tokens).catch(() => undefined);

      const choice = parsed.data.choices[0];
      return {
        ok: true,
        content: choice.message.content ?? "",
        toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.function.name, arguments: call.function.arguments },
        })),
        finishReason: choice.finish_reason ?? "",
      };
    }
    return { ok: false, reason: "rate_limited" };
  }

  return {
    configured: Boolean(client),
    chat(request) {
      const run = queue.then(() => send(request));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** About 4 characters a token, over everything sent. */
function estimateTokens(request: ChatRequest): number {
  const size = JSON.stringify(request.messages).length + (request.tools ? JSON.stringify(request.tools).length : 0);
  return Math.ceil(size / 4);
}

function readWindow(headers: Headers | undefined, at: number): { remaining: number; resetsAt: number } | null {
  const remainingHeader = headers?.get("x-ratelimit-remaining-tokens");
  const reset = parseDuration(headers?.get("x-ratelimit-reset-tokens") ?? null);
  if (remainingHeader == null || reset === null) return null;
  const remaining = Number(remainingHeader);
  if (!Number.isFinite(remaining)) return null;
  return { remaining, resetsAt: at + reset };
}

/**
 * How long to wait after a 429: the longer of `retry-after` and the token
 * window's reset, because `retry-after` alone wasn't enough in S10.
 */
function retryWaitMs(headers: Headers | undefined): number | null {
  const header = headers?.get("retry-after") ?? null;
  let wait: number;
  if (!header) {
    wait = 2_000;
  } else {
    const seconds = Number(header);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    wait = Math.ceil(seconds * 1000) + 250;
  }
  const reset = parseDuration(headers?.get("x-ratelimit-reset-tokens") ?? null);
  return reset === null ? wait : Math.max(wait, reset);
}

/** Parses Groq's reset durations, such as `42.72s`, `27m21.6s`, `1h2m` or `250ms`, to milliseconds. */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  let total = 0;
  let consumed = 0;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const amount = Number(match[1]);
    const unit = match[2];
    total += unit === "h" ? amount * 3_600_000 : unit === "m" ? amount * 60_000 : unit === "s" ? amount * 1000 : amount;
    consumed += match[0].length;
  }
  if (consumed === 0 || consumed !== value.trim().length) return null;
  return Math.ceil(total);
}
