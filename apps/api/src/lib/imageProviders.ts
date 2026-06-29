type ImageProviderContext = {
  prompt: string;
  model: string;
  width: number;
  height: number;
  seed: number;
};

export type ImageGenerationResult = {
  imageUrl: string;
  engine: string;
  provider: string;
  model: string;
  resolvedModel: string;
  width: number;
  height: number;
  seed: number;
};

type ImageProvider = {
  id: string;
  generate: (context: ImageProviderContext) => Promise<ImageGenerationResult>;
};

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), 256), 2048)
    : fallback;
}

const pollinationsProvider: ImageProvider = {
  id: "pollinations",
  async generate(context) {
    const modelMap: Record<string, string> = {
      "flux-2": "flux",
      "krea-2": "krea",
      flux: "flux",
      krea: "krea",
      turbo: "turbo",
    };
    const requestedModel = context.model.trim().toLowerCase();
    const resolvedModel = modelMap[requestedModel] ?? "flux";
    const width = normalizeDimension(context.width, 1024);
    const height = normalizeDimension(context.height, 1024);

    const params = new URLSearchParams({
      model: resolvedModel,
      width: String(width),
      height: String(height),
      nologo: "true",
      enhance: "true",
      seed: String(context.seed),
    });

    return {
      imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(context.prompt)}?${params.toString()}`,
      engine: "pollinations",
      provider: "pollinations",
      model: requestedModel,
      resolvedModel,
      width,
      height,
      seed: context.seed,
    };
  },
};

const imageProviders = new Map<string, ImageProvider>([[pollinationsProvider.id, pollinationsProvider]]);

export async function generateImageFromProvider(params: {
  provider?: string;
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
}): Promise<ImageGenerationResult> {
  const providerId = (params.provider ?? "pollinations").trim().toLowerCase();
  const provider = imageProviders.get(providerId);
  if (!provider) {
    throw new Error(`Unsupported image provider: ${providerId}`);
  }

  const model = (params.model?.trim() || "flux-2").toLowerCase();
  const width = Number(params.width ?? 1024);
  const height = Number(params.height ?? 1024);
  const seed = Number.isFinite(Number(params.seed)) ? Number(params.seed) : Date.now();

  return provider.generate({
    prompt: params.prompt,
    model,
    width,
    height,
    seed,
  });
}
