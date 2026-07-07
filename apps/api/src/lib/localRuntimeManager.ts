import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRootDir } from "./stateStore.js";

const execFileAsync = promisify(execFile);
const runtimeRoot = path.join(getRootDir(), "data", "runtime-tools");
const acejamRoot = path.join(runtimeRoot, "acejam.pinokio");
const acejamAppRoot = path.join(acejamRoot, "app");
const acejamVenvRoot = path.join(acejamAppRoot, "env");
const acejamPort = 7860;
const acejamUrl = `http://127.0.0.1:${acejamPort}`;
const piperRoot = path.join(runtimeRoot, "piper");
const piperVoicesRoot = path.join(piperRoot, "voices");
const defaultPiperVoiceBase = "en_US-lessac-medium";
const bundledPiperVoices = [
  "en_US-lessac-low",
  "en_US-lessac-medium",
  "en_US-lessac-high",
];
const piperReleaseZip = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

export type RuntimeStatus = {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaModels: string[];
  acejamInstalled: boolean;
  acejamRunning: boolean;
  acejamUrl: string;
  piperInstalled: boolean;
  piperPath: string | null;
  piperVoices: string[];
  defaultVoiceInstalled: boolean;
};

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const ollamaPath = await resolveOllamaPath();
  const ollamaInstalled = Boolean(ollamaPath);
  const ollamaRunning = ollamaPath ? await commandWorks(ollamaPath, ["list"]) : false;
  const ollamaModels = ollamaRunning ? await getOllamaModels(ollamaPath ?? "ollama") : [];
  const acejamInstalled = await acejamLooksInstalled();
  const acejamRunning = await isAceJamRunning();
  const piperPath = await resolvePiperPath();
  const piperInstalled = Boolean(piperPath);
  const piperVoices = await getInstalledPiperVoices();

  return {
    ollamaInstalled,
    ollamaRunning,
    ollamaModels,
    acejamInstalled,
    acejamRunning,
    acejamUrl,
    piperInstalled,
    piperPath,
    piperVoices,
    defaultVoiceInstalled: piperVoices.includes(defaultPiperVoiceBase),
  };
}

export async function installAceJam(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automated AceJAM install is currently implemented for Windows only.");
  }

  const zipPath = path.join(runtimeRoot, "acejam.pinokio-main.zip");
  const tempExtractRoot = path.join(runtimeRoot, "acejam-extract");
  const extractedRepoRoot = path.join(tempExtractRoot, "acejam.pinokio-main");

  await fs.mkdir(runtimeRoot, { recursive: true });
  await downloadFile("https://github.com/cocktailpeanut/acejam.pinokio/archive/refs/heads/main.zip", zipPath);

  await fs.rm(tempExtractRoot, { recursive: true, force: true });
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Path '${escapePowerShell(zipPath)}' -DestinationPath '${escapePowerShell(tempExtractRoot)}' -Force`,
  ], { windowsHide: true, timeout: 10 * 60 * 1000 });

  await fs.rm(acejamRoot, { recursive: true, force: true });
  await fs.rename(extractedRepoRoot, acejamRoot);

  const python = await resolveSystemPython();
  await execFileAsync(python, ["-m", "venv", acejamVenvRoot], {
    windowsHide: true,
    timeout: 5 * 60 * 1000,
  });

  const venvPython = acejamPythonPath();
  await execFileAsync(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: acejamAppRoot,
    windowsHide: true,
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });
  await execFileAsync(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], {
    cwd: acejamAppRoot,
    windowsHide: true,
    timeout: 60 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 32,
  });
}

export async function startAceJamIfNeeded(): Promise<void> {
  if (await isAceJamRunning()) {
    return;
  }

  if (!(await acejamLooksInstalled())) {
    throw new Error("AceJAM is not installed yet.");
  }

  const python = acejamPythonPath();
  const cacheRoot = path.join(acejamRoot, "cache");
  const huggingFaceRoot = path.join(cacheRoot, "huggingface");

  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.mkdir(huggingFaceRoot, { recursive: true });

  spawn(python, ["app.py"], {
    cwd: acejamAppRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      GRADIO_ANALYTICS_ENABLED: "False",
      GRADIO_SERVER_NAME: "127.0.0.1",
      PYTHONUNBUFFERED: "1",
      XDG_CACHE_HOME: cacheRoot,
      HF_HOME: huggingFaceRoot,
      HF_MODULES_CACHE: path.join(cacheRoot, "hf_modules"),
      MPLCONFIGDIR: path.join(cacheRoot, "matplotlib"),
      LLAMA_CACHE: path.join(cacheRoot, "llama"),
    },
  }).unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isAceJamRunning()) {
      return;
    }
    await sleep(1000);
  }

  throw new Error("AceJAM did not become ready after start.");
}

export async function installOllama(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automated Ollama install is currently implemented for Windows only.");
  }

  const failures: string[] = [];

  try {
    await installOllamaViaWinget();
  } catch (error) {
    failures.push(`winget: ${String(error)}`);
  }

  if (await resolveOllamaPath()) {
    return;
  }

  try {
    await installOllamaViaDirectInstaller();
  } catch (error) {
    failures.push(`direct installer: ${String(error)}`);
  }

  if (await resolveOllamaPath()) {
    return;
  }

  throw new Error(`Ollama install failed. Attempts: ${failures.join(" | ") || "unknown"}`);
}

export async function startOllamaIfNeeded(): Promise<void> {
  const ollamaPath = await resolveOllamaPath();
  if (!ollamaPath) {
    throw new Error("Ollama is not installed yet.");
  }

  if (await commandWorks(ollamaPath, ["list"])) {
    return;
  }

  spawn(ollamaPath, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await commandWorks(ollamaPath, ["list"])) {
      return;
    }
    await sleep(1000);
  }

  throw new Error("Ollama did not become ready after start.");
}

export async function pullOllamaModel(modelName: string): Promise<void> {
  if (!modelName.trim()) {
    throw new Error("Model name is required.");
  }
  await startOllamaIfNeeded();
  const ollamaPath = await resolveOllamaPath();
  if (!ollamaPath) {
    throw new Error("Ollama executable was not found after startup.");
  }

  await execFileAsync(ollamaPath, ["pull", modelName], {
    windowsHide: true,
    timeout: 60 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 16,
  });
}

export async function installPiper(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automated Piper install is currently implemented for Windows only.");
  }

  await fs.mkdir(piperRoot, { recursive: true });
  const zipPath = path.join(piperRoot, "piper_windows_amd64.zip");
  await downloadFile(piperReleaseZip, zipPath);
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Path '${escapePowerShell(zipPath)}' -DestinationPath '${escapePowerShell(piperRoot)}' -Force`,
  ], { windowsHide: true, timeout: 10 * 60 * 1000 });
}

