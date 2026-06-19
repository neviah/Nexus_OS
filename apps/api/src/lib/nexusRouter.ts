import type {
  ChatMessage,
  NexusRouterFallbackTarget,
  NexusRouterProvider,
  NexusRouterRetryPolicy,
  SystemState,
} from "../types.js";

export type RouterProviderPublic = Omit<NexusRouterProvider, "apiKey"> & { maskedApiKey: string };

export type RoutedChatResult = {
  content: string;
  model: string;
  providerId: string;
  attempts: Array<{ providerId: string; model: string; status: "success" | "failed"; details: string }>;
  elapsedMs: number;
};

const DEFAULT_RETRY_POLICY: NexusRouterRetryPolicy = {
  maxAttempts: 3,
  backoffMs: 400,
  retryOnStatus: [408, 409, 425, 429, 500, 502, 503, 504],
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskApiKey(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildCompletionsUrl(provider: NexusRouterProvider): string {
  const root = normalizeBaseUrl(provider.baseUrl);
  if (root.endsWith("/chat/completions")) {
    return root;
  }
  if (root.endsWith("/v1")) {
    return `${root}/chat/completions`;
  }
  return `${root}/v1/chat/completions`;
}

function buildModelsUrl(provider: NexusRouterProvider): string {
  const root = normalizeBaseUrl(provider.baseUrl);
  if (root.endsWith("/models")) {
    return root;
  }
  if (root.endsWith("/v1")) {
    return `${root}/models`;
  }
  return `${root}/v1/models`;
}

export function ensureRouterState(state: SystemState): NonNullable<SystemState["nexusRouter"]> {
  if (!state.nexusRouter) {
    state.nexusRouter = {
      providers: [],
      fallbackChain: [],
      retryPolicy: { ...DEFAULT_RETRY_POLICY },
      logs: [],
    };
  }

  state.nexusRouter.retryPolicy = {
    maxAttempts: clamp(state.nexusRouter.retryPolicy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts, 1, 8),
    backoffMs: clamp(state.nexusRouter.retryPolicy?.backoffMs ?? DEFAULT_RETRY_POLICY.backoffMs, 0, 5000),
    retryOnStatus: Array.isArray(state.nexusRouter.retryPolicy?.retryOnStatus)
      ? state.nexusRouter.retryPolicy.retryOnStatus
      : DEFAULT_RETRY_POLICY.retryOnStatus,
  };

  state.nexusRouter.providers = Array.isArray(state.nexusRouter.providers)
    ? state.nexusRouter.providers
    : [];
  state.nexusRouter.fallbackChain = Array.isArray(state.nexusRouter.fallbackChain)
    ? state.nexusRouter.fallbackChain
    : [];
  state.nexusRouter.logs = Array.isArray(state.nexusRouter.logs)
    ? state.nexusRouter.logs
    : [];

  return state.nexusRouter;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getRouterProviders(state: SystemState): RouterProviderPublic[] {
  const router = ensureRouterState(state);
  return router.providers.map((provider) => ({
    ...provider,
    maskedApiKey: maskApiKey(provider.apiKey),
  }));
}

export function upsertRouterProvider(state: SystemState, input: {
  id: string;
  name: string;
  type: "openai-compatible" | "openrouter";
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
  defaultModel?: string;
}): RouterProviderPublic {
  const router = ensureRouterState(state);
  const existingIndex = router.providers.findIndex((entry) => entry.id === input.id);
  const next: NexusRouterProvider = {
    id: input.id,
    name: input.name,
    type: input.type,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey,
    enabled: input.enabled ?? true,
    defaultModel: input.defaultModel,
    models: existingIndex >= 0 ? router.providers[existingIndex].models : [],
    lastSyncedAt: existingIndex >= 0 ? router.providers[existingIndex].lastSyncedAt : undefined,
  };

  if (existingIndex >= 0) {
    router.providers[existingIndex] = next;
  } else {
    router.providers.push(next);
  }

  appendRouterLog(router, "info", `Provider ${input.id} saved`);

  return {
    ...next,
    maskedApiKey: maskApiKey(next.apiKey),
  };
}

export function updateRouterConfig(state: SystemState, input: {
  fallbackChain?: NexusRouterFallbackTarget[];
  retryPolicy?: Partial<NexusRouterRetryPolicy>;
}): { fallbackChain: NexusRouterFallbackTarget[]; retryPolicy: NexusRouterRetryPolicy } {
  const router = ensureRouterState(state);

  if (input.fallbackChain) {
    router.fallbackChain = input.fallbackChain;
  }

  if (input.retryPolicy) {
    router.retryPolicy = {
      maxAttempts: clamp(input.retryPolicy.maxAttempts ?? router.retryPolicy.maxAttempts, 1, 8),
      backoffMs: clamp(input.retryPolicy.backoffMs ?? router.retryPolicy.backoffMs, 0, 5000),
      retryOnStatus: input.retryPolicy.retryOnStatus ?? router.retryPolicy.retryOnStatus,
    };
  }

  appendRouterLog(router, "info", "Router config updated");

  return {
    fallbackChain: router.fallbackChain,
    retryPolicy: router.retryPolicy,
  };
}

export async function syncProviderModels(state: SystemState, providerId: string): Promise<string[]> {
  const router = ensureRouterState(state);
  const provider = router.providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  if (!provider.apiKey) {
    throw new Error(`Provider ${providerId} is missing an API key`);
  }

  const response = await fetch(buildModelsUrl(provider), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Model sync failed for ${providerId}: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  const models = (payload.data ?? [])
    .map((entry) => entry.id)
    .filter((entry): entry is string => Boolean(entry));

  provider.models = models;
  provider.lastSyncedAt = new Date().toISOString();
  appendRouterLog(router, "info", `Synced ${models.length} models for ${providerId}`);
  return models;
}

function resolveTargets(
  router: NonNullable<SystemState["nexusRouter"]>,
  input: { providerId?: string; model?: string; fallbackChain?: NexusRouterFallbackTarget[] },
): NexusRouterFallbackTarget[] {
  const activeProviders = router.providers.filter((entry) => entry.enabled);

  if (input.providerId && input.model) {
    const first = [{ providerId: input.providerId, model: input.model }];
    const tail = (input.fallbackChain ?? router.fallbackChain).filter(
      (entry) => !(entry.providerId === input.providerId && entry.model === input.model),
    );
    return [...first, ...tail];
  }

  if (input.model) {
    return activeProviders.map((provider) => ({ providerId: provider.id, model: input.model as string }));
  }

  return input.fallbackChain ?? router.fallbackChain;
}

export async function routeChatWithFallback(
  state: SystemState,
  input: {
    providerId?: string;
    model?: string;
    fallbackChain?: NexusRouterFallbackTarget[];
    messages: Array<Pick<ChatMessage, "role" | "content">>;
    temperature?: number;
  },
): Promise<RoutedChatResult> {
  const router = ensureRouterState(state);
  const started = Date.now();
  const attempts: RoutedChatResult["attempts"] = [];
  const targets = resolveTargets(router, input);

  if (targets.length === 0) {
    throw new Error("No fallback targets configured. Add providers and fallback models first.");
  }

  const retry = router.retryPolicy;

  for (const target of targets) {
    const provider = router.providers.find((entry) => entry.id === target.providerId && entry.enabled);
    if (!provider) {
      attempts.push({
        providerId: target.providerId,
        model: target.model,
        status: "failed",
        details: "provider not found or disabled",
      });
      continue;
    }

    if (!provider.apiKey) {
      attempts.push({
        providerId: provider.id,
        model: target.model,
        status: "failed",
        details: "missing api key",
      });
      continue;
    }

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(buildCompletionsUrl(provider), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: target.model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2,
          }),
        });

        if (!response.ok) {
          if (retry.retryOnStatus.includes(response.status) && attempt < retry.maxAttempts) {
            await delay(retry.backoffMs * attempt);
            continue;
          }
          attempts.push({
            providerId: provider.id,
            model: target.model,
            status: "failed",
            details: `http ${response.status}`,
          });
          break;
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };

        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
          attempts.push({
            providerId: provider.id,
            model: target.model,
            status: "failed",
            details: "empty content",
          });
          break;
        }

        attempts.push({
          providerId: provider.id,
          model: target.model,
          status: "success",
          details: `ok on attempt ${attempt}`,
        });
        appendRouterLog(router, "info", `Routed chat via ${provider.id}:${target.model}`);

        return {
          content,
          model: target.model,
          providerId: provider.id,
          attempts,
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        const message = String(error);
        if (attempt < retry.maxAttempts) {
          await delay(retry.backoffMs * attempt);
          continue;
        }

        attempts.push({
          providerId: provider.id,
          model: target.model,
          status: "failed",
          details: message,
        });
      }
    }
  }

  appendRouterLog(router, "error", "Routed chat failed across fallback chain");
  throw new Error(`All fallback targets failed: ${attempts.map((entry) => `${entry.providerId}/${entry.model} (${entry.details})`).join("; ")}`);
}

function appendRouterLog(router: NonNullable<SystemState["nexusRouter"]>, level: "info" | "warn" | "error", message: string): void {
  router.logs.unshift({
    timestamp: new Date().toISOString(),
    level,
    message,
  });
  if (router.logs.length > 100) {
    router.logs = router.logs.slice(0, 100);
  }
}
