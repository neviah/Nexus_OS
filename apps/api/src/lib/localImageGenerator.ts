import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRootDir } from "./stateStore.js";

const execFileAsync = promisify(execFile);

type LocalImageModel = {
  id: "sd15" | "dreamshaper-8";
  label: string;
  repoId: string;
  defaultWidth: number;
  defaultHeight: number;
  recommendedMaxSide: number;
  notes: string;
};

export type LocalImageStatusPayload = {
  ready: boolean;
  uvInstalled: boolean;
  runtimeDir: string;
  cacheDir: string;
  outputDir: string;
  models: Array<LocalImageModel & { installed: boolean }>;
};

export type LocalImageGenerateInput = {
  model: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed: number;
};

export type LocalImageGenerateResult = {
  outputPath: string;
  model: string;
  resolvedModel: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed: number;
  prompt: string;
  negativePrompt: string;
};

const LOCAL_IMAGE_MODELS: LocalImageModel[] = [
  {
    id: "sd15",
    label: "Stable Diffusion 1.5",
    repoId: "runwayml/stable-diffusion-v1-5",
    defaultWidth: 512,
    defaultHeight: 512,
    recommendedMaxSide: 768,
    notes: "Best low-VRAM baseline for 6-8GB GPUs.",
  },
  {
    id: "dreamshaper-8",
    label: "DreamShaper 8",
    repoId: "Lykon/dreamshaper-8",
    defaultWidth: 512,
    defaultHeight: 512,
    recommendedMaxSide: 768,
    notes: "Stylized SD 1.5 fine-tune with low-VRAM friendly defaults.",
  },
];

function getRuntimeDir(): string {
  return path.join(getRootDir(), "data", "runtime-tools", "local-image");
}

function getCacheDir(): string {
  return path.join(getRuntimeDir(), "hf-cache");
}

function getOutputDir(): string {
  return path.join(getRuntimeDir(), "outputs");
}

function getScriptPath(): string {
  return path.join(getRuntimeDir(), "generate_local_image.py");
}

