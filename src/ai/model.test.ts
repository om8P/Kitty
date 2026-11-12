/**
 * S28: the Groq model seam on `groq-sdk`. Every call goes through a fake
 * `fetch`, so nothing reaches the network.
 */
import { describe, expect, it } from "vitest";
import { createGroqModel, parseDuration, type UsageBudget } from "./model";

const ok = { choices: [{ finish_reason: "stop", message: { content: "hi" } }], usage: { total_tokens: 321 } };

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fake fetch that answers from a list and records each request body. */
function scripted(responses: Array<Response | (() => Response)>) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return typeof next === "function" ? next() : next;
  };
  return { fetch: fetch as typeof globalThis.fetch, bodies };
}

const key = { GROQ_API_KEY: "test-key" };
const messages = [{ role: "user" as const, content: "hello" }];

describe("Groq model seam", () => {
  it("sends the model, token cap and tools, and no reasoning effort unless asked", async () => {
    const net = scripted([reply(ok), reply(ok)]);
    const model = createGroqModel(key, { fetch: net.fetch });

    await model.chat({
      messages,
      maxTokens: 700,
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }],
    });
    expect(net.bodies[0]).toMatchObject({
      model: "openai/gpt-oss-120b",
      max_completion_tokens: 700,
      tool_choice: "auto",
      tools: [{ type: "function", function: { name: "t" } }],
    });
    expect(net.bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(net.bodies[0]).not.toHaveProperty("response_format");

    await model.chat({ messages, reasoningEffort: "low" });
    expect(net.bodies[1]).toMatchObject({ reasoning_effort: "low" });
    expect(net.bodies[1]).not.toHaveProperty("tools");
  });

  it("asks for strict JSON-schema output when given a schema", async () => {
    const net = scripted([reply(ok)]);
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
    await createGroqModel(key, { fetch: net.fetch }).chat({ messages, jsonSchema: { name: "answer", schema } });
    expect(net.bodies[0].response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", schema, strict: true },
    });
  });

  it("returns content, tool calls and the finish reason", async () => {
    const net = scripted([
      reply({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: "{}" } }],
            },
          },
        ],
      }),
    ]);
    expect(await createGroqModel(key, { fetch: net.fetch }).chat({ messages })).toEqual({
      ok: true,
      content: "",
      toolCalls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: "{}" } }],
      finishReason: "tool_calls",
    });
  });

  it("counts the tokens each call used against the daily budget", async () => {
    const recorded: number[] = [];
    const budget: UsageBudget = { allow: async () => true, record: async (tokens) => void recorded.push(tokens) };
    const net = scripted([reply(ok)]);
    await createGroqModel(key, { fetch: net.fetch, budget }).chat({ messages });
    expect(recorded).toEqual([321]);
  });

  it("refuses without calling Groq once the daily budget is used up", async () => {
    const net = scripted([reply(ok)]);
    const budget: UsageBudget = { allow: async () => false, record: async () => undefined };
    expect(await createGroqModel(key, { fetch: net.fetch, budget }).chat({ messages })).toEqual({
      ok: false,
      reason: "quota",
    });
    expect(net.bodies).toHaveLength(0);
  });

  describe("pacing from Groq's rate-limit headers", () => {
    const limited = { "x-ratelimit-remaining-tokens": "200", "x-ratelimit-reset-tokens": "4.5s" };

    it("waits for the token window to refill when the next call wouldn't fit", async () => {
      const waits: number[] = [];
      const net = scripted([reply(ok, 200, limited), reply(ok)]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async (ms) => void waits.push(ms), now: () => 1_000 });
      await model.chat({ messages });
      expect(await model.chat({ messages })).toMatchObject({ ok: true });
      expect(waits).toEqual([4_500]);
    });

    it("doesn't wait when the call fits", async () => {
      const waits: number[] = [];
      const roomy = { "x-ratelimit-remaining-tokens": "7000", "x-ratelimit-reset-tokens": "4.5s" };
      const net = scripted([reply(ok, 200, roomy), reply(ok)]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async (ms) => void waits.push(ms), now: () => 1_000 });
      await model.chat({ messages });
      await model.chat({ messages });
      expect(waits).toEqual([]);
    });

    it("fails as rate_limited, without calling Groq, when the window is too far off", async () => {
      const net = scripted([
        reply(ok, 200, { "x-ratelimit-remaining-tokens": "10", "x-ratelimit-reset-tokens": "45s" }),
        reply(ok),
      ]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async () => undefined, now: () => 1_000 });
      await model.chat({ messages });
      expect(await model.chat({ messages })).toEqual({ ok: false, reason: "rate_limited" });
      expect(net.bodies).toHaveLength(1);
    });

    it("waits out a longer window when the call allows it, as agent turns do (S49)", async () => {
      const waits: number[] = [];
      const net = scripted([
        reply(ok, 200, { "x-ratelimit-remaining-tokens": "10", "x-ratelimit-reset-tokens": "45s" }),
        reply(ok),
      ]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async (ms) => void waits.push(ms), now: () => 1_000 });
      await model.chat({ messages });
      expect(await model.chat({ messages, maxWaitMs: 61_000 })).toMatchObject({ ok: true });
      expect(waits).toEqual([45_000]);
    });
  });

  describe("rate limits", () => {
    it("waits the longer of retry-after and the token reset, then retries once", async () => {
      const waits: number[] = [];
      const net = scripted([
        reply({ error: { message: "secret org detail" } }, 429, { "retry-after": "1", "x-ratelimit-reset-tokens": "6s" }),
        reply(ok),
      ]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async (ms) => void waits.push(ms) });
      expect(await model.chat({ messages })).toMatchObject({ ok: true, content: "hi" });
      expect(waits).toEqual([6_000]);
    });

    it("gives up after a second 429, and never passes Groq's message on", async () => {
      const waits: number[] = [];
      const limited = () =>
        reply({ error: { message: "Rate limit reached for organization org_secret123" } }, 429, { "retry-after": "1" });
      const net = scripted([limited, limited]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async (ms) => void waits.push(ms) });
      const result = await model.chat({ messages });
      expect(result).toEqual({ ok: false, reason: "rate_limited" });
      expect(JSON.stringify(result)).not.toContain("org_");
      expect(waits).toEqual([1_250]);
    });

    it("doesn't wait out a long retry-after", async () => {
      const waits: number[] = [];
      const net = scripted([reply({}, 429, { "retry-after": "90" })]);
      const model = createGroqModel(key, { fetch: net.fetch, sleep: async (ms) => void waits.push(ms) });
      expect(await model.chat({ messages })).toEqual({ ok: false, reason: "rate_limited" });
      expect(waits).toEqual([]);
    });
  });

  describe("every other failure is typed", () => {
    it("times out", async () => {
      const fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof globalThis.fetch;
      const model = createGroqModel(key, { fetch, timeoutMs: 20 });
      expect(await model.chat({ messages })).toEqual({ ok: false, reason: "timeout" });
    });

    const dropped = () => {
      throw new TypeError("fetch failed");
    };
    it.each([
      ["a server error", () => reply({ error: {} }, 500), "error"],
      ["a refused request", () => reply({ error: {} }, 400), "error"],
      ["a bad key", () => reply({ error: {} }, 401), "error"],
      ["a dropped connection", dropped, "error"],
      ["an answer with no choices", () => reply({ choices: [] }), "invalid_response"],
      ["a body that isn't JSON", () => reply("<html>oops</html>"), "invalid_response"],
      ["a body with the wrong content type", () => new Response(JSON.stringify(ok), { status: 200 }), "invalid_response"],
    ])("on %s", async (_name, respond, reason) => {
      const net = scripted([respond]);
      expect(await createGroqModel(key, { fetch: net.fetch }).chat({ messages })).toEqual({ ok: false, reason });
    });

    it("reports not_configured with no key, and never calls Groq", async () => {
      const net = scripted([reply(ok)]);
      const model = createGroqModel({}, { fetch: net.fetch });
      expect(model.configured).toBe(false);
      expect(await model.chat({ messages })).toEqual({ ok: false, reason: "not_configured" });
      expect(net.bodies).toHaveLength(0);
    });
  });

  it("makes one call at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const fetch = (async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return reply(ok);
    }) as typeof globalThis.fetch;
    const model = createGroqModel(key, { fetch });
    await Promise.all([model.chat({ messages }), model.chat({ messages }), model.chat({ messages })]);
    expect(most).toBe(1);
  });
});

describe("parseDuration", () => {
  it.each([
    ["42.72s", 42_720],
    ["27m21.6s", 1_641_600],
    ["1h2m", 3_720_000],
    ["250ms", 250],
    ["2s", 2_000],
  ])("reads %s", (value, ms) => {
    expect(parseDuration(value)).toBe(ms);
  });

  it.each([null, "", "soon", "5x", "12"])("rejects %s", (value) => {
    expect(parseDuration(value)).toBeNull();
  });
});
