import fs from "node:fs/promises";
import path from "node:path";
import { getRootDir } from "./stateStore.js";
import type { StartupReadiness } from "../types.js";

const resultsPath = path.join(getRootDir(), "data", "startup-check.local.json");

type StartupResult = {
  readiness: StartupReadiness;
  timestamp: string;
};

async function ensureStore(): Promise<void> {
  try {
    await fs.access(resultsPath);
  } catch {
    const dir = path.dirname(resultsPath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(resultsPath, "[]", "utf-8");
  }
}

async function readResults(): Promise<StartupResult[]> {
  await ensureStore();
  const raw = await fs.readFile(resultsPath, "utf-8");
  return JSON.parse(raw) as StartupResult[];
}

async function writeResults(results: StartupResult[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), "utf-8");
}

export async function persistStartupCheck(readiness: StartupReadiness): Promise<void> {
  const results = await readResults();
  results.unshift({
    readiness,
    timestamp: new Date().toISOString(),
  });
  await writeResults(trimResults(results));
}

export async function getLastStartupCheck(): Promise<StartupResult | undefined> {
  const results = await readResults();
  return results[0];
}

export async function listStartupCheckHistory(limit: number = 10): Promise<StartupResult[]> {
  const results = await readResults();
  return results.slice(0, limit);
}

function trimResults(results: StartupResult[]): StartupResult[] {
  return results.slice(0, 100);
}
