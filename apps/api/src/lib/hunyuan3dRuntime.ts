import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRootDir } from "./stateStore.js";

const execFileAsync = promisify(execFile);

const hy3dRoot = path.join(getRootDir(), "vendor", "hunyuan3d-2gp");
const hy3dAppRoot = path.join(hy3dRoot, "app");
const hy3dVenvRoot = path.join(hy3dAppRoot, "env");
const hy3dRepoUrl = "https://github.com/deepbeepmeep/Hunyuan3D-2GP";
let lastHunyuanReadinessError: string | null = null;

export type Hunyuan3dStatus = {
  installed: boolean;
  envReady: boolean;
  apiReady: boolean;
  appRoot: string;
  pythonPath: string | null;
  notes: string[];
  recommended: {
    modelPath: string;
    subfolder: string;
    numInferenceSteps: number;
    octreeResolution: number;
    guidanceScale: number;
  };
};

export type Hunyuan3dGenerateInput = {
  imageBase64: string;
  modelPath?: string;
  subfolder?: string;
  numInferenceSteps: number;
  octreeResolution: number;
  guidanceScale: number;
  seed: number;
  format?: "glb" | "obj";
};

export type Hunyuan3dGenerateResult = {
  outputPath: string;
  provider: "hunyuan3d-2gp";
  modelPath: string;
  subfolder: string;
  numInferenceSteps: number;
  octreeResolution: number;
  guidanceScale: number;
  seed: number;
  format: "glb" | "obj";
  device: string;
};

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

