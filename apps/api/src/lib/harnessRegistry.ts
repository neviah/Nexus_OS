import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessConfig } from "../types.js";

type HarnessRegistryFile = {
  harnesses: HarnessConfig[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../");

const registryPath = path.join(rootDir, "config", "harnesses.json");

export async function readHarnessRegistry(): Promise<HarnessConfig[]> {
  const raw = await fs.readFile(registryPath, "utf-8");
  const parsed = JSON.parse(raw) as HarnessRegistryFile;
  return parsed.harnesses;
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

export async function resolveHarnessHealth(harnesses: HarnessConfig[]) {
  const checks = harnesses.map(async (harness) => {
    try {
      const response = await fetchWithTimeout(`${harness.endpoint}/health`, 1200);
      if (response.ok) {
        return {
          ...harness,
          status: "online" as const,
          health: "healthy" as const,
        };
      }
      return {
        ...harness,
        status: "offline" as const,
        health: "degraded" as const,
      };
    } catch {
      return {
        ...harness,
        status: "offline" as const,
        health: "offline" as const,
      };
    }
  });

  return Promise.all(checks);
}