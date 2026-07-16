import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRootDir } from "./stateStore.js";

const execFileAsync = promisify(execFile);

const wanRoot = path.join(getRootDir(), "vendor", "wan2gp");
const wanAppRoot = path.join(wanRoot, "app");
const wanVenvRoot = path.join(wanAppRoot, "env");
const wanRepoUrl = "https://github.com/deepbeepmeep/Wan2GP";
let lastWanReadinessError: string | null = null;
let wanModelCatalogCache: Wan2GpModelCatalog | null = null;
let wanModelCatalogCacheAt = 0;
const wanModelCatalogCacheTtlMs = 60 * 1000;

type Wan2GpMode = "image" | "video";

export type Wan2GpStatus = {
  installed: boolean;
  envReady: boolean;
  apiReady: boolean;
  appRoot: string;
  pythonPath: string | null;
  supports: {
    image: boolean;
    video: boolean;
    tts: boolean;
    stt: boolean;
  };
  notes: string[];
};

export type Wan2GpModelCatalogEntry = {
  modelType: string;
  available: boolean;
  status: string;
};

export type Wan2GpModelCatalog = {
  image: Wan2GpModelCatalogEntry[];
  video: Wan2GpModelCatalogEntry[];
  scannedAt: string;
};

export type Wan2GpGenerateInput = {
  mode: Wan2GpMode;
  prompt: string;
  negativePrompt?: string;
  model?: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  profile: number;
  durationSeconds?: number;
  fps?: number;
  frameCount?: number;
};

export type Wan2GpGenerateResult = {
  outputPath: string;
  mode: Wan2GpMode;
  provider: "wan2gp";
  model: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  prompt: string;
  negativePrompt: string;
  profile: number;
  durationSeconds?: number;
  fps?: number;
  frameCount?: number;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizeWanModel(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.toLowerCase() === "auto") {
    return "";
  }
  return trimmed;
}

function getWanPythonPath(): string {
  return process.platform === "win32"
    ? path.join(wanVenvRoot, "Scripts", "python.exe")
    : path.join(wanVenvRoot, "bin", "python");
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
    // If winget install fails, we surface a clear error in resolver below.
  }
}

async function resolveSystemPython(): Promise<{ command: string; argsPrefix: string[] }> {
  if (process.platform === "win32") {
    await ensurePython311OnWindows();
    if (await commandWorks("py", ["-3.11", "-V"])) {
      return { command: "py", argsPrefix: ["-3.11"] };
    }
    throw new Error("Python 3.11 is required for Wan2GP on Windows. Install Python 3.11 and retry.");
  }

  if (await commandWorks("python3.11", ["-V"])) {
    return { command: "python3.11", argsPrefix: [] };
  }

  throw new Error("Python 3.11 is required for Wan2GP. Install python3.11 and retry.");
}

async function ensureWanRepo(): Promise<void> {
  await fs.mkdir(wanRoot, { recursive: true });
  const gitDir = path.join(wanAppRoot, ".git");

  try {
    await fs.access(gitDir);
    await execFileAsync("git", ["-C", wanAppRoot, "fetch", "origin", "main"], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await execFileAsync("git", ["-C", wanAppRoot, "reset", "--hard", "origin/main"], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    return;
  } catch {
    // Continue into clone path.
  }

  await fs.rm(wanAppRoot, { recursive: true, force: true });
  await execFileAsync("git", ["clone", "--depth", "1", wanRepoUrl, wanAppRoot], {
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 8,
  });
}

async function ensureWanEnv(): Promise<void> {
  const pythonPath = getWanPythonPath();
  try {
    await fs.access(pythonPath);
  } catch {
    const python = await resolveSystemPython();
    await execFileAsync(python.command, [...python.argsPrefix, "-m", "venv", wanVenvRoot], {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
  }

  await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools<75", "wheel"], {
    cwd: wanAppRoot,
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });

  await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: wanAppRoot,
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });

  await execFileAsync(pythonPath, ["-m", "pip", "install", "--prefer-binary", "-r", "requirements.txt"], {
    cwd: wanAppRoot,
    windowsHide: true,
    timeout: 90 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 32,
  });

  // Optional accelerator for Hugging Face Xet-backed repos; avoids repeated fallback warnings.
  try {
    await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "hf_xet"], {
      cwd: wanAppRoot,
      windowsHide: true,
      timeout: 20 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16,
    });
  } catch {
    // Not fatal; WanGP can still download via regular HTTP.
  }

  await ensureCudaTorchWhenNvidiaPresent(pythonPath);
}