export async function installDefaultPiperVoice(): Promise<void> {
  for (const voiceId of bundledPiperVoices) {
    await installPiperVoice(voiceId);
  }
}

export async function synthesizeWithPiper(text: string, voiceId?: string): Promise<{ audioBase64: string; mimeType: string }> {
  const piperPath = await resolvePiperPath();
  if (!piperPath) {
    throw new Error("Piper is not installed.");
  }

  const { voicePath, voiceConfigPath } = await resolveVoiceFiles(voiceId);

  const outputPath = path.join(runtimeRoot, `piper-preview-${Date.now()}.wav`);
  await fs.mkdir(runtimeRoot, { recursive: true });

  await runPiperProcess(piperPath, [
    "--model",
    voicePath,
    "--config",
    voiceConfigPath,
    "--output_file",
    outputPath,
    "--sentence_silence",
    "0.2",
  ], text);

  const bytes = await fs.readFile(outputPath);
  await fs.rm(outputPath, { force: true });
  return {
    audioBase64: bytes.toString("base64"),
    mimeType: "audio/wav",
  };
}

export async function synthesizeWithPiperToFile(text: string, destinationPath: string, voiceId?: string): Promise<void> {
  const piperPath = await resolvePiperPath();
  if (!piperPath) {
    throw new Error("Piper is not installed.");
  }

  const { voicePath, voiceConfigPath } = await resolveVoiceFiles(voiceId);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });

  await runPiperProcess(piperPath, [
    "--model",
    voicePath,
    "--config",
    voiceConfigPath,
    "--output_file",
    destinationPath,
    "--sentence_silence",
    "0.2",
  ], text);
}

export async function resolvePiperPath(): Promise<string | null> {
  const candidates = process.platform === "win32"
    ? [
      path.join(piperRoot, "piper", "piper.exe"),
      path.join(piperRoot, "piper.exe"),
      "piper.exe",
      path.join(os.homedir(), "piper", "piper.exe"),
      path.join(os.homedir(), ".local", "bin", "piper.exe"),
    ]
    : ["piper", path.join(os.homedir(), ".local", "bin", "piper")];

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue.
      }
    } else if (await commandWorks(candidate, ["--help"])) {
      return candidate;
    }
  }

  return null;
}

