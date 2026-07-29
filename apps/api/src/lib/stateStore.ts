import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SystemState } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../");

const systemStatePath = path.join(rootDir, "data", "system-state.local.json");
const systemStateBackupPath = path.join(rootDir, "data", "system-state.local.backup.json");
const systemStateTemplatePath = path.join(rootDir, "data", "system-state.template.json");
let writeQueue: Promise<void> = Promise.resolve();

async function readTemplateState(): Promise<{ raw: string; parsed: SystemState }> {
  const raw = await fs.readFile(systemStateTemplatePath, "utf-8");
  return { raw, parsed: JSON.parse(raw) as SystemState };
}

async function ensureSystemStateFile(): Promise<void> {
  try {
    await fs.access(systemStatePath);
  } catch {
    try {
      const backup = await fs.readFile(systemStateBackupPath, "utf-8");
      await fs.writeFile(systemStatePath, backup, "utf-8");
    } catch {
      const template = await fs.readFile(systemStateTemplatePath, "utf-8");
      await fs.writeFile(systemStatePath, template, "utf-8");
    }
  }
}

export async function readSystemState(): Promise<SystemState> {
  await ensureSystemStateFile();
  const raw = await fs.readFile(systemStatePath, "utf-8");
  try {
    return JSON.parse(raw) as SystemState;
  } catch {
    try {
      const backupRaw = await fs.readFile(systemStateBackupPath, "utf-8");
      const backupParsed = JSON.parse(backupRaw) as SystemState;
      await fs.writeFile(systemStatePath, backupRaw, "utf-8");
      return backupParsed;
    } catch {
      const template = await readTemplateState();
      await fs.writeFile(systemStatePath, template.raw, "utf-8");
      return template.parsed;
    }
  }
}

export async function writeSystemState(state: SystemState): Promise<void> {
  await ensureSystemStateFile();
  const payload = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.then(async () => {
    const tempPath = `${systemStatePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fs.writeFile(tempPath, payload, "utf-8");
    try {
      await fs.rename(tempPath, systemStatePath);
    } catch {
      await fs.writeFile(systemStatePath, payload, "utf-8");
      await fs.rm(tempPath, { force: true });
    }
    await fs.writeFile(systemStateBackupPath, payload, "utf-8");
  });
  await writeQueue;
}

export function getRootDir(): string {
  return rootDir;
}