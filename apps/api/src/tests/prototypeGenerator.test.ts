import assert from "node:assert/strict";
import test from "node:test";
import { buildPrototype } from "../lib/prototypeGenerator.js";

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
