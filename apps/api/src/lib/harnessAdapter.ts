import type { ChatMessage, HarnessConfig, SystemState } from "../types.js";
import { buildRouterBody, buildRouterHeaders, createRouterContext } from "./routerContract.js";

type AdapterRequest = {
  harness: HarnessConfig;
  message: string;
  history: ChatMessage[];
  state: SystemState;
  signal?: AbortSignal;
};

type AdapterConfig = NonNullable<HarnessConfig["adapter"]>;

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
  const models = resolveModelOrder(harness, state);

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
    "All configured adapter paths failed. Local fallback response returned.",
    `Prompt echo: ${message}`,
  ].join("\n");

  return {
    content: fallback,
    meta: {
      model: models[0] ?? "auto",
      provider: "nexus-router",
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
  const models = resolveModelOrder(harness, state);

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const stream = await tryHarnessStream({
      harness,
      model,
      message,
      history,
      state,
      signal,
    });

    if (!stream) {
      continue;
    }

    let output = "";
    yield {
      type: "meta",
      meta: {
        model,
        provider: "nexus-router",
        fallbackUsed: index > 0,
        elapsedMs: 0,
        tokenUsage: { input: estimateTokens(message), output: 0 },
      },
    };

    for await (const token of stream) {
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
        provider: "nexus-router",
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
  const parts = single.content.split(/(\s+)/);

  for (const part of parts) {
    if (signal?.aborted) {
      yield { type: "done" };
      return;
    }
    yield { type: "delta", text: part };
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
  const config = getAdapterConfig(harness);

  if (config.protocol !== "openai") {
    const generic = await requestGenericJson(harness, model, message, history, state, signal);
    if (generic) {
      return generic;
    }
  }

  if (config.protocol !== "generic") {
    const openAi = await requestOpenAiJson(harness, model, message, history, state, signal);
    if (openAi) {
      return openAi;
    }
  }

  return null;
}

async function tryHarnessStream(input: {
  harness: HarnessConfig;
  model: string;
  message: string;
  history: ChatMessage[];
  state: SystemState;
  signal?: AbortSignal;
}): Promise<AsyncGenerator<string> | null> {
  const { harness, model, message, history, state, signal } = input;
  const config = getAdapterConfig(harness);

  if (config.streamProtocol === "none") {
    return null;
  }

  if (config.streamProtocol === "custom-sse") {
    return requestGenericStream(harness, model, message, history, state, signal);
  }

  return requestOpenAiStream(harness, model, message, history, state, signal);
}

async function requestGenericJson(
  harness: HarnessConfig,
  model: string,
  message: string,
  history: ChatMessage[],
  state: SystemState,
  signal?: AbortSignal,
): Promise<AttemptResult | null> {
  const config = getAdapterConfig(harness);
  const context = createRouterContext(state, model);
  const paths = config.genericPaths.length > 0 ? config.genericPaths : ["/api/chat", "/chat"];

  for (const path of paths) {
    try {
      const response = await fetchWithTimeout(
        `${harness.endpoint}${path}`,
        {
          method: "POST",
          headers: buildRouterHeaders(harness, context),
          body: JSON.stringify({
            model,
            message,
            history,
            router: buildRouterBody(context),
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

      return { content, provider: "nexus-router" };
    } catch {
      // Try next configured path.
    }
  }

  return null;
}

async function requestOpenAiJson(
  harness: HarnessConfig,
  model: string,
  message: string,
  history: ChatMessage[],
  state: SystemState,
  signal?: AbortSignal,
): Promise<AttemptResult | null> {
  const config = getAdapterConfig(harness);
  const context = createRouterContext(state, model);

  try {
    const response = await fetchWithTimeout(
      `${harness.endpoint}${config.openAiPath}`,
      {
        method: "POST",
        headers: buildRouterHeaders(harness, context),
        body: JSON.stringify({
          model,
          stream: false,
          messages: buildOpenAiMessages(message, history),
          router: buildRouterBody(context),
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

    return { content, provider: "nexus-router" };
  } catch {
    return null;
  }
}

async function requestOpenAiStream(
  harness: HarnessConfig,
  model: string,
  message: string,
  history: ChatMessage[],
  state: SystemState,
  signal?: AbortSignal,
): Promise<AsyncGenerator<string> | null> {
  const config = getAdapterConfig(harness);
  const context = createRouterContext(state, model);

  try {
    const response = await fetchWithTimeout(
      `${harness.endpoint}${config.openAiPath}`,
      {
        method: "POST",
        headers: buildRouterHeaders(harness, context),
        body: JSON.stringify({
          model,
          stream: true,
          messages: buildOpenAiMessages(message, history),
          router: buildRouterBody(context),
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

async function requestGenericStream(
  harness: HarnessConfig,
  model: string,
  message: string,
  history: ChatMessage[],
  state: SystemState,
  signal?: AbortSignal,
): Promise<AsyncGenerator<string> | null> {
  const config = getAdapterConfig(harness);
  const context = createRouterContext(state, model);

  try {
    const response = await fetchWithTimeout(
      `${harness.endpoint}${config.streamPath}`,
      {
        method: "POST",
        headers: buildRouterHeaders(harness, context),
        body: JSON.stringify({
          model,
          message,
          history,
          router: buildRouterBody(context),
        }),
        signal,
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok || !response.body) {
      return null;
    }

    return consumeGenericSse(response.body);
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
      const breakAt = buffer.indexOf("\n");
      if (breakAt === -1) {
        break;
      }

      const line = buffer.slice(0, breakAt).trim();
      buffer = buffer.slice(breakAt + 1);

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
        // Ignore malformed chunks.
      }
    }
  }
}

async function* consumeGenericSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
      const split = buffer.indexOf("\n\n");
      if (split === -1) {
        break;
      }

      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const token =
          (parsed.delta as string | undefined) ??
          (parsed.token as string | undefined) ??
          (parsed.text as string | undefined) ??
          (parsed.content as string | undefined) ??
          "";

        if (token) {
          yield token;
        }
      } catch {
        yield data;
      }
    }
  }
}

function getAdapterConfig(harness: HarnessConfig): Required<AdapterConfig> {
  return {
    protocol: harness.adapter?.protocol ?? "hybrid",
    streamProtocol: harness.adapter?.streamProtocol ?? "openai-sse",
    authMode: harness.adapter?.authMode ?? "both",
    healthPath: harness.adapter?.healthPath ?? "/health",
    openAiPath: harness.adapter?.openAiPath ?? "/v1/chat/completions",
    genericPaths: harness.adapter?.genericPaths ?? ["/api/chat", "/chat"],
    streamPath: harness.adapter?.streamPath ?? "/api/chat/stream",
    customHeaders: harness.adapter?.customHeaders ?? {},
  };
}

function resolveModelOrder(harness: HarnessConfig, state: SystemState): string[] {
  const assigned = state.nexusRouter?.harnessAssignments?.[harness.id] ?? [];
  if (assigned.length > 0) {
    return uniqueModels(assigned.map((entry) => entry.model));
  }

  const fallbackChainModels = state.nexusRouter?.fallbackChain?.map((entry) => entry.model) ?? [];
  if (fallbackChainModels.length > 0) {
    return uniqueModels(fallbackChainModels);
  }

  const preferred = uniqueModels([harness.defaultModel, ...harness.models]);
  const router = uniqueModels([state.router9.defaultModel, ...state.router9.fallbackOrder]);

  const overlap = router.filter((model) => preferred.includes(model));
  if (overlap.length > 0) {
    return overlap;
  }

  return uniqueModels([...router, ...preferred]);
}

function buildOpenAiMessages(message: string, history: ChatMessage[]) {
  const base = history.map((entry) => ({ role: entry.role, content: entry.content }));
  const last = base[base.length - 1];
  const alreadyIncluded = last?.role === "user" && last?.content === message;
  if (!alreadyIncluded) {
    base.push({ role: "user", content: message });
  }
  return base;
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