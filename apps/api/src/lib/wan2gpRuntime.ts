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
    "print('ok')",
  ].join("\n"), "utf-8");

  try {
    await execFileAsync(pythonPath, [smokeScript], {
      cwd: wanAppRoot,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 256 * 1024,
    });
    lastWanReadinessError = null;
    return true;
  } catch (error) {
    lastWanReadinessError = error instanceof Error ? error.message : String(error);
    return false;
  }
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
    "if negative_prompt:",
    "    settings['negative_prompt'] = negative_prompt",
    "    settings['n_prompt'] = negative_prompt",
    "if model_type:",
    "    settings['model_type'] = model_type",
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
    "emit_result({'output_path': output_path})",
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
      NEXUS_WAN_MODEL: input.model?.trim() ?? "",
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
    let resultPayload: { output_path: string } | null = null;
    let canceled = false;

    const onAbort = () => {
      canceled = true;
      onStatus("Cancellation requested. Stopping Wan2GP process...");
      if (child.pid) {
        void terminateChild(child.pid);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });

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
            resultPayload = JSON.parse(line.slice("NEXUS_RESULT:".length).trim()) as { output_path: string };
          } catch {
            // Ignore malformed payload lines.
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
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
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
        model: (input.model?.trim() || "auto"),
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
