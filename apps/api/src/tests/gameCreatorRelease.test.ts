import assert from "node:assert/strict";
import test from "node:test";
import { buildGameCreatorReleasePackage } from "../lib/gameCreatorRelease.js";

test("buildGameCreatorReleasePackage flags missing approvals before packaging", () => {
  const result = buildGameCreatorReleasePackage({
    workspacePath: "C:/workspace/demo",
    specPackage: {
      setupWizard: {
        target: "unity-3d",
        scopeTier: "mini-vertical-slice",
        controls: "keyboard-mouse",
      },
    },
    canonDocs: [
      { fileName: "GAME_BIBLE.md", reviewStatus: "approved", locked: true },
      { fileName: "TECH_DESIGN.md", reviewStatus: "pending", locked: false },
    ],
    queueItems: [
      { status: "done" },
      { status: "ready" },
    ],
    artifacts: [
      { status: "approved" },
      { status: "pending" },
    ],
    jobs: [
      { status: "completed" },
      { status: "failed" },
    ],
    run: { status: "completed", mode: "strict-approval" },
  });

  assert.equal(result.readyForPackaging, false);
  assert.ok(result.blockers.some((entry) => entry.includes("Pending artifacts")));
  assert.ok(result.suggestedNextActions.includes("Approve outstanding artifacts before packaging."));
  assert.ok(result.releaseNotes.includes("Release candidate"));
});

test("buildGameCreatorReleasePackage marks ready when all gates are satisfied", () => {
  const result = buildGameCreatorReleasePackage({
    workspacePath: "C:/workspace/demo",
    specPackage: {
      setupWizard: {
        target: "web-2d",
        scopeTier: "small-prototype",
        controls: "both",
      },
    },
    canonDocs: [
      { fileName: "GAME_BIBLE.md", reviewStatus: "approved", locked: true },
      { fileName: "TECH_DESIGN.md", reviewStatus: "approved", locked: true },
    ],
    queueItems: [
      { status: "done" },
      { status: "done" },
    ],
    artifacts: [
      { status: "approved" },
      { status: "approved" },
    ],
    jobs: [
      { status: "completed" },
      { status: "completed" },
    ],
    run: { status: "completed", mode: "auto-produce" },
  });

  assert.equal(result.readyForPackaging, true);
  assert.deepEqual(result.blockers, []);
  assert.ok(result.suggestedNextActions.includes("Create the release bundle and share the package."));
});
