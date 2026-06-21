import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRootDir } from "./stateStore.js";

const execFileAsync = promisify(execFile);
const runtimeRoot = path.join(getRootDir(), "data", "runtime-tools");
const piperRoot = path.join(runtimeRoot, "piper");
const piperVoicesRoot = path.join(piperRoot, "voices");
const defaultPiperVoiceBase = "en_US-lessac-medium";
const defaultPiperVoiceModel = `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${defaultPiperVoiceBase}.onnx`;
const defaultPiperVoiceConfig = `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${defaultPiperVoiceBase}.onnx.json`;
const piperReleaseZip = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

export type RuntimeStatus = {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaModels: string[];
  piperInstalled: boolean;
  piperPath: string | null;
  piperVoices: string[];
  defaultVoiceInstalled: boolean;
};

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const ollamaInstalled = await commandWorks("ollama", ["--version"]);
  const ollamaRunning = ollamaInstalled ? await commandWorks("ollama", ["list"]) : false;
  const ollamaModels = ollamaRunning ? await getOllamaModels() : [];
  const piperPath = await resolvePiperPath();
  const piperInstalled = Boolean(piperPath);
  const piperVoices = await getInstalledPiperVoices();

  return {
    ollamaInstalled,
    ollamaRunning,
    ollamaModels,
    piperInstalled,
    piperPath,
    piperVoices,
    defaultVoiceInstalled: piperVoices.includes(defaultPiperVoiceBase),
  };
}

export async function installOllama(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automated Ollama install is currently implemented for Windows only.");
  }
  await execFileAsync("winget", ["install", "--id", "Ollama.Ollama", "-e", "--accept-package-agreements", "--accept-source-agreements"], {
    windowsHide: true,
    timeout: 20 * 60 * 1000,
  });
}

export async function startOllamaIfNeeded(): Promise<void> {
  if (await commandWorks("ollama", ["list"])) {
    return;
  }

  spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await commandWorks("ollama", ["list"])) {
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
  await execFileAsync("ollama", ["pull", modelName], {
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
  await fs.mkdir(piperVoicesRoot, { recursive: true });
  await downloadFile(defaultPiperVoiceModel, path.join(piperVoicesRoot, `${defaultPiperVoiceBase}.onnx`));
  await downloadFile(defaultPiperVoiceConfig, path.join(piperVoicesRoot, `${defaultPiperVoiceBase}.onnx.json`));
}

export async function synthesizeWithPiper(text: string): Promise<{ audioBase64: string; mimeType: string }> {
  const piperPath = await resolvePiperPath();
  if (!piperPath) {
    throw new Error("Piper is not installed.");
  }

  const voicePath = path.join(piperVoicesRoot, `${defaultPiperVoiceBase}.onnx`);
  const voiceConfigPath = path.join(piperVoicesRoot, `${defaultPiperVoiceBase}.onnx.json`);
  await fs.access(voicePath);
  await fs.access(voiceConfigPath);

  const outputPath = path.join(runtimeRoot, `piper-preview-${Date.now()}.wav`);
  await fs.mkdir(runtimeRoot, { recursive: true });

  await execFileAsync(piperPath, [
    "--model",
    voicePath,
    "--config",
    voiceConfigPath,
    "--output_file",
    outputPath,
    "--sentence_silence",
    "0.2",
  ], {
    input: text,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  } as never);

  const bytes = await fs.readFile(outputPath);
  await fs.rm(outputPath, { force: true });
  return {
    audioBase64: bytes.toString("base64"),
    mimeType: "audio/wav",
  };
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

async function getOllamaModels(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("ollama", ["list"], { windowsHide: true, timeout: 10000 });
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

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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
