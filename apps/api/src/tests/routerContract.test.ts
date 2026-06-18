import assert from "node:assert/strict";
import test from "node:test";
import { buildRouterBody, buildRouterHeaders, createRouterContext } from "../lib/routerContract.js";
import type { HarnessConfig, SystemState } from "../types.js";

const mockState: SystemState = {
  onboardingComplete: true,
  activeWorkspaceId: "default",
  selectedPane: { type: "agent", id: "hermes" },
  router9: {
    apiKey: "test-api-key-123456",
    baseUrl: "https://api.9router.io/v1",
    defaultModel: "deepseek-v3",
    fallbackOrder: ["deepseek-v3", "qwen-2.5-72b"],
    providers: [],
    logs: [],
  },
};

const harnessBoth: HarnessConfig = {
  id: "hermes",
  name: "Hermes",
  endpoint: "http://localhost:8001",
  models: ["deepseek-v3"],
  defaultModel: "deepseek-v3",
  adapter: {
    authMode: "both",
  },
};

test("router context includes request metadata", () => {
  const ctx = createRouterContext(mockState, "deepseek-v3");
  assert.ok(ctx.requestId.length > 10);
  assert.equal(ctx.model, "deepseek-v3");
  assert.equal(ctx.baseUrl, "https://api.9router.io/v1");
});

test("router headers include transport contract fields", () => {
  const ctx = createRouterContext(mockState, "deepseek-v3");
  const headers = buildRouterHeaders(harnessBoth, ctx);

  assert.equal(headers["X-9Router-Model"], "deepseek-v3");
  assert.equal(headers["X-9Router-Transport-Version"], "1");
  assert.ok(headers.Authorization?.startsWith("Bearer "));
  assert.equal(headers["X-API-Key"], "test-api-key-123456");
});

test("router body includes fallback contract", () => {
  const ctx = createRouterContext(mockState, "deepseek-v3");
  const body = buildRouterBody(ctx);

  assert.equal(body.model, "deepseek-v3");
  assert.equal(body.baseUrl, "https://api.9router.io/v1");
  assert.deepEqual(body.fallbackOrder, ["deepseek-v3", "qwen-2.5-72b"]);
});