function getHy3dPythonPath(): string {
  return process.platform === "win32"
    ? path.join(hy3dVenvRoot, "Scripts", "python.exe")
    : path.join(hy3dVenvRoot, "bin", "python");
}

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function ensurePython311OnWindows(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  if (await commandWorks("py", ["-3.11", "-V"])) {
    return;
  }

  try {
    await execFileAsync("winget", [
      "install",
      "--id",
      "Python.Python.3.11",
      "-e",
      "--silent",
      "--disable-interactivity",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ], {
      windowsHide: true,
      timeout: 20 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
  } catch {
    // Resolver below surfaces a clear setup error.
  }
}

async function resolveSystemPython(): Promise<{ command: string; argsPrefix: string[] }> {
  if (process.platform === "win32") {
    await ensurePython311OnWindows();
    if (await commandWorks("py", ["-3.11", "-V"])) {
      return { command: "py", argsPrefix: ["-3.11"] };
    }
    throw new Error("Python 3.11 is required for Hunyuan3D-2GP on Windows. Install Python 3.11 and retry.");
  }

  if (await commandWorks("python3.11", ["-V"])) {
    return { command: "python3.11", argsPrefix: [] };
  }

  throw new Error("Python 3.11 is required for Hunyuan3D-2GP. Install python3.11 and retry.");
}

async function ensureHunyuanRepo(): Promise<void> {
  await fs.mkdir(hy3dRoot, { recursive: true });
  const gitDir = path.join(hy3dAppRoot, ".git");

  try {
    await fs.access(gitDir);
    await execFileAsync("git", ["-C", hy3dAppRoot, "fetch", "origin", "main"], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await execFileAsync("git", ["-C", hy3dAppRoot, "reset", "--hard", "origin/main"], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    return;
  } catch {
    // Continue into clone path.
  }

  await fs.rm(hy3dAppRoot, { recursive: true, force: true });
  await execFileAsync("git", ["clone", "--depth", "1", hy3dRepoUrl, hy3dAppRoot], {
    windowsHide: true,
    timeout: 20 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function resolveRequirementsFile(): Promise<string> {
  const candidates = [
    "requirements-lite.txt",
    "requirements-windows.txt",
    "requirements.txt",
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(hy3dAppRoot, candidate));
      return candidate;
    } catch {
      // Try next file.
    }
  }
  throw new Error("Hunyuan3D-2GP requirements file was not found in cloned repository.");
}

async function ensureHunyuanEnv(): Promise<void> {
  const pythonPath = getHy3dPythonPath();
  try {
    await fs.access(pythonPath);
  } catch {
    const python = await resolveSystemPython();
    await execFileAsync(python.command, [...python.argsPrefix, "-m", "venv", hy3dVenvRoot], {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
  }

  await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools<75", "wheel"], {
    cwd: hy3dAppRoot,
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });

  const requirementsFile = await resolveRequirementsFile();

  const installRequirementsFromFile = async (fileName: string, withNoBuildIsolation: boolean): Promise<void> => {
    const args = ["-m", "pip", "install", "--prefer-binary"];
    if (withNoBuildIsolation) {
      args.push("--no-build-isolation");
    }
    args.push("-r", fileName);
    await execFileAsync(pythonPath, args, {
      cwd: hy3dAppRoot,
      windowsHide: true,
      timeout: 120 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 32,
    });
  };

  const buildDisoFreeRequirements = async (sourceFileName: string): Promise<string> => {
    const sourcePath = path.join(hy3dAppRoot, sourceFileName);
    const sourceText = await fs.readFile(sourcePath, "utf-8");
    const lines = sourceText.split(/\r?\n/);
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return true;
      }
      return !/\bdiso\b/i.test(trimmed);
    });
    const targetFileName = `${sourceFileName.replace(/\.txt$/i, "")}.nexus-nodiso.txt`;
    await fs.writeFile(path.join(hy3dAppRoot, targetFileName), filteredLines.join("\n"), "utf-8");
    return targetFileName;
  };

  const installRequirements = async (withNoBuildIsolation: boolean): Promise<void> => {
    await installRequirementsFromFile(requirementsFile, withNoBuildIsolation);
  };

  try {
    await installRequirements(false);
  } catch (error) {
    const message = String(error);
    const looksLikeTorchBuildIsolationIssue = /No module named 'torch'|Failed to build 'diso'|Failed to build diso|getting requirements to build wheel/i.test(message);
    if (!looksLikeTorchBuildIsolationIssue) {
      throw error;
    }

    // diso may import torch during build-time without declaring it in build requirements.
    // Seed torch first, then retry without build isolation.
    await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "--prefer-binary", "torch", "torchvision", "torchaudio"], {
      cwd: hy3dAppRoot,
      windowsHide: true,
      timeout: 120 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 32,
    });

    try {
      await installRequirements(true);
    } catch (secondError) {
      const secondMessage = String(secondError);
      const looksLikeCudaDisoBuildFailure = /cuda_runtime\.h|Failed building wheel for diso|failed-wheel-build-for-install/i.test(secondMessage);
      if (!looksLikeCudaDisoBuildFailure) {
        throw secondError;
      }

      // Some Windows installs do not have CUDA toolkit headers; diso is optional for our shape path.
      // Retry with a patched requirements file that excludes diso.
      const disoFreeRequirementsFile = await buildDisoFreeRequirements(requirementsFile);
      await installRequirementsFromFile(disoFreeRequirementsFile, true);
    }
  }

  // Some lightweight requirements variants omit numpy; force it so shapegen imports are stable.
  await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "--prefer-binary", "numpy<2"], {
    cwd: hy3dAppRoot,
    windowsHide: true,
    timeout: 20 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function patchHunyuanCpuFallbackBug(): Promise<void> {
  const pipelinePath = path.join(hy3dAppRoot, "hy3dgen", "shapegen", "pipelines.py");
  let text: string;
  try {
    text = await fs.readFile(pipelinePath, "utf-8");
  } catch {
    return;
  }

  const brokenLine = '        device =  torch.device("cuda")  #self.device';
  if (!text.includes(brokenLine)) {
    return;
  }

  await fs.writeFile(pipelinePath, text.replace(brokenLine, "        device = self.device"), "utf-8");
}

async function checkHunyuanApiReady(): Promise<boolean> {
  const pythonPath = getHy3dPythonPath();
  try {
    await fs.access(pythonPath);
  } catch {
    return false;
  }

  try {
    await execFileAsync(pythonPath, [
      "-c",
      [
        "from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline",
        "from hy3dgen.rembg import BackgroundRemover",
        "print('ok')",
      ].join("\n"),
    ], {
      cwd: hy3dAppRoot,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 256 * 1024,
    });
    lastHunyuanReadinessError = null;
    return true;
  } catch (error) {
    lastHunyuanReadinessError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function buildHunyuanScript(): string {
  return [
    "import base64",
    "import json",
    "import os",
    "",
    "import torch",
    "from PIL import Image",
    "from io import BytesIO",
    "",
    "from hy3dgen.rembg import BackgroundRemover",
    "from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline",
    "import importlib.util",
    "",
    "def emit_status(message: str):",
    "    print('NEXUS_STATUS:' + message, flush=True)",
    "",
    "def emit_result(payload):",
    "    print('NEXUS_RESULT:' + json.dumps(payload), flush=True)",
    "",
    "image_base64 = os.environ['NEXUS_HY3D_IMAGE_BASE64']",
    "model_path = os.environ.get('NEXUS_HY3D_MODEL_PATH', 'tencent/Hunyuan3D-2mini')",
    "subfolder = os.environ.get('NEXUS_HY3D_SUBFOLDER', 'hunyuan3d-dit-v2-mini-turbo')",
    "num_inference_steps = int(os.environ.get('NEXUS_HY3D_STEPS', '20'))",
    "octree_resolution = int(os.environ.get('NEXUS_HY3D_OCTREE', '192'))",
    "guidance_scale = float(os.environ.get('NEXUS_HY3D_GUIDANCE', '5.0'))",
    "seed = int(os.environ.get('NEXUS_HY3D_SEED', '1234'))",
    "output_path = os.environ['NEXUS_HY3D_OUTPUT_PATH']",
    "",
    "emit_status('Decoding source image...')",
    "image = Image.open(BytesIO(base64.b64decode(image_base64))).convert('RGBA')",
    "if image.mode == 'RGB':",
    "    image = BackgroundRemover()(image.convert('RGB'))",
    "",
    "cuda_compiled = bool(getattr(getattr(torch, 'version', object()), 'cuda', None))",
    "cuda_available = bool(cuda_compiled and torch.cuda.is_available())",
    "initial_device = 'cuda' if cuda_available else 'cpu'",
    "mc_algo = 'dmc' if importlib.util.find_spec('diso') is not None else 'mc'",
    "if mc_algo != 'dmc':",
    "    emit_status('diso not available; using mc surface extraction instead of dmc.')",
    "",
    "def build_generator(target_device: str):",
    "    if target_device == 'cuda':",
    "        return torch.Generator('cuda').manual_seed(seed)",
    "    return torch.Generator().manual_seed(seed)",
    "",
    "def run_generation(target_device: str):",
    "    emit_status(f'Loading shape model on {target_device}: {model_path}/{subfolder}')",
    "    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(",
    "        model_path,",
    "        subfolder=subfolder,",
    "        use_safetensors=True,",
    "        device=target_device,",
    "    )",
    "    try:",
    "        pipeline.enable_flashvdm()",
    "    except Exception:",
    "        pass",
    "    emit_status(f'Generating 3D mesh on {target_device}...')",
    "    params = {",
    "        'image': image,",
    "        'generator': build_generator(target_device),",
    "        'octree_resolution': octree_resolution,",
    "        'num_inference_steps': num_inference_steps,",
    "        'guidance_scale': guidance_scale,",
    "        'mc_algo': mc_algo,",
    "    }",
    "    return pipeline(**params)[0], target_device",
    "",
    "try:",
    "    mesh, used_device = run_generation(initial_device)",
    "except Exception as generation_error:",
    "    message = str(generation_error)",
    "    looks_like_cuda_issue = ('Torch not compiled with CUDA enabled' in message) or ('cuda' in message.lower())",
    "    if initial_device == 'cpu' or not looks_like_cuda_issue:",
    "        raise",
    "    emit_status('CUDA path failed; retrying generation on CPU.')",
    "    mesh, used_device = run_generation('cpu')",
    "mesh.export(output_path)",
    "emit_result({",
    "    'output_path': output_path,",
    "    'device': used_device,",
    "    'model_path': model_path,",
    "    'subfolder': subfolder,",
    "})",
  ].join("\n");
}

async function terminateChild(childPid: number): Promise<void> {
  if (!Number.isFinite(childPid) || childPid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(childPid), "/T", "/F"], {
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
    } catch {
      // Ignore cancellation races.
    }
    return;
  }

  try {
    process.kill(childPid, "SIGTERM");
  } catch {
    // Ignore cancellation races.
  }
}

export async function getHunyuan3dStatus(): Promise<Hunyuan3dStatus> {
  const pythonPath = getHy3dPythonPath();
  const installed = await fs.access(path.join(hy3dAppRoot, "api_server.py")).then(() => true).catch(() => false);
  const envReady = await fs.access(pythonPath).then(() => true).catch(() => false);
  const apiReady = installed && envReady ? await checkHunyuanApiReady() : false;

  const notes: string[] = [];
  if (!installed) {
    notes.push("Hunyuan3D-2GP repo is not installed yet.");
  }
  if (installed && !envReady) {
    notes.push("Hunyuan3D-2GP repo exists but Python environment is missing.");
  }
  if (installed && envReady && !apiReady) {
    notes.push("Hunyuan3D-2GP environment exists but imports failed. Reinstall dependencies.");
    if (lastHunyuanReadinessError) {
      notes.push(`Readiness check error: ${lastHunyuanReadinessError}`);
    }
  }
  if (apiReady) {
    notes.push("Image-to-3D generation is available.");
    notes.push("Default profile uses Hunyuan3D-2mini turbo for lower VRAM usage.");
  }

  return {
    installed,
    envReady,
    apiReady,
    appRoot: hy3dAppRoot,
    pythonPath: envReady ? pythonPath : null,
    notes,
    recommended: {
      modelPath: "tencent/Hunyuan3D-2mini",
      subfolder: "hunyuan3d-dit-v2-mini-turbo",
      numInferenceSteps: 20,
      octreeResolution: 192,
      guidanceScale: 5.0,
    },
  };
}

export async function installHunyuan3d(): Promise<void> {
  await ensureHunyuanRepo();
  await ensureHunyuanEnv();
  await patchHunyuanCpuFallbackBug();
}

export async function startHunyuan3dIfNeeded(): Promise<void> {
  await patchHunyuanCpuFallbackBug();
  const status = await getHunyuan3dStatus();
  if (status.apiReady) {
    return;
  }
  if (!status.installed || !status.envReady) {
    throw new Error("Hunyuan3D-2GP is not installed. Run install first.");
  }
  // Try self-healing dependencies before failing readiness checks.
  await ensureHunyuanEnv();
  const ready = await checkHunyuanApiReady();
  if (!ready) {
    throw new Error(`Hunyuan3D-2GP readiness check failed.${lastHunyuanReadinessError ? ` ${lastHunyuanReadinessError}` : ""}`);
  }
}

export async function generateWithHunyuan3dStreaming(
  input: Hunyuan3dGenerateInput,
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<Hunyuan3dGenerateResult> {
  await patchHunyuanCpuFallbackBug();
  const status = await getHunyuan3dStatus();
  if (!status.apiReady) {
    throw new Error("Hunyuan3D-2GP is not ready. Install or repair runtime first.");
  }

  const modelPath = (input.modelPath ?? "").trim() || "tencent/Hunyuan3D-2mini";
  const subfolder = (input.subfolder ?? "").trim() || "hunyuan3d-dit-v2-mini-turbo";
  const numInferenceSteps = clampInt(input.numInferenceSteps, 5, 60);
  const octreeResolution = clampInt(input.octreeResolution, 128, 512);
  const guidanceScale = clampFloat(input.guidanceScale, 1, 10);
  const seed = Number.isFinite(input.seed) ? Math.round(input.seed) : Math.floor(Date.now() % 2147483647);
  const format = input.format === "obj" ? "obj" : "glb";
  const outputPath = path.join(hy3dAppRoot, `.nexus-hy3d-output-${Date.now()}.${format}`);
  const maxDurationMs = 45 * 60 * 1000;
  const inactivityTimeoutMs = 3 * 60 * 1000;
  const heartbeatIntervalMs = 20 * 1000;

  await fs.mkdir(hy3dAppRoot, { recursive: true });
  const scriptPath = path.join(hy3dAppRoot, ".nexus-generate-hunyuan3d.py");
  await fs.writeFile(scriptPath, buildHunyuanScript(), "utf-8");

  onStatus("Starting Hunyuan3D-2GP generation...");

  const child = spawn(getHy3dPythonPath(), [scriptPath], {
    cwd: hy3dAppRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      NEXUS_HY3D_IMAGE_BASE64: input.imageBase64,
      NEXUS_HY3D_MODEL_PATH: modelPath,
      NEXUS_HY3D_SUBFOLDER: subfolder,
      NEXUS_HY3D_STEPS: String(numInferenceSteps),
      NEXUS_HY3D_OCTREE: String(octreeResolution),
      NEXUS_HY3D_GUIDANCE: String(guidanceScale),
      NEXUS_HY3D_SEED: String(seed),
      NEXUS_HY3D_OUTPUT_PATH: outputPath,
    },
  });

  return await new Promise<Hunyuan3dGenerateResult>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let resultPayload: { output_path: string; device?: string; model_path?: string; subfolder?: string } | null = null;
    let canceled = false;
    let settled = false;
    const startedAt = Date.now();
    let lastActivityAt = startedAt;

    const touchActivity = () => {
      lastActivityAt = Date.now();
    };

    const failOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(watchdogTimer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    };

    const onAbort = () => {
      canceled = true;
      onStatus("Cancellation requested. Stopping Hunyuan3D process...");
      if (child.pid) {
        void terminateChild(child.pid);
      }
    };

    const watchdogTimer = setInterval(() => {
      if (settled || canceled || signal?.aborted) {
        return;
      }
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const idleMs = now - lastActivityAt;

      if (idleMs > inactivityTimeoutMs) {
        onStatus(`Hunyuan3D watchdog: no output for ${Math.round(idleMs / 1000)}s. Aborting generation.`);
        if (child.pid) {
          void terminateChild(child.pid);
        }
        failOnce(new Error("Hunyuan3D generation stalled without output for too long. Try fewer steps or a smaller octree value."));
        return;
      }

      if (elapsedMs > maxDurationMs) {
        onStatus(`Hunyuan3D watchdog: generation exceeded ${Math.round(maxDurationMs / 60000)} minute limit. Aborting.`);
        if (child.pid) {
          void terminateChild(child.pid);
        }
        failOnce(new Error("Hunyuan3D generation timed out before completion. Try fewer steps, lower octree resolution, or retry."));
        return;
      }

      onStatus(`Hunyuan3D still running (${Math.round(elapsedMs / 1000)}s elapsed).`);
    }, heartbeatIntervalMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      touchActivity();
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
            resultPayload = JSON.parse(line.slice("NEXUS_RESULT:".length).trim()) as { output_path: string; device?: string; model_path?: string; subfolder?: string };
          } catch {
            // Ignore malformed payload lines.
          }
          continue;
        }

        onStatus(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      touchActivity();
      const text = chunk.toString();
      stderrBuffer += text;
      const trimmed = text.trim();
      if (trimmed) {
        onStatus(trimmed);
      }
    });

    child.on("error", (error) => {
      failOnce(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(watchdogTimer);
      signal?.removeEventListener("abort", onAbort);
      if (canceled || signal?.aborted) {
        reject(new Error("Hunyuan3D generation canceled by user."));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderrBuffer.trim() || `Hunyuan3D process failed with exit code ${code ?? "unknown"}.`));
        return;
      }
      if (!resultPayload?.output_path) {
        reject(new Error("Hunyuan3D finished without returning an output file path."));
        return;
      }

      resolve({
        outputPath: resultPayload.output_path,
        provider: "hunyuan3d-2gp",
        modelPath: resultPayload.model_path?.trim() || modelPath,
        subfolder: resultPayload.subfolder?.trim() || subfolder,
        numInferenceSteps,
        octreeResolution,
        guidanceScale,
        seed,
        format,
        device: resultPayload.device?.trim() || "unknown",
      });
    });
  });
}

export function inferMeshExtension(filePath: string, fallback: "glb" | "obj"): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (ext === "glb" || ext === "obj") {
    return ext;
  }
  return fallback;
}

export async function readMeshBytes(filePath: string): Promise<Buffer> {
  return await fs.readFile(filePath);
}
