import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getWorkspaceById } from "./workspaceManager.js";
import type { SystemState } from "../types.js";

const execFileAsync = promisify(execFile);

type CookbookRecommendation = {
  id: string;
  name: string;
  category: "coding" | "chat" | "voice";
  size: "small" | "medium" | "large";
  runtime: "ollama" | "llama.cpp" | "piper";
  summary: string;
  fitReason: string;
  installHint: string;
};

export type CookbookSnapshot = {
  workspace: {
    id: string;
    path: string;
  } | null;
  machine: {
    platform: string;
    arch: string;
    cpuModel: string;
    logicalCores: number;
    totalRamGb: number;
    freeRamGb: number;
    freeDiskGb: number | null;
    gpuNames: string[];
  };
  runtimes: {
    ollamaInstalled: boolean;
    piperInstalled: boolean;
  };
  recommendations: CookbookRecommendation[];
  scannedAt: string;
};

export type VoiceStatus = {
  piperInstalled: boolean;
  piperPath: string | null;
  browserSpeechRecommended: boolean;
  notes: string[];
  scannedAt: string;
};

export async function buildCookbookSnapshot(state: SystemState): Promise<CookbookSnapshot> {
  const workspaceRecord = await getWorkspaceById(state.activeWorkspaceId);
  const totalRamGb = toGb(os.totalmem());
  const freeRamGb = toGb(os.freemem());
  const freeDiskGb = workspaceRecord ? await getFreeDiskGb(workspaceRecord.path) : null;
  const gpuNames = await getGpuNames();
  const ollamaInstalled = await commandExists("ollama", ["--version"]);
  const piperResolution = await resolvePiper();

  return {
    workspace: workspaceRecord ? { id: workspaceRecord.id, path: workspaceRecord.path } : null,
    machine: {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? "Unknown CPU",
      logicalCores: os.cpus().length,
      totalRamGb,
      freeRamGb,
      freeDiskGb,
      gpuNames,
    },
    runtimes: {
      ollamaInstalled,
      piperInstalled: Boolean(piperResolution.path),
    },
    recommendations: buildRecommendations({ totalRamGb, gpuNames, ollamaInstalled, piperInstalled: Boolean(piperResolution.path) }),
    scannedAt: new Date().toISOString(),
  };
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  const piperResolution = await resolvePiper();
  const notes = [
    "Browser speech works immediately for quick playback inside NexusOS.",
    piperResolution.path
      ? `Piper detected at ${piperResolution.path}. Local offline voice generation is available for a future backend bridge.`
      : "Piper not detected. Install Piper later for better offline voices and file generation.",
  ];

  return {
    piperInstalled: Boolean(piperResolution.path),
    piperPath: piperResolution.path,
    browserSpeechRecommended: true,
    notes,
    scannedAt: new Date().toISOString(),
  };
}

function buildRecommendations(input: {
  totalRamGb: number;
  gpuNames: string[];
  ollamaInstalled: boolean;
  piperInstalled: boolean;
}): CookbookRecommendation[] {
  const hasGpu = input.gpuNames.length > 0;
  const list: CookbookRecommendation[] = [];

  if (input.totalRamGb >= 28) {
    list.push({
      id: "coding-qwen3-coder-30b",
      name: "Qwen3 Coder 30B",
      category: "coding",
      size: "large",
      runtime: "ollama",
      summary: "Strong local coding model for bigger Windows desktops.",
      fitReason: hasGpu
        ? "You have enough memory headroom and a detected GPU, so a larger coding model is realistic."
        : "You have enough RAM for a larger local coding model, though GPU acceleration would help.",
      installHint: "Try Ollama with a larger coding model once local runtime integration is added.",
    });
  }

  if (input.totalRamGb >= 14) {
    list.push({
      id: "coding-qwen2-5-coder-7b",
      name: "Qwen2.5 Coder 7B",
      category: "coding",
      size: "medium",
      runtime: "ollama",
      summary: "Balanced local coding fallback when cloud-free tokens run low.",
      fitReason: "This is the safest default coding fallback for mid-range machines.",
      installHint: input.ollamaInstalled ? "Ollama already appears to be installed." : "Install Ollama first, then pull a 7B coding model.",
    });
  }

  list.push({
    id: "chat-llama3-2-3b",
    name: "Llama 3.2 3B",
    category: "chat",
    size: "small",
    runtime: "ollama",
    summary: "Very lightweight local fallback for general chat and utility tasks.",
    fitReason: "Small models keep NexusOS usable on almost any machine.",
    installHint: input.ollamaInstalled ? "Good zero-cost fallback once a local runtime is configured." : "Install Ollama for the easiest local chat fallback path.",
  });

  list.push({
    id: "voice-piper",
    name: "Piper Voice",
    category: "voice",
    size: "small",
    runtime: "piper",
    summary: "Offline text-to-speech with much better control than browser voices.",
    fitReason: input.piperInstalled
      ? "Piper is already detected, so offline voice can become a first-class tool quickly."
      : "Piper is the best low-cost offline voice path for NexusOS.",
    installHint: input.piperInstalled ? "Piper is already present on this machine." : "Install Piper when you want better local TTS voices and file export.",
  });

  return list;
}

async function getGpuNames(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
    ], { windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getFreeDiskGb(targetPath: string): Promise<number | null> {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const drive = path.parse(path.resolve(targetPath)).root.replace(/\\$/, "");
    const command = `(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='${drive}'\").FreeSpace`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    const bytes = Number(stdout.trim());
    return Number.isFinite(bytes) ? toGb(bytes) : null;
  } catch {
    return null;
  }
}

async function resolvePiper(): Promise<{ path: string | null }> {
  const candidates = process.platform === "win32"
    ? [
      "piper.exe",
      path.join(os.homedir(), "piper", "piper.exe"),
      path.join(os.homedir(), ".local", "bin", "piper.exe"),
    ]
    : ["piper", path.join(os.homedir(), ".local", "bin", "piper")];

  for (const candidate of candidates) {
    if (await commandExists(candidate, ["--help"])) {
      return { path: candidate };
    }
    if (path.isAbsolute(candidate)) {
      try {
        await fs.access(candidate);
        return { path: candidate };
      } catch {
        // Continue.
      }
    }
  }

  return { path: null };
}

async function commandExists(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function toGb(bytes: number): number {
  return Math.round((bytes / (1024 ** 3)) * 10) / 10;
}