async function getOllamaModels(ollamaCommand: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(ollamaCommand, ["list"], { windowsHide: true, timeout: 10000 });
    return stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s{2,}/)[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveOllamaPath(): Promise<string | null> {
  const candidates = process.platform === "win32"
    ? [
      "ollama.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe"),
      path.join(process.env.ProgramFiles ?? "", "Ollama", "ollama.exe"),
      path.join(process.env["ProgramFiles(x86)"] ?? "", "Ollama", "ollama.exe"),
    ]
    : ["ollama", "/usr/local/bin/ollama", "/usr/bin/ollama"];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (path.isAbsolute(candidate)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // continue
      }
    } else if (await commandWorks(candidate, ["--version"])) {
      return candidate;
    }
  }

  return null;
}

async function installOllamaViaWinget(): Promise<void> {
  await execFileAsync("winget", [
    "install",
    "--id",
    "Ollama.Ollama",
    "-e",
    "--silent",
    "--disable-interactivity",
    "--accept-package-agreements",
    "--accept-source-agreements",
  ], {
    windowsHide: true,
    timeout: 20 * 60 * 1000,
  });
}

async function installOllamaViaDirectInstaller(): Promise<void> {
  await fs.mkdir(runtimeRoot, { recursive: true });
  const installerPath = path.join(runtimeRoot, "OllamaSetup.exe");
  await downloadFile("https://ollama.com/download/OllamaSetup.exe", installerPath);

  const argVariants: string[][] = [
    ["/S"],
    ["/quiet"],
    ["/VERYSILENT", "/NORESTART"],
  ];

  let lastError: unknown = null;
  for (const args of argVariants) {
    try {
      await execFileAsync(installerPath, args, {
        windowsHide: true,
        timeout: 20 * 60 * 1000,
      });
      await sleep(2000);
      if (await resolveOllamaPath()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to run OllamaSetup.exe successfully. ${String(lastError ?? "No installer variant succeeded")}`);
}

async function installPiperVoice(voiceId: string): Promise<void> {
  const match = /^([a-z]{2})_([A-Z]{2})-([a-z0-9]+)-(low|medium|high)$/.exec(voiceId);
  if (!match) {
    throw new Error(`Unsupported Piper voice id: ${voiceId}`);
  }

  const [, lang, locale, speaker, quality] = match;
  const modelUrl = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${lang}_${locale}/${speaker}/${quality}/${voiceId}.onnx`;
  const configUrl = `${modelUrl}.json`;

  await fs.mkdir(piperVoicesRoot, { recursive: true });
  await downloadFile(modelUrl, path.join(piperVoicesRoot, `${voiceId}.onnx`));
  await downloadFile(configUrl, path.join(piperVoicesRoot, `${voiceId}.onnx.json`));
}

async function getInstalledPiperVoices(): Promise<string[]> {
  try {
    const entries = await fs.readdir(piperVoicesRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".onnx"))
      .map((entry) => entry.name.replace(/\.onnx$/, ""))
      .sort();
  } catch {
    return [];
  }
}

async function resolveVoiceFiles(voiceId?: string): Promise<{ voicePath: string; voiceConfigPath: string }> {
  const selectedVoice = (voiceId?.trim() || defaultPiperVoiceBase);
  const voicePath = path.join(piperVoicesRoot, `${selectedVoice}.onnx`);
  const voiceConfigPath = path.join(piperVoicesRoot, `${selectedVoice}.onnx.json`);
  await fs.access(voicePath);
  await fs.access(voiceConfigPath);
  return { voicePath, voiceConfigPath };
}

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function runPiperProcess(executable: string, args: string[], inputText: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Piper timed out while generating audio."));
    }, 120000);

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Piper failed with code ${code}: ${stderr.trim() || "unknown error"}`));
      }
    });

    child.stdin.write(`${inputText.trim()}\n`);
    child.stdin.end();
  });
}

async function acejamLooksInstalled(): Promise<boolean> {
  try {
    await fs.access(path.join(acejamAppRoot, "app.py"));
    await fs.access(path.join(acejamAppRoot, "requirements.txt"));
    return true;
  } catch {
    return false;
  }
}

async function isAceJamRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${acejamUrl}/`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function acejamPythonPath(): string {
  if (process.platform === "win32") {
    return path.join(acejamVenvRoot, "Scripts", "python.exe");
  }
  return path.join(acejamVenvRoot, "bin", "python");
}

async function resolveSystemPython(): Promise<string> {
  for (const candidate of ["py", "python", "python3"]) {
    if (await commandWorks(candidate, ["--version"])) {
      return candidate;
    }
  }
  throw new Error("Python is required to install AceJAM. Install Python 3.10+ and retry.");
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(destinationPath, Buffer.from(arrayBuffer));
}

function escapePowerShell(input: string): string {
  return input.replace(/'/g, "''");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
