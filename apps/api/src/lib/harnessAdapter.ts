import type { ChatMessage, HarnessConfig, SystemState } from "../types.js";

type AdapterRequest = {
  harness: HarnessConfig;
  message: string;
  history: ChatMessage[];
  state: SystemState;
  signal?: AbortSignal;
};

export type AdapterMeta = {
  model: string;
  provider: string;
  fallbackUsed: boolean;
  elapsedMs: number;
  tokenUsage: {
    input: number;
    output: number;
  };
};

export type AdapterResult = {
  content: string;
  meta: AdapterMeta;
};

export type StreamChunk =
  | { type: "meta"; meta: AdapterMeta }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

type AttemptResult = {
  content: string;
  provider: string;
};

const REQUEST_TIMEOUT_MS = 35000;

export async function invokeHarness(input: AdapterRequest): Promise<AdapterResult> {
  const startedAt = Date.now();
  const { harness, message, history, state, signal } = input;
  const models = uniqueModels([state.router9.defaultModel, ...state.router9.fallbackOrder]);

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const attempt = await tryHarnessEndpoints({
      harness,
      message,
      history,
      state,
      model,
      signal,
    });

    if (!attempt) {
      continue;
    }

    return {
      content: attempt.content,
      meta: {
        model,
        provider: attempt.provider,
        fallbackUsed: index > 0,
        elapsedMs: Date.now() - startedAt,
        tokenUsage: {
          input: estimateTokens(message),
          output: estimateTokens(attempt.content),
        },
      },
    };
  }

  const fallback = [
    `Harness ${harness.name} is currently unreachable.`,
    "",
    "All adapter endpoints failed; this local fallback keeps the workflow moving.",
    `Prompt echo: ${message}`,
  ].join("\n");

  return {
    content: fallback,
    meta: {
      model: state.router9.defaultModel,
      provider: "9router",
      fallbackUsed: true,
      elapsedMs: Date.now() - startedAt,
      tokenUsage: {
        input: estimateTokens(message),
        output: estimateTokens(fallback),
      },
    },
  };
}

export async function* streamHarness(input: AdapterRequest): AsyncGenerator<StreamChunk> {
  const { harness, message, history, state, signal } = input;
  const startedAt = Date.now();
  const models = uniqueModels([state.router9.defaultModel, ...state.router9.fallbackOrder]);

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const streamResult = await tryOpenAiStream({
      endpoint: harness.endpoint,
      model,
      message,
      history,
      state,
      signal,
    });

    if (!streamResult) {
      continue;
    }

    let output = "";
    const provider = "9router";

    yield {
      type: "meta",
      meta: {
        model,
        provider,
        fallbackUsed: index > 0,
        elapsedMs: 0,
        tokenUsage: { input: estimateTokens(message), output: 0 },
      },
    };

    for await (const token of streamResult) {
      if (signal?.aborted) {
        yield { type: "done" };
        return;
      }
      output += token;
      yield { type: "delta", text: token };
    }

    yield {
      type: "meta",
      meta: {
        model,
        provider,
        fallbackUsed: index > 0,
        elapsedMs: Date.now() - startedAt,
        tokenUsage: { input: estimateTokens(message), output: estimateTokens(output) },
      },
    };
    yield { type: "done" };
    return;
  }

  const single = await invokeHarness(input);
  yield { type: "meta", meta: single.meta };

  const words = single.content.split(/(\s+)/);
  for (const token of words) {
    if (signal?.aborted) {
      yield { type: "done" };
      return;
    }
    yield { type: "delta", text: token };
    await sleep(24);
  }

  yield { type: "done" };
}

async function tryHarnessEndpoints(input: {
  harness: HarnessConfig;
  model: string;
  message: string;
  history: ChatMessage[];
  state: SystemState;
  signal?: AbortSignal;
}): Promise<AttemptResult | null> {
  const { harness, model, message, history, state, signal } = input;

  const custom = await requestCustomJson(harness.endpoint, model, message, history, state, signal);
  if (custom) {
    return custom;
  }

  const openAi = await requestOpenAiJson(harness.endpoint, model, message, history, state, signal);
  if (openAi) {
    return openAi;
  }

  return null;
}

