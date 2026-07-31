import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

type UnityStatusResponse = {
  ok: boolean;
  unityCliLoop?: {
    available?: boolean;
  };
};

type UnityActionResponse = {
  ok: boolean;
  mode?: "unity-cli-loop" | "unity-batch";
  action?: string;
  stderr?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(apiDir, "../..");
const statePath = path.join(repoRoot, "data", "system-state.local.json");

const testPort = 18240 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${testPort}`;
let server: ChildProcess | null = null;
let originalStateRaw: string | null = null;
let fakeUnityDir = "";
let fakeUnityExe = "";

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

async function waitForServerReady(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/tools/unity/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Continue polling while server boots.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for API server to start");
}

before(async () => {
  try {
    originalStateRaw = await fs.readFile(statePath, "utf-8");
  } catch {
    originalStateRaw = null;
  }

  fakeUnityDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-unity-fallback-"));
  fakeUnityExe = path.join(fakeUnityDir, "Unity.exe");
  await fs.copyFile(process.execPath, fakeUnityExe);

  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(testPort),
      UNITY_EDITOR_PATH: fakeUnityExe,
      PATH: path.dirname(process.execPath),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady();

  await fetch(`${baseUrl}/api/tools/unity/approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, durationMinutes: 30, actor: "test" }),
  });
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await delay(300);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }

  if (originalStateRaw !== null) {
    await fs.writeFile(statePath, originalStateRaw, "utf-8");
  }

  if (fakeUnityDir) {
    await fs.rm(fakeUnityDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("unity_compile falls back to unity-batch mode when uloop is unavailable", async () => {
  const status = await fetchJson<UnityStatusResponse>(`${baseUrl}/api/tools/unity/status`);
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);

  // Test setup removes PATH tools so uloop should not be discoverable.
  assert.equal(Boolean(status.body.unityCliLoop?.available), false);

  const compile = await fetchJson<UnityActionResponse>(`${baseUrl}/api/tools/unity/unity_compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "test" }),
  });

  // Fake Unity.exe is a copied node binary; compile is expected to fail but should use batch fallback mode.
  assert.equal(compile.body.mode, "unity-batch");
  assert.equal(compile.body.action, "unity_compile");
  assert.ok(compile.status === 200 || compile.status === 500);
});
