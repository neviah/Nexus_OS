export type ProviderCatalogEntry = {
  id: string;
  name: string;
  type: "openai-compatible" | "openrouter";
  baseUrl: string;
  defaultModel: string;
  tier: "free" | "paid" | "mixed";
  healthScore: number;
  quotaNotes: string;
  rateLimitNotes: string;
  tags: string[];
  notes: string;
};

export type RouterFallbackTemplate = {
  id: string;
  label: string;
  description: string;
  targets: Array<{ providerId: string; model: string }>;
};

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    tier: "mixed",
    healthScore: 86,
    quotaNotes: "Free and paid routes vary per model; check model-level limits.",
    rateLimitNotes: "Burst limits vary by routed provider and plan.",
    tags: ["multi-provider", "free-models", "fallback-friendly"],
    notes: "Large model marketplace with both free and paid routes.",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    tier: "paid",
    healthScore: 92,
    quotaNotes: "Usage billed per token; no general free production tier.",
    rateLimitNotes: "Per-project/token quotas apply and can throttle bursts.",
    tags: ["reliable", "high-quality"],
    notes: "Direct OpenAI endpoint.",
  },
  {
    id: "iflow",
    name: "iFlow AI (free)",
    type: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    defaultModel: "iflow/default",
    tier: "free",
    healthScore: 68,
    quotaNotes: "Free local gateway profile; effective quota depends on upstream/free pool.",
    rateLimitNotes: "May degrade under high free-tier concurrency.",
    tags: ["local-gateway", "free-tier"],
    notes: "Local free-tier gateway profile.",
  },
  {
    id: "qwencode",
    name: "Qwen Code (free)",
    type: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    defaultModel: "qwencode/default",
    tier: "free",
    healthScore: 72,
    quotaNotes: "Free route profile intended for coding-heavy prompts.",
    rateLimitNotes: "Rate limits can spike during peak hours.",
    tags: ["local-gateway", "coding"],
    notes: "Local free coding route profile.",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI (free)",
    type: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    defaultModel: "gemini-cli/default",
    tier: "free",
    healthScore: 74,
    quotaNotes: "Free quotas depend on configured Gemini key/account tier.",
    rateLimitNotes: "Global shared free-tier limits may apply.",
    tags: ["local-gateway", "general"],
    notes: "Local Gemini CLI compatible route profile.",
  },
  {
    id: "kiro-ai",
    name: "Kiro AI (free)",
    type: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    defaultModel: "kiro-ai/default",
    tier: "free",
    healthScore: 70,
    quotaNotes: "No-cost profile with variable availability.",
    rateLimitNotes: "Free endpoints can throttle unpredictably.",
    tags: ["local-gateway", "assistant"],
    notes: "Local Kiro profile for no-cost fallback.",
  },
  {
    id: "anthropic-compat",
    name: "Anthropic (via OpenRouter)",
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4-5",
    tier: "paid",
    healthScore: 90,
    quotaNotes: "Paid model route through OpenRouter pricing.",
    rateLimitNotes: "Subject to OpenRouter + Anthropic model capacity.",
    tags: ["claude", "reasoning"],
    notes: "Anthropic models routed through OpenRouter.",
  },
  {
    id: "together",
    name: "Together AI",
    type: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3-8b-chat-hf",
    tier: "mixed",
    healthScore: 80,
    quotaNotes: "Mixed paid/free depending on model and account plan.",
    rateLimitNotes: "Rate caps vary by deployed model family.",
    tags: ["open-models", "serverless"],
    notes: "Open-model API with broad model catalog.",
  },
  {
    id: "groq",
    name: "Groq",
    type: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama3-8b-8192",
    tier: "mixed",
    healthScore: 88,
    quotaNotes: "Free allowances may exist; production usage typically paid.",
    rateLimitNotes: "Very fast endpoints may still enforce strict RPM/TPM ceilings.",
    tags: ["low-latency", "openai-compatible"],
    notes: "Fast inference endpoint with OpenAI-compatible schema.",
  },
  {
    id: "custom",
    name: "Custom / Local",
    type: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3",
    tier: "free",
    healthScore: 78,
    quotaNotes: "Local/self-hosted quota depends on your machine capacity.",
    rateLimitNotes: "No cloud throttling; limited by local runtime throughput.",
    tags: ["local", "self-hosted"],
    notes: "Bring your own OpenAI-compatible endpoint.",
  },
];

export function listProviderCatalog(filter?: { tier?: string; search?: string }): ProviderCatalogEntry[] {
  const tier = String(filter?.tier ?? "all").trim().toLowerCase();
  const search = String(filter?.search ?? "").trim().toLowerCase();

  return PROVIDER_CATALOG.filter((entry) => {
    if (tier && tier !== "all" && entry.tier !== tier) {
      return false;
    }

    if (!search) {
      return true;
    }

    return [entry.id, entry.name, entry.defaultModel, entry.tags.join(" "), entry.notes]
      .join(" ")
      .toLowerCase()
      .includes(search);
  }).sort((a, b) => {
    if (a.tier === "free" && b.tier !== "free") return -1;
    if (b.tier === "free" && a.tier !== "free") return 1;
    return b.healthScore - a.healthScore;
  });
}

export function listRouterFallbackTemplates(): RouterFallbackTemplate[] {
  return [
    {
      id: "coding-balanced",
      label: "Coding Balanced",
      description: "Balanced coding fallback with fast free-first routes.",
      targets: [
        { providerId: "qwencode", model: "qwencode/default" },
        { providerId: "openrouter", model: "openai/gpt-4.1-mini" },
        { providerId: "groq", model: "llama3-8b-8192" },
      ],
    },
    {
      id: "chat-low-cost",
      label: "Chat Low Cost",
      description: "Free/mixed chat-first routing for budget-sensitive usage.",
      targets: [
        { providerId: "gemini-cli", model: "gemini-cli/default" },
        { providerId: "iflow", model: "iflow/default" },
        { providerId: "openrouter", model: "openai/gpt-4.1-mini" },
      ],
    },
    {
      id: "quality-priority",
      label: "Quality Priority",
      description: "High-quality paid/mixed route for critical outputs.",
      targets: [
        { providerId: "openai", model: "gpt-4.1-mini" },
        { providerId: "anthropic-compat", model: "anthropic/claude-sonnet-4-5" },
        { providerId: "openrouter", model: "openai/gpt-4.1-mini" },
      ],
    },
  ];
}
