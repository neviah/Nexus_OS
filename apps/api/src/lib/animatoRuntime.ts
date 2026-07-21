import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRootDir } from "./stateStore.js";

const execFileAsync = promisify(execFile);

const animatoRoot = path.join(getRootDir(), "vendor", "animato");
const animatoVenvRoot = path.join(animatoRoot, "env");
const animatoRepoUrl = "https://github.com/otdnnc/Animato.git";
const animatoPort = Number(process.env.NEXUS_ANIMATO_PORT ?? 8010);
const animatoBaseUrl = `http://127.0.0.1:${animatoPort}`;
let lastAnimatoReadinessError: string | null = null;

export type AnimatoStatus = {
  installed: boolean;
  envReady: boolean;
  apiReady: boolean;
  appRoot: string;
  pythonPath: string | null;
  baseUrl: string;
  notes: string[];
};

function getAnimatoPythonPath(): string {
  return process.platform === "win32"
    ? path.join(animatoVenvRoot, "Scripts", "python.exe")
    : path.join(animatoVenvRoot, "bin", "python");
}

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveSystemPython(): Promise<{ command: string; argsPrefix: string[]; versionLabel: string }> {
  if (process.platform === "win32") {
    const candidates: Array<{ argsPrefix: string[]; versionLabel: string }> = [
      { argsPrefix: ["-3.13"], versionLabel: "3.13" },
      { argsPrefix: ["-3.12"], versionLabel: "3.12" },
      { argsPrefix: ["-3.11"], versionLabel: "3.11" },
    ];

    for (const candidate of candidates) {
      if (await commandWorks("py", [...candidate.argsPrefix, "-V"])) {
        return { command: "py", argsPrefix: candidate.argsPrefix, versionLabel: candidate.versionLabel };
      }
    }

    throw new Error("Python 3.11+ is required for Animato on Windows. Install Python and retry.");
  }

  const unixCandidates: Array<{ command: string; versionLabel: string }> = [
    { command: "python3.13", versionLabel: "3.13" },
    { command: "python3.12", versionLabel: "3.12" },
    { command: "python3.11", versionLabel: "3.11" },
  ];
  for (const candidate of unixCandidates) {
    if (await commandWorks(candidate.command, ["-V"])) {
      return { command: candidate.command, argsPrefix: [], versionLabel: candidate.versionLabel };
    }
  }

  throw new Error("Python 3.11+ is required for Animato. Install python3.11 or newer and retry.");
}

async function ensureAnimatoRepo(): Promise<void> {
  await fs.mkdir(path.dirname(animatoRoot), { recursive: true });
  const gitDir = path.join(animatoRoot, ".git");

  try {
    await fs.access(gitDir);
    await execFileAsync("git", ["-C", animatoRoot, "fetch", "origin", "main"], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await execFileAsync("git", ["-C", animatoRoot, "reset", "--hard", "origin/main"], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    return;
  } catch {
    // Fall back to clone.
  }

  await fs.rm(animatoRoot, { recursive: true, force: true });
  await execFileAsync("git", ["clone", "--depth", "1", animatoRepoUrl, animatoRoot], {
    windowsHide: true,
    timeout: 20 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function ensureAnimatoEnv(): Promise<void> {
  const pythonPath = getAnimatoPythonPath();
  try {
    await fs.access(pythonPath);
  } catch {
    const python = await resolveSystemPython();
    await execFileAsync(python.command, [...python.argsPrefix, "-m", "venv", animatoVenvRoot], {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
  }

  await execFileAsync(pythonPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools<75", "wheel"], {
    cwd: animatoRoot,
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });

  const pyprojectPath = path.join(animatoRoot, "pyproject.toml");
  const requirementsPath = path.join(animatoRoot, "requirements.txt");
  const hasPyproject = await fs.access(pyprojectPath).then(() => true).catch(() => false);
  const hasRequirements = await fs.access(requirementsPath).then(() => true).catch(() => false);

  if (hasPyproject) {
    await execFileAsync(pythonPath, ["-m", "pip", "install", "--prefer-binary", "-e", "."], {
      cwd: animatoRoot,
      windowsHide: true,
      timeout: 120 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 32,
    });
    return;
  }

  if (hasRequirements) {
    await execFileAsync(pythonPath, ["-m", "pip", "install", "--prefer-binary", "-r", "requirements.txt"], {
      cwd: animatoRoot,
      windowsHide: true,
      timeout: 120 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 32,
    });
    return;
  }

  throw new Error("Animato dependency manifest not found (pyproject.toml or requirements.txt).");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkAnimatoApiReady(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${animatoBaseUrl}/api/files`, 3500);
    if (!response.ok) {
      lastAnimatoReadinessError = `Animato API returned HTTP ${response.status}`;
      return false;
    }
    lastAnimatoReadinessError = null;
    return true;
  } catch (error) {
    lastAnimatoReadinessError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export function getAnimatoBaseUrl(): string {
  return animatoBaseUrl;
}

export async function getAnimatoStatus(): Promise<AnimatoStatus> {
  const pythonPath = getAnimatoPythonPath();
  const installed = await fs.access(path.join(animatoRoot, "main.py")).then(() => true).catch(() => false);
  const envReady = await fs.access(pythonPath).then(() => true).catch(() => false);
  const apiReady = installed && envReady ? await checkAnimatoApiReady() : false;

  const notes: string[] = [];
  if (!installed) {
    notes.push("Animato repo is not installed yet.");
  }
  if (installed && !envReady) {
    notes.push("Animato repo exists but Python environment is missing.");
  }
  if (installed && envReady && !apiReady) {
    notes.push("Animato environment exists but API is not reachable.");
    if (lastAnimatoReadinessError) {
      notes.push(`Readiness check error: ${lastAnimatoReadinessError}`);
    }
  }
  if (apiReady) {
    notes.push("Animato API is reachable for model upload/prompt/run animation workflow.");
  }

  return {
    installed,
    envReady,
    apiReady,
    appRoot: animatoRoot,
    pythonPath: envReady ? pythonPath : null,
    baseUrl: animatoBaseUrl,
    notes,
  };
}

export async function installAnimato(): Promise<void> {
  await ensureAnimatoRepo();
  await ensureAnimatoEnv();
}

export async function startAnimatoIfNeeded(): Promise<void> {
  if (await checkAnimatoApiReady()) {
    return;
  }

  const status = await getAnimatoStatus();
  if (!status.installed || !status.envReady) {
    throw new Error("Animato is not installed. Run install first.");
  }

  const pythonPath = getAnimatoPythonPath();
  const child = spawn(pythonPath, ["-m", "fastapi", "run", "main.py", "--host", "127.0.0.1", "--port", String(animatoPort)], {
    cwd: animatoRoot,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
  });
  child.unref();

  const startedAt = Date.now();
  const timeoutMs = 30_000;
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkAnimatoApiReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Animato API did not become ready in ${Math.round(timeoutMs / 1000)}s.${lastAnimatoReadinessError ? ` ${lastAnimatoReadinessError}` : ""}`);
}
