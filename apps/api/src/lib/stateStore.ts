import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SystemState } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../");

const systemStatePath = path.join(rootDir, "data", "system-state.local.json");
const systemStateTemplatePath = path.join(rootDir, "data", "system-state.template.json");

async function ensureSystemStateFile(): Promise<void> {
  try {
    await fs.access(systemStatePath);
  } catch {
    const template = await fs.readFile(systemStateTemplatePath, "utf-8");
    await fs.writeFile(systemStatePath, template, "utf-8");
  }
}

export async function readSystemState(): Promise<SystemState> {
  await ensureSystemStateFile();
  const raw = await fs.readFile(systemStatePath, "utf-8");
  return JSON.parse(raw) as SystemState;
}

export async function writeSystemState(state: SystemState): Promise<void> {
  await ensureSystemStateFile();
  await fs.writeFile(systemStatePath, JSON.stringify(state, null, 2), "utf-8");
}

export function getRootDir(): string {
  return rootDir;
}