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
