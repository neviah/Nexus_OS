import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export type GameCreatorTelemetryEntry = {
  id: string;
  workspaceId: string;
  kind: string;
  message: string;
  severity: "info" | "warn" | "error";
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type GameCreatorTelemetrySummary = {
  workspaceId: string;
  totalEvents: number;
  bySeverity: { info: number; warn: number; error: number };
  recentEvents: GameCreatorTelemetryEntry[];
};

export type AppendGameCreatorTelemetryEventInput = {
  workspaceId: string;
  kind: string;
  message: string;
  severity?: "info" | "warn" | "error";
  metadata?: Record<string, unknown>;
  storageDir: string;
};

export async function appendGameCreatorTelemetryEvent(input: AppendGameCreatorTelemetryEventInput): Promise<GameCreatorTelemetryEntry> {
  const storageDir = path.resolve(input.storageDir);
  await fs.mkdir(storageDir, { recursive: true });
  const filePath = path.join(storageDir, "game-creator-telemetry.jsonl");
  const entry: GameCreatorTelemetryEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    workspaceId: input.workspaceId,
    kind: input.kind,
    message: input.message,
    severity: input.severity ?? "info",
    metadata: input.metadata,
    createdAt: new Date().toISOString(),
  };

  const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
  const nextContent = `${existing}${JSON.stringify(entry)}\n`.trim();
  await fs.writeFile(filePath, nextContent ? `${nextContent}\n` : "", "utf-8");
  return entry;
}

export function buildGameCreatorTelemetrySummary(input: { workspaceId: string; storageDir: string }): GameCreatorTelemetrySummary {
  const filePath = path.join(path.resolve(input.storageDir), "game-creator-telemetry.jsonl");
  if (!fssync.existsSync(filePath)) {
    return {
      workspaceId: input.workspaceId,
      totalEvents: 0,
      bySeverity: { info: 0, warn: 0, error: 0 },
      recentEvents: [],
    };
  }

  const lines = fssync.readFileSync(filePath, "utf-8").split(/\n/).filter(Boolean);
  const entries: GameCreatorTelemetryEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as GameCreatorTelemetryEntry;
      if (parsed.workspaceId === input.workspaceId) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed lines to keep telemetry ingestion resilient.
    }
  }

  return {
    workspaceId: input.workspaceId,
    totalEvents: entries.length,
    bySeverity: {
      info: entries.filter((entry: GameCreatorTelemetryEntry) => entry.severity === "info").length,
      warn: entries.filter((entry: GameCreatorTelemetryEntry) => entry.severity === "warn").length,
      error: entries.filter((entry: GameCreatorTelemetryEntry) => entry.severity === "error").length,
    },
    recentEvents: entries.slice(-8).reverse(),
  };
}
