import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPrototype, buildPrototypeFromAnimationReadiness } from "../lib/prototypeGenerator.js";

test("buildPrototype creates a playable browser scaffold from a simple spec", () => {
  const result = buildPrototype({
    title: "Starfall Sprint",
    genre: "action-platformer",
    target: "browser",
    loop: "run, dodge, score",
    mechanics: ["movement", "enemy swarms", "combo meter"],
    mood: "fast and electric",
  });

  assert.ok(result.files.some((file) => file.path.endsWith("README.md")));
  assert.ok(result.files.some((file) => file.path.endsWith("index.html")));
  assert.ok(result.files.some((file) => file.path.endsWith("src/main.js")));
  assert.ok(result.summary.some((entry) => entry.includes("Starfall Sprint")));
  assert.match(result.files.find((file) => file.path.endsWith("src/main.js"))?.content ?? "", /Starfall Sprint/);
  assert.match(result.files.find((file) => file.path.endsWith("index.html"))?.content ?? "", /Starfall Sprint/);
});

test("buildPrototypeFromAnimationReadiness turns the gate manifest into a concrete prototype", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-prototype-"));
  const manifestPath = path.join(tempDir, "animation-readiness.json");
  const manifest = {
    readyForAnimation: true,
    target: "web-2d",
    gate3Artifacts: [{ id: "gate3-style-kit", kind: "style-kit", relativePath: "GameBuild/gates/gate3/style-kit.json" }],
    gate4Artifacts: [{ id: "gate4-asset-manifest", kind: "asset-manifest", relativePath: "GameBuild/gates/gate4/asset-manifest.json" }],
    checkpoints: {
      gate3: { styleKit: true, referencePack: true, productionBrief: true },
      gate4: { assetManifest: true, importPackage: true, validationReport: true },
    },
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  const result = await buildPrototypeFromAnimationReadiness({
    title: "Skyline Sprint",
    manifestPath,
  });

  assert.ok(result.files.some((file) => file.path.endsWith("README.md")));
  assert.ok(result.files.some((file) => file.path.endsWith("src/main.js")));
  assert.ok(result.files.some((file) => file.path.endsWith("index.html")));
  assert.match(result.summary.join("\n"), /Skyline Sprint/);
  assert.match(result.summary.join("\n"), /animation-readiness/);
});