async function hasNvidiaGpu(): Promise<boolean> {
  return await commandWorks("nvidia-smi", ["-L"]);
}

async function readTorchBuildInfo(
  pythonPath: string,
): Promise<{ version: string; cuda: string; available: boolean; torchaudioOk: boolean; torchaudioVersion: string }> {
  const { stdout } = await execFileAsync(pythonPath, [
    "-c",
    [
      "import json",
      "import torch",
      "torchaudio_ok = True",
      "torchaudio_version = ''",
      "try:",
      "  import torchaudio",
      "  torchaudio_version = str(getattr(torchaudio, '__version__', ''))",
      "except Exception:",
      "  torchaudio_ok = False",
      "print('NEXUS_TORCH:' + json.dumps({",
      "  'version': str(getattr(torch, '__version__', '')),",
      "  'cuda': str(getattr(getattr(torch, 'version', object()), 'cuda', '') or ''),",
      "  'available': bool(getattr(torch.cuda, 'is_available', lambda: False)()),",
      "  'torchaudio_ok': torchaudio_ok,",
      "  'torchaudio_version': torchaudio_version",
      "}))",
    ].join("\n"),
  ], {
    cwd: wanAppRoot,
    windowsHide: true,
    timeout: 60 * 1000,
    maxBuffer: 1024 * 1024,
  });

  const marker = "NEXUS_TORCH:";
  const line = stdout.split(/\r?\n/).map((item) => item.trim()).find((item) => item.startsWith(marker));
  if (!line) {
    return { version: "", cuda: "", available: false, torchaudioOk: false, torchaudioVersion: "" };
  }

  try {
    const parsed = JSON.parse(line.slice(marker.length)) as {
      version?: unknown;
      cuda?: unknown;
      available?: unknown;
      torchaudio_ok?: unknown;
      torchaudio_version?: unknown;
    };
    return {
      version: String(parsed.version ?? ""),
      cuda: String(parsed.cuda ?? ""),
      available: Boolean(parsed.available),
      torchaudioOk: Boolean(parsed.torchaudio_ok),
      torchaudioVersion: String(parsed.torchaudio_version ?? ""),
    };
  } catch {
    return { version: "", cuda: "", available: false, torchaudioOk: false, torchaudioVersion: "" };
  }
}

async function ensureCudaTorchWhenNvidiaPresent(pythonPath: string): Promise<void> {
  if (!(await hasNvidiaGpu())) {
    return;
  }

  const before = await readTorchBuildInfo(pythonPath).catch(() => ({
    version: "",
    cuda: "",
    available: false,
    torchaudioOk: false,
    torchaudioVersion: "",
  }));
  if (before.cuda && before.torchaudioOk) {
    return;
  }

  const cudaIndexes = [
    "https://download.pytorch.org/whl/cu128",
    "https://download.pytorch.org/whl/cu126",
    "https://download.pytorch.org/whl/cu124",
  ];

  for (const indexUrl of cudaIndexes) {
    try {
      await execFileAsync(pythonPath, [
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--force-reinstall",
        "--index-url",
        indexUrl,
        "torch",
        "torchvision",
        "torchaudio",
      ], {
        cwd: wanAppRoot,
        windowsHide: true,
        timeout: 60 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 32,
      });
    } catch {
      continue;
    }

    const after = await readTorchBuildInfo(pythonPath).catch(() => ({
      version: "",
      cuda: "",
      available: false,
      torchaudioOk: false,
      torchaudioVersion: "",
    }));
    if (after.cuda && after.torchaudioOk) {
      return;
    }
  }

  throw new Error("Wan2GP detected an NVIDIA GPU, but CUDA-enabled PyTorch could not be installed in the runtime environment.");
}

async function patchWanAttentionCudaFallback(): Promise<void> {
  const attentionPath = path.join(wanAppRoot, "shared", "attention.py");
  let source = await fs.readFile(attentionPath, "utf-8");
  let patched = false;

  const replacementTopLevel = [
    "if _is_mps:",
    "    major, minor = (0, 0)",
    "else:",
    "    try:",
    "        major, minor = torch.cuda.get_device_capability(None)",
    "    except Exception:",
    "        major, minor = (0, 0)",
  ].join("\n");

  const topLevelNeedle = "major, minor = (0, 0) if _is_mps else torch.cuda.get_device_capability(None)";
  if (source.includes(topLevelNeedle)) {
    source = source.replace(topLevelNeedle, replacementTopLevel);
    patched = true;
  }

  const replacementModes = [
    "    try:",
    "        major, minor = torch.cuda.get_device_capability()",
    "    except Exception:",
    "        major, minor = (0, 0)",
  ].join("\n");
  const modesNeedle = "    major, minor = torch.cuda.get_device_capability()";
  if (source.includes(modesNeedle)) {
    source = source.replace(modesNeedle, replacementModes);
    patched = true;
  }

  if (patched) {
    await fs.writeFile(attentionPath, source, "utf-8");
  }
}

