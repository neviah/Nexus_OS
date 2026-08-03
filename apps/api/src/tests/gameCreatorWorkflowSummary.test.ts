import assert from "node:assert/strict";
import test from "node:test";
import { buildGameCreatorWorkflowSummary } from "../lib/gameCreatorWorkflowSummary.js";

test("workflow summary recommends docs generation when setup exists but docs are missing", () => {
  const summary = buildGameCreatorWorkflowSummary({
    hasSetupDraft: true,
    canonDocCount: 0,
    approvedLockedDocs: 0,
    queueItemCount: 0,
    releaseReady: false,
    complianceStatus: "needs-attention",
  });

  assert.equal(summary.status, "docs");
  assert.match(summary.nextAction, /Generate/i);
  assert.ok(summary.progressPercent < 50);
});

test("workflow summary promotes release readiness when docs and queue are ready", () => {
  const summary = buildGameCreatorWorkflowSummary({
    hasSetupDraft: true,
    canonDocCount: 10,
    approvedLockedDocs: 10,
    queueItemCount: 6,
    releaseReady: true,
    complianceStatus: "ready",
  });

  assert.equal(summary.status, "ready-to-release");
  assert.match(summary.nextAction, /release/i);
  assert.ok(summary.progressPercent >= 80);
});
