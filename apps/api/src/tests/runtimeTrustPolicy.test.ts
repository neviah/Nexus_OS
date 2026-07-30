import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

type RuntimePolicyResponse = {
  ok: boolean;
  policy: {
    installEnabled: boolean;
    allowDirectInstallApi: boolean;
    allowedJobActions: string[];
    pullModelAllowPattern: string;
    allowedSourceDomains: string[];
    expectedArtifactSha256: Record<string, string>;
    requireSignedArtifactManifest: boolean;
    trustedManifestKeyIds: string[];
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(apiDir, "../..");
const statePath = path.join(repoRoot, "data", "system-state.local.json");
const auditPath = path.join(repoRoot, "data", "runtime-install-audit.local.jsonl");

const testPort = 18080 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${testPort}`;
let server: ChildProcess | null = null;
let originalStateRaw: string | null = null;
let originalAuditRaw: string | null = null;

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
      const response = await fetch(`${baseUrl}/api/tools/runtimes/policy`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until startup is complete.
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
  try {
    originalAuditRaw = await fs.readFile(auditPath, "utf-8");
  } catch {
    originalAuditRaw = null;
  }

  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(testPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady();
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

  if (originalAuditRaw !== null) {
    await fs.writeFile(auditPath, originalAuditRaw, "utf-8");
  } else {
    await fs.rm(auditPath, { force: true }).catch(() => undefined);
  }
});

test("runtime policy includes signed-manifest fields", async () => {
  const { status, body } = await fetchJson<RuntimePolicyResponse>(`${baseUrl}/api/tools/runtimes/policy`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.policy.requireSignedArtifactManifest, "boolean");
  assert.ok(Array.isArray(body.policy.trustedManifestKeyIds));
});

test("runtime jobs return structured denial when action is blocked", async () => {
  const policyUpdate = {
    installEnabled: true,
    allowDirectInstallApi: false,
    allowedJobActions: ["start-ollama"],
    pullModelAllowPattern: "^[a-z0-9._:-]{1,120}$",
    allowedSourceDomains: ["github.com", "objects.githubusercontent.com", "huggingface.co", "ollama.com"],
    expectedArtifactSha256: {},
    requireSignedArtifactManifest: false,
    trustedManifestKeyIds: [],
  };

  const post = await fetch(`${baseUrl}/api/tools/runtimes/policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policyUpdate),
  });
  assert.equal(post.status, 200);

  const denied = await fetchJson<{ error: string; code: string }>(`${baseUrl}/api/tools/runtimes/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "install-piper" }),
  });

  assert.equal(denied.status, 412);
  assert.equal(denied.body.code, "action_blocked");
  assert.match(denied.body.error, /blocked/i);
});

test("runtime jobs return structured denial when required source domains are blocked", async () => {
  const policyUpdate = {
    installEnabled: true,
    allowDirectInstallApi: false,
    allowedJobActions: ["install-piper"],
    pullModelAllowPattern: "^[a-z0-9._:-]{1,120}$",
    allowedSourceDomains: ["huggingface.co", "ollama.com"],
    expectedArtifactSha256: {},
    requireSignedArtifactManifest: false,
    trustedManifestKeyIds: [],
  };

  const post = await fetch(`${baseUrl}/api/tools/runtimes/policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policyUpdate),
  });
  assert.equal(post.status, 200);

  const denied = await fetchJson<{ error: string; code: string; details?: { missingDomains?: string[] } }>(`${baseUrl}/api/tools/runtimes/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "install-piper" }),
  });

  assert.equal(denied.status, 412);
  assert.equal(denied.body.code, "domain_blocked");
  assert.ok(Array.isArray(denied.body.details?.missingDomains));
  assert.ok((denied.body.details?.missingDomains ?? []).includes("github.com"));
});

test("runtime jobs reject pull model names outside allow pattern", async () => {
  const policyUpdate = {
    installEnabled: true,
    allowDirectInstallApi: false,
    allowedJobActions: ["pull-ollama-model"],
    pullModelAllowPattern: "^(llama3\\.2:3b)$",
    allowedSourceDomains: ["ollama.com"],
    expectedArtifactSha256: {},
    requireSignedArtifactManifest: false,
    trustedManifestKeyIds: [],
  };

  const post = await fetch(`${baseUrl}/api/tools/runtimes/policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policyUpdate),
  });
  assert.equal(post.status, 200);

  const denied = await fetchJson<{ error: string; code: string }>(`${baseUrl}/api/tools/runtimes/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "pull-ollama-model", model: "qwen2.5-coder:7b" }),
  });

  assert.equal(denied.status, 412);
  assert.equal(denied.body.code, "model_pattern_blocked");
});

test("runtime install audit endpoint returns recent records", async () => {
  const sample = {
    id: "test-audit-id",
    at: new Date().toISOString(),
    jobId: "test-job",
    action: "install-piper",
    status: "failed",
    error: "simulated",
  };
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(sample)}\n`, "utf-8");

  const response = await fetchJson<{ ok: boolean; records: Array<{ id: string; action: string }> }>(`${baseUrl}/api/tools/runtimes/audit?limit=1`);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(Array.isArray(response.body.records));
  assert.ok(response.body.records.length >= 1);
  assert.equal(response.body.records[0]?.id, "test-audit-id");
});