async function requestCustomJson(
  endpoint: string,
  model: string,
  message: string,
  history: ChatMessage[],
  state: SystemState,
  signal?: AbortSignal,
): Promise<AttemptResult | null> {
  const paths = ["/api/chat", "/chat"];

  for (const path of paths) {
    try {
      const response = await fetchWithTimeout(
        `${endpoint}${path}`,
        {
          method: "POST",
          headers: buildHeaders(state),
          body: JSON.stringify({
            model,
            message,
            history,
            router: {
              baseUrl: state.router9.baseUrl,
              fallbackOrder: state.router9.fallbackOrder,
            },
          }),
          signal,
        },
        REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const content = extractText(payload);
      if (!content) {
        continue;
      }

      return { content, provider: "9router" };
    } catch {
      // Try next endpoint shape
    }
  }

  return null;
}

async function requestOpenAiJson(
  endpoint: string,
  model: string,
  message: string,
  history: ChatMessage[],
  state: SystemState,
  signal?: AbortSignal,
): Promise<AttemptResult | null> {
  try {
    const response = await fetchWithTimeout(
      `${endpoint}/v1/chat/completions`,
      {
        method: "POST",
        headers: buildHeaders(state),
        body: JSON.stringify({
          model,
          stream: false,
          messages: buildOpenAiMessages(message, history),
        }),
        signal,
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const content = extractText(payload);
    if (!content) {
      return null;
    }

    return { content, provider: "9router" };
  } catch {
    return null;
  }
}

async function tryOpenAiStream(input: {
  endpoint: string;
  model: string;
  message: string;
  history: ChatMessage[];
  state: SystemState;
  signal?: AbortSignal;
}): Promise<AsyncGenerator<string> | null> {
  const { endpoint, model, message, history, state, signal } = input;

  try {
    const response = await fetchWithTimeout(
      `${endpoint}/v1/chat/completions`,
      {
        method: "POST",
        headers: buildHeaders(state),
        body: JSON.stringify({
          model,
          stream: true,
          messages: buildOpenAiMessages(message, history),
        }),
        signal,
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok || !response.body) {
      return null;
    }

    return consumeOpenAiStream(response.body);
  } catch {
    return null;
  }
}

async function* consumeOpenAiStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak === -1) {
        break;
      }

      const line = buffer.slice(0, lineBreak).trim();
      buffer = buffer.slice(lineBreak + 1);

      if (!line.startsWith("data:")) {
        continue;
      }

      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        return;
      }

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: string };
          }>;
        };

        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          yield token;
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }
}

function buildHeaders(state: SystemState): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.router9.apiKey}`,
    "X-9Router-Api-Key": state.router9.apiKey,
    "X-9Router-Base-Url": state.router9.baseUrl,
  };
}

function buildOpenAiMessages(message: string, history: ChatMessage[]) {
  if (history.length > 0) {
    return history.map((entry) => ({ role: entry.role, content: entry.content }));
  }
  return [{ role: "user", content: message }];
}

function extractText(payload: Record<string, unknown>): string {
  const direct = payload.content ?? payload.output ?? payload.text;
  if (typeof direct === "string") {
    return direct;
  }

  const message = payload.message as Record<string, unknown> | undefined;
  if (message && typeof message.content === "string") {
    return message.content;
  }

  const choices = payload.choices as Array<Record<string, unknown>> | undefined;
  const first = choices?.[0];
  if (!first) {
    return "";
  }

  const choiceMessage = first.message as Record<string, unknown> | undefined;
  if (choiceMessage && typeof choiceMessage.content === "string") {
    return choiceMessage.content;
  }

  if (typeof first.text === "string") {
    return first.text;
  }

  return "";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const parent = init.signal;
  const relay = () => controller.abort();
  parent?.addEventListener("abort", relay);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", relay);
  }
}

function uniqueModels(models: string[]): string[] {
  return Array.from(new Set(models.filter(Boolean)));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}