function resolveModelById(modelId: string): LocalImageModel {
  const normalized = modelId.trim().toLowerCase();
  return LOCAL_IMAGE_MODELS.find((model) => model.id === normalized) ?? LOCAL_IMAGE_MODELS[0];
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function buildPythonScript(): string {
  return [
    "import json",
    "import os",
    "from pathlib import Path",
    "",
    "def emit_status(message: str):",
    "    print('NEXUS_STATUS:' + message, flush=True)",
    "",
    "def emit_result(payload):",
    "    print('NEXUS_RESULT:' + json.dumps(payload), flush=True)",
    "",
    "model_repo = os.environ['NEXUS_IMAGE_MODEL_REPO']",
    "prompt = os.environ['NEXUS_IMAGE_PROMPT']",
    "negative_prompt = os.environ.get('NEXUS_IMAGE_NEGATIVE_PROMPT', '')",
    "width = int(os.environ['NEXUS_IMAGE_WIDTH'])",
    "height = int(os.environ['NEXUS_IMAGE_HEIGHT'])",
    "steps = int(os.environ['NEXUS_IMAGE_STEPS'])",
    "guidance_scale = float(os.environ['NEXUS_IMAGE_GUIDANCE'])",
    "seed = int(os.environ['NEXUS_IMAGE_SEED'])",
    "cache_dir = os.environ['NEXUS_IMAGE_CACHE_DIR']",
    "output_path = os.environ['NEXUS_IMAGE_OUTPUT_PATH']",
    "",
    "emit_status('Importing PyTorch + Diffusers...')",
    "import torch",
    "from diffusers import StableDiffusionPipeline",
    "",
    "device = 'cuda' if torch.cuda.is_available() else 'cpu'",
    "dtype = torch.float16 if device == 'cuda' else torch.float32",
    "emit_status(f'Device selected: {device}')",
    "",
    "model_cache_marker = Path(cache_dir) / ('models--' + model_repo.replace('/', '--'))",
    "if not model_cache_marker.exists():",
    "    emit_status('Model not installed. Downloading on first run...')",
    "else:",
    "    emit_status('Model cache found. Loading...')",
    "",
    "pipe = StableDiffusionPipeline.from_pretrained(",
    "    model_repo,",
    "    torch_dtype=dtype,",
    "    use_safetensors=True,",
    "    cache_dir=cache_dir,",
    ")",
    "pipe = pipe.to(device)",
    "pipe.enable_attention_slicing()",
    "pipe.enable_vae_slicing()",
    "",
    "if device == 'cuda':",
    "    emit_status('GPU warmup complete. Generating image...')",
    "else:",
    "    emit_status('Running on CPU. Generation will be slower...')",
    "",
    "generator = torch.Generator(device=device).manual_seed(seed)",
    "result = pipe(",
    "    prompt=prompt,",
    "    negative_prompt=negative_prompt if negative_prompt else None,",
    "    width=width,",
    "    height=height,",
    "    num_inference_steps=steps,",
    "    guidance_scale=guidance_scale,",
    "    generator=generator,",
    ")",
    "image = result.images[0]",
    "Path(output_path).parent.mkdir(parents=True, exist_ok=True)",
    "image.save(output_path)",
    "emit_status('Image generated successfully.')",
    "",
    "emit_result({",
    "    'output_path': output_path,",
    "    'width': width,",
    "    'height': height,",
    "    'steps': steps,",
    "    'guidance_scale': guidance_scale,",
    "    'seed': seed,",
    "})",
  ].join("\n");
}

async function ensureRuntimeScaffold(): Promise<void> {
  await fs.mkdir(getRuntimeDir(), { recursive: true });
  await fs.mkdir(getCacheDir(), { recursive: true });
  await fs.mkdir(getOutputDir(), { recursive: true });
  await fs.writeFile(getScriptPath(), buildPythonScript(), "utf-8");
}

async function detectUvInstalled(): Promise<boolean> {
  try {
    await execFileAsync("uv", ["--version"], { windowsHide: true, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function resolveModelCachePath(repoId: string): string {
  return path.join(getCacheDir(), `models--${repoId.replace(/\//g, "--")}`);
}

async function detectModelInstalled(repoId: string): Promise<boolean> {
  try {
    await fs.access(resolveModelCachePath(repoId));
    return true;
  } catch {
    return false;
  }
}

export async function getLocalImageStatus(): Promise<LocalImageStatusPayload> {
  await ensureRuntimeScaffold();
  const uvInstalled = await detectUvInstalled();
  const models = await Promise.all(
    LOCAL_IMAGE_MODELS.map(async (model) => ({
      ...model,
      installed: await detectModelInstalled(model.repoId),
    })),
  );

  return {
    ready: uvInstalled,
    uvInstalled,
    runtimeDir: getRuntimeDir(),
    cacheDir: getCacheDir(),
    outputDir: getOutputDir(),
    models,
  };
}

export async function generateLocalImageStreaming(
  input: LocalImageGenerateInput,
  onStatus: (message: string) => void,
): Promise<LocalImageGenerateResult> {
  await ensureRuntimeScaffold();
  const uvInstalled = await detectUvInstalled();
  if (!uvInstalled) {
    throw new Error("uv is required for local image generation. Install uv and retry.");
  }

  const model = resolveModelById(input.model);
  const width = clampInt(input.width, 256, model.recommendedMaxSide);
  const height = clampInt(input.height, 256, model.recommendedMaxSide);
  const steps = clampInt(input.steps, 4, 50);
  const guidanceScale = clampFloat(input.guidanceScale, 0, 20);
  const seed = Number.isFinite(input.seed) ? Math.round(input.seed) : Math.floor(Date.now() % 2147483647);

  const outputPath = path.join(getOutputDir(), `image-${model.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);

  onStatus(`Preparing local runtime for ${model.label}...`);

  const child = spawn(
    "uv",
    [
      "run",
      "--quiet",
      "--with",
      "torch",
      "--with",
      "diffusers",
      "--with",
      "transformers",
      "--with",
      "accelerate",
      "--with",
      "safetensors",
      "--with",
      "pillow",
      "python",
      "-u",
      getScriptPath(),
    ],
    {
      cwd: getRuntimeDir(),
      windowsHide: true,
      env: {
        ...process.env,
        NEXUS_IMAGE_MODEL_REPO: model.repoId,
        NEXUS_IMAGE_PROMPT: input.prompt,
        NEXUS_IMAGE_NEGATIVE_PROMPT: input.negativePrompt,
        NEXUS_IMAGE_WIDTH: String(width),
        NEXUS_IMAGE_HEIGHT: String(height),
        NEXUS_IMAGE_STEPS: String(steps),
        NEXUS_IMAGE_GUIDANCE: String(guidanceScale),
        NEXUS_IMAGE_SEED: String(seed),
        NEXUS_IMAGE_CACHE_DIR: getCacheDir(),
        NEXUS_IMAGE_OUTPUT_PATH: outputPath,
      },
    },
  );

  return await new Promise<LocalImageGenerateResult>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let resultPayload: { output_path: string; width: number; height: number; steps: number; guidance_scale: number; seed: number } | null = null;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      while (true) {
        const idx = stdoutBuffer.indexOf("\n");
        if (idx < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        if (!line) {
          continue;
        }

        if (line.startsWith("NEXUS_STATUS:")) {
          onStatus(line.slice("NEXUS_STATUS:".length).trim());
          continue;
        }

        if (line.startsWith("NEXUS_RESULT:")) {
          try {
            resultPayload = JSON.parse(line.slice("NEXUS_RESULT:".length).trim()) as { output_path: string; width: number; height: number; steps: number; guidance_scale: number; seed: number };
          } catch {
            // Ignore malformed result line.
          }
          continue;
        }

        onStatus(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer += text;
      const trimmed = text.trim();
      if (trimmed) {
        onStatus(trimmed);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderrBuffer.trim() || `Local image generation failed with exit code ${code ?? "unknown"}.`));
        return;
      }
      if (!resultPayload) {
        reject(new Error("Local image generation completed without output metadata."));
        return;
      }
      resolve({
        outputPath: resultPayload.output_path,
        model: model.id,
        resolvedModel: model.repoId,
        width: resultPayload.width,
        height: resultPayload.height,
        steps: resultPayload.steps,
        guidanceScale: resultPayload.guidance_scale,
        seed: resultPayload.seed,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
      });
    });
  });
}
