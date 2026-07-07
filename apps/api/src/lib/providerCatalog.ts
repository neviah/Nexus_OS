export type ProviderCatalogEntry = {
  id: string;
  name: string;
  type: "openai-compatible" | "openrouter";
  baseUrl: string;
  defaultModel: string;
  tier: "free" | "paid" | "mixed";
  tags: string[];
  notes: string;
};

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    tier: "mixed",
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
  });
}