async function checkWanApiReady(): Promise<boolean> {
  const pythonPath = getWanPythonPath();
  try {
    await fs.access(pythonPath);
  } catch {
    return false;
  }

  const smokeScript = path.join(wanAppRoot, ".nexus_api_smoke.py");
  await fs.mkdir(wanAppRoot, { recursive: true });
  await fs.writeFile(smokeScript, [
    "from shared.api import init",
    "session = init(root='.', cli_args=['--attention', 'sdpa', '--profile', '4'], console_output=False, console_isatty=False)",
    "session.close()",
    "print('ok')",
  ].join("\n"), "utf-8");

  try {
    await execFileAsync(pythonPath, [smokeScript], {
      cwd: wanAppRoot,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 256 * 1024,
    });
    lastWanReadinessError = null;
    return true;
  } catch (error) {
    lastWanReadinessError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export async function getWan2GpModelCatalog(forceRefresh = false): Promise<Wan2GpModelCatalog> {
  const now = Date.now();
  if (!forceRefresh && wanModelCatalogCache && (now - wanModelCatalogCacheAt) < wanModelCatalogCacheTtlMs) {
    return wanModelCatalogCache;
  }

  const status = await getWan2GpStatus();
  if (!status.installed || !status.envReady || !status.apiReady) {
    const empty: Wan2GpModelCatalog = { image: [], video: [], scannedAt: new Date().toISOString() };
    wanModelCatalogCache = empty;
    wanModelCatalogCacheAt = now;
    return empty;
  }

  const scriptPath = path.join(wanAppRoot, ".nexus_model_catalog.py");
  const marker = "NEXUS_MODEL_CATALOG:";
  await fs.writeFile(scriptPath, [
    "import json",
    "from shared.api import init",
    "",
    "def rows_for(session, output_mode):",
    "    defs = session.list_model_defs(main_output=output_mode)",
    "    availability = session.list_model_availability(main_output=output_mode)",
    "    availability_by_model = {}",
    "    for entry in availability:",
    "        model_type = str((entry or {}).get('model_type', '')).strip()",
    "        if model_type:",
    "            availability_by_model[model_type] = entry or {}",
    "",
    "    rows = []",
    "    for entry in defs:",
    "        model_type = str((entry or {}).get('model_type', '')).strip()",
    "        if not model_type:",
    "            continue",
    "        availability_entry = availability_by_model.get(model_type, {})",
    "        rows.append({",
    "            'model_type': model_type,",
    "            'available': bool(availability_entry.get('available', False)),",
    "            'status': str(availability_entry.get('status', 'unknown')),",
    "        })",
    "    return rows",
    "",
    "session = init(root='.', cli_args=['--attention', 'sdpa', '--profile', '4'], console_output=False, console_isatty=False)",
    "payload = {",
    "    'image': rows_for(session, 'image'),",
    "    'video': rows_for(session, 'video'),",
    "}",
    "session.close()",
    "print('NEXUS_MODEL_CATALOG:' + json.dumps(payload), flush=True)",
  ].join("\n"), "utf-8");

  const { stdout } = await execFileAsync(getWanPythonPath(), [scriptPath], {
    cwd: wanAppRoot,
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });

  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(marker));

  if (!line) {
    throw new Error("Wan2GP model catalog probe did not return a parseable payload.");
  }

  const parsed = JSON.parse(line.slice(marker.length)) as {
    image?: Array<{ model_type?: unknown; available?: unknown; status?: unknown }>;
    video?: Array<{ model_type?: unknown; available?: unknown; status?: unknown }>;
  };

  const toRows = (rows: Array<{ model_type?: unknown; available?: unknown; status?: unknown }> | undefined): Wan2GpModelCatalogEntry[] => {
    return (rows ?? [])
      .map((row) => ({
        modelType: String(row.model_type ?? "").trim(),
        available: Boolean(row.available),
        status: String(row.status ?? "unknown"),
      }))
      .filter((row) => row.modelType.length > 0);
  };

  const catalog: Wan2GpModelCatalog = {
    image: toRows(parsed.image),
    video: toRows(parsed.video),
    scannedAt: new Date().toISOString(),
  };
  wanModelCatalogCache = catalog;
  wanModelCatalogCacheAt = now;
  return catalog;
}

function buildWanScript(input: Wan2GpGenerateInput): string {
  const mode = input.mode;
  return [
    "import json",
    "import os",
    "from pathlib import Path",
    "",
    "from shared.api import init",
    "",
    "def emit_status(message: str):",
    "    print('NEXUS_STATUS:' + message, flush=True)",
    "",
    "def emit_result(payload):",
    "    print('NEXUS_RESULT:' + json.dumps(payload), flush=True)",
    "",
    "root = Path(os.environ['NEXUS_WAN_ROOT'])",
    "mode = os.environ['NEXUS_WAN_MODE']",
    "prompt = os.environ['NEXUS_WAN_PROMPT']",
    "negative_prompt = os.environ.get('NEXUS_WAN_NEGATIVE_PROMPT', '')",
    "model_type = os.environ.get('NEXUS_WAN_MODEL', '').strip()",
    "width = int(os.environ['NEXUS_WAN_WIDTH'])",
    "height = int(os.environ['NEXUS_WAN_HEIGHT'])",
    "steps = int(os.environ['NEXUS_WAN_STEPS'])",
    "seed = int(os.environ['NEXUS_WAN_SEED'])",
    "profile = int(os.environ.get('NEXUS_WAN_PROFILE', '4'))",
    "duration_seconds = int(os.environ.get('NEXUS_WAN_DURATION', '4'))",
    "fps = int(os.environ.get('NEXUS_WAN_FPS', '16'))",
    "frame_count = int(os.environ.get('NEXUS_WAN_FRAMES', '49'))",
    "",
    "emit_status('Initializing WanGP session...')",
    "session = init(root=root, cli_args=['--attention', 'sdpa', '--profile', str(profile)], console_output=False, console_isatty=False)",
    "",
    "settings = {",
    "    'prompt': prompt,",
    "    'resolution': f'{width}x{height}',",
    "    'num_inference_steps': steps,",
    "    'seed': seed,",
    "}",
    "target_output = 'image' if mode == 'image' else 'video'",
    "available_model_types = []",
    "installed_model_types = []",
    "try:",
    "    model_defs = session.list_model_defs(main_output=target_output)",
    "    available_model_types = [str((item or {}).get('model_type', '')).strip() for item in model_defs]",
    "    available_model_types = [item for item in available_model_types if item]",
    "    availability = session.list_model_availability(main_output=target_output)",
    "    installed_model_types = [str((item or {}).get('model_type', '')).strip() for item in availability if bool((item or {}).get('available', False))]",
    "    installed_model_types = [item for item in installed_model_types if item]",
    "except Exception:",
    "    available_model_types = []",
    "    installed_model_types = []",
    "preferred_image_models = ['flux_schnell', 'alpha_sf', 'alpha2_sf', 'flux', 'alpha2', 'alpha', 'qwen_image_20B']",
    "preferred_video_models = ['t2v_1.3B', 't2v_sf', 'fun_inp_1.3B', 'hunyuan', 'animate', 'alpha2']",
    "if model_type:",
    "    if available_model_types and model_type not in available_model_types:",
    "        preview = ', '.join(available_model_types[:24])",
    "        raise RuntimeError(f\"Requested model_type '{model_type}' is unavailable. Available: {preview}\")",
    "    if installed_model_types and model_type not in installed_model_types:",
    "        preview = ', '.join(installed_model_types[:24])",
    "        raise RuntimeError(f\"Requested model_type '{model_type}' is not installed locally. Installed: {preview}\")",
    "else:",
    "    preferred_models = preferred_image_models if mode == 'image' else preferred_video_models",
    "    for candidate in preferred_models:",
    "        if candidate in installed_model_types:",
    "            model_type = candidate",
    "            break",
    "    if not model_type and installed_model_types:",
    "        model_type = installed_model_types[0]",
    "if not model_type:",
    "    raise RuntimeError('No installed model_type available for this mode. Install a Wan2GP model and retry.')",
    "emit_status(f'Installed model count for {target_output}: {len(installed_model_types)}')",
    "emit_status(f'Using model_type: {model_type}')",
    "if negative_prompt:",
    "    settings['negative_prompt'] = negative_prompt",
    "    settings['n_prompt'] = negative_prompt",
    "settings['model_type'] = model_type",
    "",
    "if mode == 'image':",
    "    settings['image_mode'] = 1",
    "else:",
    "    settings['video_length'] = frame_count",
    "    settings['duration_seconds'] = duration_seconds",
    "    settings['force_fps'] = fps",
    "",
    "job = session.submit_task(settings)",
    "",
    "for event in job.events.iter(timeout=0.2):",
    "    if event.kind == 'progress':",
    "        progress = event.data",
    "        emit_status(f'{progress.phase} {progress.progress}% step {progress.current_step}/{progress.total_steps}')",
    "    elif event.kind == 'status':",
    "        emit_status(str(event.data))",
    "",
    "result = job.result()",
    "session.close()",
    "",
    "if not result.success:",
    "    messages = [error.message for error in result.errors]",
    "    raise RuntimeError('; '.join(messages) if messages else 'Wan2GP generation failed')",
    "",
    "generated_files = [str(Path(item)) for item in result.generated_files]",
    mode === "image"
      ? "candidates = [item for item in generated_files if item.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]"
      : "candidates = [item for item in generated_files if item.lower().endswith(('.mp4', '.webm', '.mov', '.mkv', '.avi'))]",
    "if not candidates:",
    "    raise RuntimeError('Wan2GP finished but no expected output file was produced.')",
    "output_path = candidates[-1]",
    "emit_result({'output_path': output_path, 'model_type': model_type})",
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

export async function getWan2GpStatus(): Promise<Wan2GpStatus> {
  const pythonPath = getWanPythonPath();
  const installed = await fs.access(path.join(wanAppRoot, "wgp.py")).then(() => true).catch(() => false);
  const envReady = await fs.access(pythonPath).then(() => true).catch(() => false);
  const apiReady = installed && envReady ? await checkWanApiReady() : false;

  const notes: string[] = [];
  if (!installed) {
    notes.push("Wan2GP repo is not installed yet.");
  }
  if (installed && !envReady) {
    notes.push("Wan2GP repo exists but Python environment is missing.");
  }
  if (installed && envReady && !apiReady) {
    notes.push("Wan2GP environment exists but shared API import failed. Reinstall dependencies.");
    if (lastWanReadinessError) {
      notes.push(`Readiness check error: ${lastWanReadinessError}`);
    }
  }
  if (apiReady) {
    notes.push("Image + video generation is available via in-process WanGP API.");
    notes.push("Wan2GP includes several TTS modules, but Nexus currently keeps Piper as the stable production voice engine.");
    notes.push("STT support is not exposed through a stable WanGP API surface yet.");
  }

  return {
    installed,
    envReady,
    apiReady,
    appRoot: wanAppRoot,
    pythonPath: envReady ? pythonPath : null,
    supports: {
      image: apiReady,
      video: apiReady,
      tts: apiReady,
      stt: false,
    },
    notes,
  };
}

export async function installWan2Gp(): Promise<void> {
  await ensureWanRepo();
  await ensureWanEnv();
  await patchWanAttentionCudaFallback();
}

export async function startWan2GpIfNeeded(): Promise<void> {
  const status = await getWan2GpStatus();
  if (status.apiReady) {
    return;
  }
  if (!status.installed || !status.envReady) {
    throw new Error("Wan2GP is not installed. Run install first.");
  }
  const ready = await checkWanApiReady();
  if (!ready) {
    throw new Error(`Wan2GP API readiness check failed.${lastWanReadinessError ? ` ${lastWanReadinessError}` : ""}`);
  }
}

export async function generateWithWan2GpStreaming(
  input: Wan2GpGenerateInput,
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<Wan2GpGenerateResult> {
  const status = await getWan2GpStatus();
  if (!status.apiReady) {
    throw new Error("Wan2GP is not ready. Install or repair runtime first.");
  }

  const mode: Wan2GpMode = input.mode;
  const width = clampInt(input.width, 256, mode === "image" ? 1280 : 1024);
  const height = clampInt(input.height, 256, mode === "image" ? 1280 : 1024);
  const steps = clampInt(input.steps, 1, 60);
  const seed = Number.isFinite(input.seed) ? Math.round(input.seed) : Math.floor(Date.now() % 2147483647);
  const profile = clampInt(input.profile, 1, 5);
  const fps = clampInt(input.fps ?? 16, 8, 32);
  const durationSeconds = clampInt(input.durationSeconds ?? 4, 1, 12);
  const frameCount = clampInt(input.frameCount ?? (fps * durationSeconds + 1), 17, 193);
  const normalizedModel = normalizeWanModel(input.model);
  const maxDurationMs = mode === "image" ? 12 * 60 * 1000 : 20 * 60 * 1000;
  const inactivityTimeoutMs = 2 * 60 * 1000;
  const heartbeatIntervalMs = 20 * 1000;

  await fs.mkdir(wanAppRoot, { recursive: true });
  const scriptPath = path.join(wanAppRoot, `.nexus-generate-${mode}.py`);
  await fs.writeFile(scriptPath, buildWanScript({
    ...input,
    width,
    height,
    steps,
    seed,
    profile,
    fps,
    durationSeconds,
    frameCount,
  }), "utf-8");

  onStatus(`Starting Wan2GP ${mode} generation...`);

  const child = spawn(getWanPythonPath(), [scriptPath], {
    cwd: wanAppRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      NEXUS_WAN_ROOT: wanAppRoot,
      NEXUS_WAN_MODE: mode,
      NEXUS_WAN_PROMPT: input.prompt,
      NEXUS_WAN_NEGATIVE_PROMPT: input.negativePrompt ?? "",
      NEXUS_WAN_MODEL: normalizedModel,
      NEXUS_WAN_WIDTH: String(width),
      NEXUS_WAN_HEIGHT: String(height),
      NEXUS_WAN_STEPS: String(steps),
      NEXUS_WAN_SEED: String(seed),
      NEXUS_WAN_PROFILE: String(profile),
      NEXUS_WAN_DURATION: String(durationSeconds),
      NEXUS_WAN_FPS: String(fps),
      NEXUS_WAN_FRAMES: String(frameCount),
      WAN_GP_DISABLE_UI: "1",
    },
  });

  return await new Promise<Wan2GpGenerateResult>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let resultPayload: { output_path: string; model_type?: string } | null = null;
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
      onStatus("Cancellation requested. Stopping Wan2GP process...");
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
        onStatus(`Wan2GP watchdog: no output for ${Math.round(idleMs / 1000)}s. Aborting generation.`);
        if (child.pid) {
          void terminateChild(child.pid);
        }
        failOnce(new Error("Wan2GP generation stalled without output for too long. Try a lighter model/profile or retry."));
        return;
      }

      if (elapsedMs > maxDurationMs) {
        onStatus(`Wan2GP watchdog: generation exceeded ${Math.round(maxDurationMs / 60000)} minute limit. Aborting.`);
        if (child.pid) {
          void terminateChild(child.pid);
        }
        failOnce(new Error("Wan2GP generation timed out before completion. Try fewer steps, lower resolution, or a lighter model."));
        return;
      }

      onStatus(`Wan2GP still running (${Math.round(elapsedMs / 1000)}s elapsed).`);
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
            resultPayload = JSON.parse(line.slice("NEXUS_RESULT:".length).trim()) as { output_path: string; model_type?: string };
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
        reject(new Error("Wan2GP generation canceled by user."));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderrBuffer.trim() || `Wan2GP process failed with exit code ${code ?? "unknown"}.`));
        return;
      }
      if (!resultPayload?.output_path) {
        reject(new Error("Wan2GP finished without returning an output file path."));
        return;
      }

      resolve({
        outputPath: resultPayload.output_path,
        mode,
        provider: "wan2gp",
        model: resultPayload.model_type?.trim() || normalizedModel || "auto",
        width,
        height,
        steps,
        seed,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt ?? "",
        profile,
        durationSeconds: mode === "video" ? durationSeconds : undefined,
        fps: mode === "video" ? fps : undefined,
        frameCount: mode === "video" ? frameCount : undefined,
      });
    });
  });
}

export function inferMediaExtension(filePath: string, fallback: "png" | "mp4"): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (!ext) {
    return fallback;
  }
  return ext;
}

export async function readMediaBytes(filePath: string): Promise<Buffer> {
  return await fs.readFile(filePath);
}

export async function getMachineProfileHint(): Promise<{ logicalCores: number; totalRamGb: number; recommendedProfile: number }> {
  const logicalCores = Math.max(1, os.cpus().length);
  const totalRamGb = Math.max(1, Math.round(os.totalmem() / (1024 ** 3)));
  const recommendedProfile = totalRamGb <= 16 ? 4 : totalRamGb <= 32 ? 3 : 2;
  return { logicalCores, totalRamGb, recommendedProfile };
}
