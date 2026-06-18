import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessConfig } from "../types.js";

type Registry = {
  harnesses: HarnessConfig[];
};

async function loadRegistry(): Promise<Registry> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, "../../../../");
  const registryPath = path.join(root, "config", "harnesses.json");
  const raw = await fs.readFile(registryPath, "utf-8");
  return JSON.parse(raw) as Registry;
}

test("all harnesses define unique ids", async () => {
  const registry = await loadRegistry();
  const ids = registry.harnesses.map((item) => item.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
});

test("default model exists in model list", async () => {
  const registry = await loadRegistry();
  for (const harness of registry.harnesses) {
    assert.ok(
      harness.models.includes(harness.defaultModel),
      `${harness.id}: default model ${harness.defaultModel} is not in model list`,
    );
  }
});

test("adapter path fields are absolute-like", async () => {
  const registry = await loadRegistry();

  for (const harness of registry.harnesses) {
    const adapter = harness.adapter;
    assert.ok(adapter, `${harness.id}: missing adapter config`);

    const pathFields = [adapter.healthPath, adapter.openAiPath, adapter.streamPath].filter(Boolean) as string[];
    for (const field of pathFields) {
      assert.ok(field.startsWith("/"), `${harness.id}: path '${field}' must start with '/'`);
    }

    const generic = adapter.genericPaths ?? [];
    for (const entry of generic) {
      assert.ok(entry.startsWith("/"), `${harness.id}: generic path '${entry}' must start with '/'`);
    }
  }
});