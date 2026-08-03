import test from "node:test";
import assert from "node:assert/strict";
import { buildGameCreatorWorkflowPlan } from "../lib/gameCreatorWorkflow.js";

test("buildGameCreatorWorkflowPlan includes the full end-to-end sequence", () => {
  const plan = buildGameCreatorWorkflowPlan({
    mode: "auto-produce",
    gate2Ready: true,
    canonDocCount: 10,
    approvedLockedDocs: 10,
    queueItemCount: 8,
    releaseReady: false,
  });

  assert.deepEqual(plan.steps, [
    "generate-canon-docs",
    "build-queue",
    "run-execution",
    "create-release-package",
  ]);
});

test("buildGameCreatorWorkflowPlan skips execution when the queue is already complete", () => {
  const plan = buildGameCreatorWorkflowPlan({
    mode: "auto-produce",
    gate2Ready: true,
    canonDocCount: 10,
    approvedLockedDocs: 10,
    queueItemCount: 8,
    releaseReady: true,
    queueCompleted: true,
  });

  assert.deepEqual(plan.steps, [
    "create-release-package",
  ]);
});
