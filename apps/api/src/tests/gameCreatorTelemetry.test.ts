import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendGameCreatorTelemetryEvent, buildGameCreatorTelemetrySummary } from "../lib/gameCreatorTelemetry.js";
import { buildGameCreatorComplianceSummary } from "../lib/gameCreatorCompliance.js";

test("telemetry summary counts events by severity", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gc-telemetry-"));
  await appendGameCreatorTelemetryEvent({ workspaceId: "demo", kind: "doc-generation", message: "Generated canon docs", severity: "info", metadata: { docs: 2 }, storageDir: tempDir });
  await appendGameCreatorTelemetryEvent({ workspaceId: "demo", kind: "artifact-decision", message: "Artifact rejected", severity: "warn", storageDir: tempDir });

  const summary = buildGameCreatorTelemetrySummary({ workspaceId: "demo", storageDir: tempDir });
  assert.equal(summary.totalEvents, 2);
  assert.equal(summary.bySeverity.warn, 1);
  assert.ok(summary.recentEvents[0].message.includes("Artifact"));
});

test("compliance summary flags missing provenance and approvals", () => {
  const summary = buildGameCreatorComplianceSummary({
    workspacePath: "C:/workspace/demo",
    artifacts: [{ status: "pending", provenance: undefined }],
    canonDocs: [{ reviewStatus: "pending", locked: false }],
    telemetryEntries: [{ severity: "warn" }],
  });

  assert.equal(summary.overallStatus, "needs-attention");
  assert.ok(summary.policyChecks.some((check) => check.id === "provenance"));
  assert.ok(summary.policyChecks.some((check) => check.id === "doc-approvals"));
});

test("telemetry summary returns empty state when file does not exist", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gc-telemetry-empty-"));
  const summary = buildGameCreatorTelemetrySummary({ workspaceId: "demo", storageDir: tempDir });
  assert.equal(summary.totalEvents, 0);
  assert.equal(summary.bySeverity.info, 0);
  assert.equal(summary.bySeverity.warn, 0);
  assert.equal(summary.bySeverity.error, 0);
  assert.deepEqual(summary.recentEvents, []);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("telemetry summary skips malformed json lines", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gc-telemetry-malformed-"));
  const telemetryFile = path.join(tempDir, "game-creator-telemetry.jsonl");
  await fs.writeFile(telemetryFile, [
    "{\"id\":\"1\",\"workspaceId\":\"demo\",\"kind\":\"doc\",\"message\":\"ok\",\"severity\":\"info\",\"createdAt\":\"2026-01-01T00:00:00.000Z\"}",
    "not-json",
  ].join("\n"), "utf-8");

  const summary = buildGameCreatorTelemetrySummary({ workspaceId: "demo", storageDir: tempDir });
  assert.equal(summary.totalEvents, 1);
  assert.equal(summary.bySeverity.info, 1);
  await fs.rm(tempDir, { recursive: true, force: true });
});
