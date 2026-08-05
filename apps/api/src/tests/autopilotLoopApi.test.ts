import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { getRootDir } from "../lib/stateStore.js";

const ROOT = getRootDir();
const SYSTEM_STATE_PATH = path.join(ROOT, "data", "system-state.local.json");
const SERVER_PORT = 18081;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

async function waitForServerReady(timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("API server did not become ready in time.");
}

function spawnApiServer(): ChildProcess {
  const entryPath = path.join(ROOT, "apps", "api", "dist", "index.js");
  return spawn(process.execPath, [entryPath], {
    cwd: path.join(ROOT, "apps", "api"),
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
    },
    stdio: "ignore",
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test("autopilot loop profile persists and run-until-blocker returns loop summary", async () => {
  const stateBackup = await fs.readFile(SYSTEM_STATE_PATH, "utf-8");
  const server = spawnApiServer();

  try {
    await waitForServerReady(20_000);

    const profileSaveRes = await fetch(`${SERVER_URL}/api/tools/autopilot-loop/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: "free",
        backendHarnessId: "hermes",
        maxSteps: 12,
        maxDurationMinutes: 95,
        maxRetriesPerTask: 2,
      }),
    });
    assert.equal(profileSaveRes.ok, true);
    const profileSavePayload = await profileSaveRes.json() as {
      ok: boolean;
      config: {
        profile: string;
        backendHarnessId: string;
        maxSteps: number;
      };
      effectiveFallbackChain: Array<{ providerId: string; model: string }>;
    };
    assert.equal(profileSavePayload.ok, true);
    assert.equal(profileSavePayload.config.profile, "free");
    assert.equal(profileSavePayload.config.backendHarnessId, "hermes");
    assert.equal(profileSavePayload.config.maxSteps, 12);
    assert.ok(Array.isArray(profileSavePayload.effectiveFallbackChain));

    const profileLoadRes = await fetch(`${SERVER_URL}/api/tools/autopilot-loop/profile`);
    assert.equal(profileLoadRes.ok, true);
    const profileLoadPayload = await profileLoadRes.json() as {
      config: { profile: string; maxSteps: number; backendHarnessId: string };
    };
    assert.equal(profileLoadPayload.config.profile, "free");
    assert.equal(profileLoadPayload.config.maxSteps, 12);
    assert.equal(profileLoadPayload.config.backendHarnessId, "hermes");

    const loopRes = await fetch(`${SERVER_URL}/api/tools/autopilot-loop/run-until-blocker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "default",
        mode: "strict-approval",
        maxSteps: 1,
      }),
    });
    assert.equal(loopRes.ok, true);
    const loopPayload = await loopRes.json() as {
      agentId: string;
      mode: string;
      maxSteps: number;
      stepsExecuted: number;
      iterations: Array<{ ok: boolean; blocker?: string }>;
      queueSummary: { total: number; ready: number; blocked: number; done: number };
      blocker?: string;
    };

    assert.equal(loopPayload.agentId, "autopilot-loop");
    assert.equal(loopPayload.mode, "strict-approval");
    assert.equal(loopPayload.maxSteps, 1);
    assert.ok(Array.isArray(loopPayload.iterations));
    assert.ok(loopPayload.iterations.length >= 1);
    assert.ok(typeof loopPayload.stepsExecuted === "number");
    assert.ok(typeof loopPayload.queueSummary.total === "number");
  } finally {
    await stopProcess(server);
    await fs.writeFile(SYSTEM_STATE_PATH, stateBackup, "utf-8");
  }
});
