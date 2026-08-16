import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";

type UnityBridgeOptions = {
  nexusOsBaseUrl: string;
  sessionTtlMs?: number;
};

type ImageInput = {
  workspaceId?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  profile?: number;
};

type ImageAsset = {
  kind: "image";
  provider: string;
  model: string;
  workspaceId: string;
  relativePath: string;
  downloadUrl: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  profile: number;
  prompt: string;
  negativePrompt: string;
};

type AudioInput = {
  workspaceId?: string;
  mode?: "small-music" | "small-sfx" | "medium";
  prompt?: string;
  duration?: number;
  fileName?: string;
};

type AudioAsset = {
  kind: "audio";
  provider: "stable-audio";
  mode: "small-music" | "small-sfx" | "medium";
  workspaceId: string;
  relativePath: string;
  downloadUrl: string;
  duration: number;
  prompt: string;
};

type BridgeJob = {
  id: string;
  tool: "nexus.generate.image" | "nexus.generate.audio";
  status: "queued" | "running" | "canceling" | "completed" | "failed" | "canceled";
  message: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  result?: { asset: ImageAsset | AudioAsset };
  error?: { code: string; message: string; retryable: boolean };
  controller: AbortController;
};

type WorkspaceTreeNode = {
  name?: string;
  type?: "file" | "directory";
  path?: string;
  children?: WorkspaceTreeNode[];
};

