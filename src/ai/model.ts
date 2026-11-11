/**
 * The model seam: all Groq knowledge lives here (architecture 3, ADR-0005).
 *
 * Groq speaks the OpenAI chat format, so this is a small `fetch` wrapper.
 * It makes one call at a time across the app, waits once on a rate limit, and
 * reports every problem as a failure. It never decides a purchase.
 */
import { z } from "zod";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const TIMEOUT_MS = 45_000;
const MAX_RETRY_WAIT_MS = 20_000;

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
  /** Ask for a single JSON object as the reply. */
  json?: boolean;
  maxTokens?: number;
};

export type ChatResult =
  | { ok: true; content: string; toolCalls: ToolCall[]; finishReason: string }
  | { ok: false; reason: "not_configured" | "rate_limited" | "quota" | "timeout" | "error" | "invalid_response" };

export interface Model {
  readonly configured: boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
}

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
});

type Env = Record<string, string | undefined>;

export function createGroqModel(
  env: Env = process.env,
  options: {
    fetch?: typeof fetch;
    /** Returns false once the daily budget is used up. */
    allow?: () => Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Model {
  const apiKey = env.GROQ_API_KEY?.trim();
  const model = env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // One call at a time keeps a burst of purchases under the per-minute token limit.
  let queue: Promise<unknown> = Promise.resolve();

  async function send(request: ChatRequest): Promise<ChatResult> {
    if (!apiKey) return { ok: false, reason: "not_configured" };
    if (options.allow && !(await options.allow())) return { ok: false, reason: "quota" };

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: 0.2,
      max_completion_tokens: request.maxTokens ?? 1024,
    };
    if (request.tools) {
      body.tools = request.tools;
      body.tool_choice = "auto";
    }
    if (request.json) body.response_format = { type: "json_object" };
    // The open-weight reasoning models think before answering. Keep that short.
    if (model.includes("gpt-oss")) body.reasoning_effort = "low";

    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(GROQ_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "error" };
      }

      if (response.status === 429) {
        const wait = retryDelayMs(response.headers.get("retry-after"));
        if (attempt === 0 && wait !== null && wait <= MAX_RETRY_WAIT_MS) {
          await sleep(wait);
          continue;
        }
        return { ok: false, reason: "rate_limited" };
      }
      if (!response.ok) return { ok: false, reason: "error" };

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { ok: false, reason: "invalid_response" };
      }
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) return { ok: false, reason: "invalid_response" };
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
    configured: Boolean(apiKey),
    chat(request) {
      const run = queue.then(() => send(request));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

function retryDelayMs(header: string | null): number | null {
  if (!header) return 2_000;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1000) + 250;
}