export function createUnityMcpBridgeRouter(options: UnityBridgeOptions): express.Router {
  const router = express.Router();
  const sessions = new Map<string, number>();
  const jobs = new Map<string, BridgeJob>();
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const baseUrl = options.nexusOsBaseUrl.replace(/\/$/, "");

  router.use((req, res, next) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      return res.status(403).json(errorEnvelope("localhost_required", "The Unity bridge only accepts localhost connections.", false));
    }
    return next();
  });

  router.post("/session", (_req, res) => {
    const token = randomUUID();
    const expiresAt = Date.now() + sessionTtlMs;
    sessions.set(token, expiresAt);
    return res.json({ ok: true, data: { token, expiresAt: new Date(expiresAt).toISOString() } });
  });

  router.use((req, res, next) => {
    const token = String(req.header("X-Nexus-Session") ?? "").trim();
    const expiresAt = sessions.get(token);
    if (!token || !expiresAt || expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      return res.status(401).json(errorEnvelope("invalid_session", "Start a new Unity bridge session.", false));
    }
    sessions.set(token, Date.now() + sessionTtlMs);
    return next();
  });

  router.get("/status", async (_req, res) => {
    try {
      const health = await fetchJson(`${baseUrl}/api/health`, 3_000);
      const [wan2gp, hunyuan3d, animato, stableAudio] = await Promise.all([
        fetchJsonOrUnavailable(`${baseUrl}/api/tools/wan2gp/status`),
        fetchJsonOrUnavailable(`${baseUrl}/api/tools/hunyuan3d/status`),
        fetchJsonOrUnavailable(`${baseUrl}/api/tools/animation/status`),
        fetchJsonOrUnavailable(`${baseUrl}/api/tools/music/stable-audio/status`),
      ]);
      return res.json({
        ok: true,
        workspaceId: "default",
        data: { health, wan2gp, hunyuan3d, animato, stableAudio: normalizeRuntimeReadiness(stableAudio) },
      });
    } catch (error) {
      return res.status(502).json(errorEnvelope("nexus_os_unavailable", String(error), true));
    }
  });

  router.post("/tools/nexus.generate.image", (req, res) => {
    const input = req.body as ImageInput;
    const validationError = validateImageInput(input);
    if (validationError) {
      return res.status(400).json(errorEnvelope("invalid_request", validationError, false));
    }

    const job: BridgeJob = {
      id: randomUUID(),
      tool: "nexus.generate.image",
      status: "queued",
      message: "Image generation queued.",
      workspaceId: input.workspaceId?.trim() || "default",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      controller: new AbortController(),
    };
    jobs.set(job.id, job);
    void runImageJob(job, input, baseUrl);
    return res.status(202).json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.post("/tools/nexus.generate.audio", (req, res) => {
    const input = req.body as AudioInput;
    const validationError = validateAudioInput(input);
    if (validationError) {
      return res.status(400).json(errorEnvelope("invalid_request", validationError, false));
    }

    const job: BridgeJob = {
      id: randomUUID(),
      tool: "nexus.generate.audio",
      status: "queued",
      message: "Audio generation queued.",
      workspaceId: input.workspaceId?.trim() || "default",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      controller: new AbortController(),
    };
    jobs.set(job.id, job);
    void runAudioJob(job, input, baseUrl);
    return res.status(202).json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.get("/jobs", (_req, res) => {
    const rows = [...jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map(publicJob);
    return res.json({ ok: true, workspaceId: "default", data: { jobs: rows } });
  });

  router.get("/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json(errorEnvelope("job_not_found", "Generation job was not found.", false));
    return res.json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.post("/jobs/:id/cancel", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json(errorEnvelope("job_not_found", "Generation job was not found.", false));
    if (job.status === "queued" || job.status === "running") {
      updateJob(job, "canceling", "Canceling image generation...");
      job.controller.abort();
    }
    return res.json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.get("/assets", async (req, res) => {
    const workspaceId = String(req.query.workspaceId ?? "default").trim() || "default";
    const kind = String(req.query.kind ?? "image").trim().toLowerCase();
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/tree`);
      if (!response.ok) throw new Error(`Workspace tree returned HTTP ${response.status}.`);
      const payload = await response.json() as { tree?: WorkspaceTreeNode };
      const assets = kind === "audio"
        ? flattenAudioAssets(payload.tree, workspaceId)
        : flattenImageAssets(payload.tree, workspaceId);
      return res.json({ ok: true, workspaceId, data: { assets } });
    } catch (error) {
      return res.status(502).json(errorEnvelope("asset_list_failed", String(error), true));
    }
  });

  return router;
}

async function runAudioJob(job: BridgeJob, input: AudioInput, baseUrl: string): Promise<void> {
  updateJob(job, "running", "Starting NexusOS audio generation...");
  try {
    const response = await fetch(`${baseUrl}/api/tools/music/stable-audio/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: job.workspaceId,
        mode: input.mode ?? "small-music",
        prompt: input.prompt!.trim(),
        duration: input.duration ?? 30,
        fileName: input.fileName?.trim() || undefined,
      }),
      signal: job.controller.signal,
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok || result.ok === false) {
      throw new Error(String(result.error ?? `Audio generation returned HTTP ${response.status}.`));
    }

    job.result = {
      asset: {
        kind: "audio",
        provider: "stable-audio",
        mode: (input.mode ?? "small-music"),
        workspaceId: String(result.workspaceId ?? job.workspaceId),
        relativePath: String(result.relativePath ?? ""),
        downloadUrl: String(result.playbackUrl ?? ""),
        duration: Number(result.duration ?? input.duration ?? 30),
        prompt: String(result.prompt ?? input.prompt ?? ""),
      },
    };
    updateJob(job, "completed", "Audio generated and ready to import.", true);
  } catch (error) {
    if (job.controller.signal.aborted) {
      updateJob(job, "canceled", "Audio generation canceled.", true);
      return;
    }
    job.error = { code: "generation_failed", message: String(error), retryable: true };
    updateJob(job, "failed", job.error.message, true);
  }
}

async function runImageJob(job: BridgeJob, input: ImageInput, baseUrl: string): Promise<void> {
  updateJob(job, "running", "Starting NexusOS image generation...");
  const query = new URLSearchParams({
    workspaceId: job.workspaceId,
    prompt: input.prompt!.trim(),
    negativePrompt: input.negativePrompt?.trim() ?? "",
    model: input.model?.trim() || "auto",
    width: String(input.width ?? 768),
    height: String(input.height ?? 768),
    steps: String(input.steps ?? 6),
    seed: String(input.seed ?? -1),
    profile: String(input.profile ?? 4),
  });

  try {
    const response = await fetch(`${baseUrl}/api/tools/wan2gp/image/stream?${query}`, { signal: job.controller.signal });
    if (!response.ok || !response.body) throw new Error(`Image generation returned HTTP ${response.status}.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!data) continue;
        const event = JSON.parse(data) as { type?: string; message?: string; result?: Record<string, unknown> };
        if (event.type === "status") updateJob(job, "running", event.message || "Generating image...");
        if (event.type === "error") throw new Error(event.message || "Image generation failed.");
        if (event.type === "done" && event.result) {
          job.result = { asset: normalizeImageAsset(event.result) };
          updateJob(job, "completed", "Image generated and ready to import.", true);
          completed = true;
        }
      }
      if (done) break;
    }

    if (!completed) throw new Error("Image stream ended without a completed asset.");
  } catch (error) {
    if (job.controller.signal.aborted) {
      updateJob(job, "canceled", "Image generation canceled.", true);
      return;
    }
    job.error = { code: "generation_failed", message: String(error), retryable: true };
    updateJob(job, "failed", job.error.message, true);
  }
}

function normalizeImageAsset(result: Record<string, unknown>): ImageAsset {
  return {
    kind: "image",
    provider: String(result.provider ?? "wan2gp"),
    model: String(result.model ?? "auto"),
    workspaceId: String(result.workspaceId ?? "default"),
    relativePath: String(result.relativePath ?? ""),
    downloadUrl: String(result.imageUrl ?? result.downloadUrl ?? ""),
    width: Number(result.width ?? 0),
    height: Number(result.height ?? 0),
    steps: Number(result.steps ?? 0),
    seed: Number(result.seed ?? -1),
    profile: Number(result.profile ?? 4),
    prompt: String(result.prompt ?? ""),
    negativePrompt: String(result.negativePrompt ?? ""),
  };
}

function flattenImageAssets(root: WorkspaceTreeNode | undefined, workspaceId: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const visit = (node: WorkspaceTreeNode | undefined) => {
    if (!node) return;
    if (node.type === "file" && node.path && /\.(png|jpe?g|webp)$/i.test(node.path) && node.path.replace(/\\/g, "/").startsWith("Assets/images/")) {
      const relativePath = node.path.replace(/\\/g, "/");
      rows.push({
        kind: "image",
        relativePath,
        fileName: node.name || relativePath.split("/").pop() || relativePath,
        downloadUrl: `/api/tools/wan2gp/file?workspaceId=${encodeURIComponent(workspaceId)}&relativePath=${encodeURIComponent(relativePath)}`,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return rows.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function flattenAudioAssets(root: WorkspaceTreeNode | undefined, workspaceId: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const visit = (node: WorkspaceTreeNode | undefined) => {
    if (!node) return;
    if (node.type === "file" && node.path && /\.(wav|mp3|ogg)$/i.test(node.path) && node.path.replace(/\\/g, "/").startsWith("Assets/music/")) {
      const relativePath = node.path.replace(/\\/g, "/");
      rows.push({
        kind: "audio",
        relativePath,
        fileName: node.name || relativePath.split("/").pop() || relativePath,
        downloadUrl: `/api/tools/music/file?workspaceId=${encodeURIComponent(workspaceId)}&relativePath=${encodeURIComponent(relativePath)}`,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return rows.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function validateImageInput(input: ImageInput): string | null {
  if (!input || !input.prompt?.trim()) return "prompt is required";
  if ((input.width ?? 768) < 256 || (input.width ?? 768) > 1280) return "width must be between 256 and 1280";
  if ((input.height ?? 768) < 256 || (input.height ?? 768) > 1280) return "height must be between 256 and 1280";
  if ((input.steps ?? 6) < 1 || (input.steps ?? 6) > 60) return "steps must be between 1 and 60";
  if ((input.profile ?? 4) < 1 || (input.profile ?? 4) > 5) return "profile must be between 1 and 5";
  return null;
}

function validateAudioInput(input: AudioInput): string | null {
  if (!input || !input.prompt?.trim()) return "prompt is required";
  if (input.mode !== "small-music" && input.mode !== "small-sfx" && input.mode !== "medium") {
    return "mode must be one of small-music, small-sfx, or medium";
  }
  const duration = input.duration ?? 30;
  const maxDuration = input.mode === "medium" ? 380 : 120;
  if (duration < 1 || duration > maxDuration) return `duration must be between 1 and ${maxDuration} seconds for ${input.mode}`;
  return null;
}

function publicJob(job: BridgeJob): Omit<BridgeJob, "controller"> {
  const { controller: _controller, ...row } = job;
  return row;
}

function updateJob(job: BridgeJob, status: BridgeJob["status"], message: string, finished = false): void {
  job.status = status;
  job.message = message;
  job.updatedAt = new Date().toISOString();
  if (finished) job.finishedAt = job.updatedAt;
}

async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function fetchJsonOrUnavailable(url: string): Promise<unknown> {
  try {
    return await fetchJson(url);
  } catch (error) {
    return { apiReady: false, error: String(error) };
  }
}

function normalizeRuntimeReadiness(value: unknown): Record<string, unknown> {
  const status = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    ...status,
    apiReady: Boolean(status.apiReady ?? status.ready),
  };
}

function errorEnvelope(code: string, message: string, retryable: boolean): Record<string, unknown> {
  return { ok: false, error: { code, message, retryable, details: {} } };
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1";
}
