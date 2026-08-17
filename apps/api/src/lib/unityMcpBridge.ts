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

type Model3dInput = {
  workspaceId?: string;
  imageUrl?: string;
  textPrompt?: string;
  textNegativePrompt?: string;
  modelPath?: string;
  subfolder?: string;
  numInferenceSteps?: number;
  octreeResolution?: number;
  guidanceScale?: number;
  seed?: number;
  format?: "glb" | "obj";
};

type Model3dFinishInput = {
  workspaceId?: string;
  relativePath?: string;
  outputFormat?: "glb" | "obj";
  profile?: "draft" | "game-ready-low" | "game-ready-med" | "game-ready-high";
  sourceImageUrl?: string;
  sourceRelativePath?: string;
};

type Model3dAsset = {
  kind: "model3d";
  provider: string;
  workspaceId: string;
  relativePath: string;
  downloadUrl: string;
  format: string;
  finishProfile: string;
  sourceKind: string;
  sourceImageUrl: string;
  sourceRelativePath: string;
};

type VideoInput = {
  workspaceId?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  durationSeconds?: number;
  fps?: number;
  frameCount?: number;
  seed?: number;
  profile?: number;
};

type AnimationInput = {
  workspaceId?: string;
  prompt?: string;
  sourceRelativePath?: string;
  variations?: number;
  harnessId?: string;
};

type VideoAsset = {
  kind: "video";
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
  durationSeconds: number;
  fps: number;
  frameCount: number;
};

type AnimationAsset = {
  kind: "animation";
  provider: "animato";
  variation: number;
  workspaceId: string;
  relativePath: string;
  downloadUrl: string;
  format: string;
  prompt: string;
};

type GeneratedAsset = ImageAsset | AudioAsset | Model3dAsset | VideoAsset | AnimationAsset;

type BridgeJob = {
  id: string;
  tool: "nexus.generate.image" | "nexus.generate.audio" | "nexus.generate.model3d" | "nexus.finish.model3d" | "nexus.generate.video" | "nexus.generate.animation";
  status: "queued" | "running" | "canceling" | "completed" | "failed" | "canceled";
  message: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  result?: { asset?: GeneratedAsset; assets?: GeneratedAsset[] };
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

  router.post("/tools/nexus.generate.model3d", (req, res) => {
    const input = req.body as Model3dInput;
    const validationError = validateModel3dInput(input);
    if (validationError) return res.status(400).json(errorEnvelope("invalid_request", validationError, false));
    const job = createJob("nexus.generate.model3d", "3D generation queued.", input.workspaceId);
    jobs.set(job.id, job);
    void runModel3dJob(job, input, baseUrl);
    return res.status(202).json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.post("/tools/nexus.finish.model3d", (req, res) => {
    const input = req.body as Model3dFinishInput;
    const validationError = validateModel3dFinishInput(input);
    if (validationError) return res.status(400).json(errorEnvelope("invalid_request", validationError, false));
    const job = createJob("nexus.finish.model3d", "3D finishing queued.", input.workspaceId);
    jobs.set(job.id, job);
    void runModel3dFinishJob(job, input, baseUrl);
    return res.status(202).json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.post("/tools/nexus.generate.video", (req, res) => {
    const input = req.body as VideoInput;
    const validationError = validateVideoInput(input);
    if (validationError) return res.status(400).json(errorEnvelope("invalid_request", validationError, false));
    const job = createJob("nexus.generate.video", "Video generation queued.", input.workspaceId);
    jobs.set(job.id, job);
    void runVideoJob(job, input, baseUrl);
    return res.status(202).json({ ok: true, workspaceId: job.workspaceId, requestId: job.id, data: { job: publicJob(job) } });
  });

  router.post("/tools/nexus.generate.animation", (req, res) => {
    const input = req.body as AnimationInput;
    const validationError = validateAnimationInput(input);
    if (validationError) return res.status(400).json(errorEnvelope("invalid_request", validationError, false));
    const job = createJob("nexus.generate.animation", "Animation generation queued.", input.workspaceId);
    jobs.set(job.id, job);
    void runAnimationJob(job, input, baseUrl);
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
      updateJob(job, "canceling", "Canceling asset operation...");
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
        : kind === "model3d"
          ? flattenModel3dAssets(payload.tree, workspaceId)
          : kind === "video"
            ? flattenVideoAssets(payload.tree, workspaceId)
            : kind === "animation"
              ? flattenAnimationAssets(payload.tree, workspaceId)
              : flattenImageAssets(payload.tree, workspaceId);
      return res.json({ ok: true, workspaceId, data: { assets } });
    } catch (error) {
      return res.status(502).json(errorEnvelope("asset_list_failed", String(error), true));
    }
  });

  return router;
}

function createJob(tool: BridgeJob["tool"], message: string, workspaceId?: string): BridgeJob {
  return {
    id: randomUUID(),
    tool,
    status: "queued",
    message,
    workspaceId: workspaceId?.trim() || "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    controller: new AbortController(),
  };
}

async function runModel3dJob(job: BridgeJob, input: Model3dInput, baseUrl: string): Promise<void> {
  await runSseAssetJob(
    job,
    `${baseUrl}/api/tools/hunyuan3d/generate/stream`,
    input,
    "Starting Hunyuan3D generation...",
    "3D model generated and ready to import.",
    normalizeModel3dAsset,
  );
}

async function runModel3dFinishJob(job: BridgeJob, input: Model3dFinishInput, baseUrl: string): Promise<void> {
  await runSseAssetJob(
    job,
    `${baseUrl}/api/tools/hunyuan3d/finish/stream`,
    input,
    "Starting Blender finishing...",
    "Finished 3D model ready to import.",
    normalizeModel3dAsset,
  );
}

async function runVideoJob(job: BridgeJob, input: VideoInput, baseUrl: string): Promise<void> {
  updateJob(job, "running", "Starting Wan2GP video generation...");
  const query = new URLSearchParams({
    workspaceId: job.workspaceId,
    prompt: input.prompt!.trim(),
    negativePrompt: input.negativePrompt?.trim() ?? "",
    model: input.model?.trim() || "auto",
    width: String(input.width ?? 640),
    height: String(input.height ?? 384),
    steps: String(input.steps ?? 6),
    durationSeconds: String(input.durationSeconds ?? 3),
    fps: String(input.fps ?? 16),
    frameCount: String(input.frameCount ?? 49),
    seed: String(input.seed ?? -1),
    profile: String(input.profile ?? 4),
  });
  try {
    const response = await fetch(`${baseUrl}/api/tools/wan2gp/video/stream?${query}`, { signal: job.controller.signal });
    if (!response.ok || !response.body) throw new Error(`Video generation returned HTTP ${response.status}.`);
    const result = await consumeSseResult(response, job);
    job.result = { asset: normalizeVideoAsset(result) };
    updateJob(job, "completed", "Video generated and ready to import.", true);
  } catch (error) {
    finishFailedJob(job, error, "Video generation canceled.");
  }
}

async function runAnimationJob(job: BridgeJob, input: AnimationInput, baseUrl: string): Promise<void> {
  updateJob(job, "running", "Starting Animato generation...");
  try {
    const response = await fetch(`${baseUrl}/api/tools/animation/generate/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, workspaceId: job.workspaceId }),
      signal: job.controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Animation generation returned HTTP ${response.status}.`);
    const result = await consumeSseResult(response, job);
    const clips = Array.isArray(result.clips) ? result.clips as Array<Record<string, unknown>> : [];
    if (!clips.length) throw new Error("Animato completed without animation clips.");
    job.result = { assets: clips.map((clip) => normalizeAnimationAsset(clip, job.workspaceId)) };
    updateJob(job, "completed", `${clips.length} animation variation(s) ready to import.`, true);
  } catch (error) {
    finishFailedJob(job, error, "Animation generation canceled.");
  }
}

function finishFailedJob(job: BridgeJob, error: unknown, canceledMessage: string): void {
  if (job.controller.signal.aborted) {
    updateJob(job, "canceled", canceledMessage, true);
    return;
  }
  job.error = { code: "generation_failed", message: String(error), retryable: true };
  updateJob(job, "failed", job.error.message, true);
}

async function runSseAssetJob(
  job: BridgeJob,
  url: string,
  input: object,
  startingMessage: string,
  completedMessage: string,
  normalize: (result: Record<string, unknown>) => Model3dAsset,
): Promise<void> {
  updateJob(job, "running", startingMessage);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, workspaceId: job.workspaceId }),
      signal: job.controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`NexusOS stream returned HTTP ${response.status}.`);
    const result = await consumeSseResult(response, job);
    job.result = { asset: normalize(result) };
    updateJob(job, "completed", completedMessage, true);
  } catch (error) {
    if (job.controller.signal.aborted) {
      updateJob(job, "canceled", "3D operation canceled.", true);
      return;
    }
    job.error = { code: "generation_failed", message: String(error), retryable: true };
    updateJob(job, "failed", job.error.message, true);
  }
}

async function consumeSseResult(response: globalThis.Response, job: BridgeJob): Promise<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Record<string, unknown> | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      const event = JSON.parse(data) as { type?: string; message?: string; result?: Record<string, unknown> };
      if (event.type === "status") updateJob(job, "running", event.message || "3D operation in progress...");
      if (event.type === "error") throw new Error(event.message || "3D operation failed.");
      if (event.type === "done" && event.result) result = event.result;
    }
    if (done) break;
  }
  if (!result) throw new Error("NexusOS stream ended without a completed asset.");
  return result;
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

function normalizeModel3dAsset(result: Record<string, unknown>): Model3dAsset {
  return {
    kind: "model3d",
    provider: String(result.provider ?? "hunyuan3d"),
    workspaceId: String(result.workspaceId ?? "default"),
    relativePath: String(result.relativePath ?? ""),
    downloadUrl: String(result.modelUrl ?? result.downloadUrl ?? ""),
    format: String(result.format ?? "obj"),
    finishProfile: String(result.profile ?? ""),
    sourceKind: String(result.sourceKind ?? ""),
    sourceImageUrl: String(result.sourceImageUrl ?? ""),
    sourceRelativePath: String(result.sourceRelativePath ?? ""),
  };
}

function normalizeVideoAsset(result: Record<string, unknown>): VideoAsset {
  return {
    kind: "video",
    provider: String(result.provider ?? "wan2gp"),
    model: String(result.model ?? "auto"),
    workspaceId: String(result.workspaceId ?? "default"),
    relativePath: String(result.relativePath ?? ""),
    downloadUrl: String(result.videoUrl ?? result.downloadUrl ?? ""),
    width: Number(result.width ?? 0),
    height: Number(result.height ?? 0),
    steps: Number(result.steps ?? 0),
    seed: Number(result.seed ?? -1),
    profile: Number(result.profile ?? 4),
    prompt: String(result.prompt ?? ""),
    negativePrompt: String(result.negativePrompt ?? ""),
    durationSeconds: Number(result.durationSeconds ?? 0),
    fps: Number(result.fps ?? 0),
    frameCount: Number(result.frameCount ?? 0),
  };
}

function normalizeAnimationAsset(result: Record<string, unknown>, workspaceId: string): AnimationAsset {
  return {
    kind: "animation",
    provider: "animato",
    variation: Number(result.variation ?? 1),
    workspaceId,
    relativePath: String(result.relativePath ?? ""),
    downloadUrl: String(result.modelUrl ?? result.downloadUrl ?? ""),
    format: String(result.format ?? "glb"),
    prompt: String(result.prompt ?? ""),
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

function flattenModel3dAssets(root: WorkspaceTreeNode | undefined, workspaceId: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const visit = (node: WorkspaceTreeNode | undefined) => {
    if (!node) return;
    if (node.type === "file" && node.path && /\.(obj|glb|gltf)$/i.test(node.path) && node.path.replace(/\\/g, "/").startsWith("Assets/models/")) {
      const relativePath = node.path.replace(/\\/g, "/");
      rows.push({
        kind: "model3d",
        relativePath,
        fileName: node.name || relativePath.split("/").pop() || relativePath,
        format: relativePath.split(".").pop()?.toLowerCase() ?? "",
        downloadUrl: `/api/tools/hunyuan3d/file?workspaceId=${encodeURIComponent(workspaceId)}&relativePath=${encodeURIComponent(relativePath)}`,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return rows
    .filter((row) => !row.fileName.toLowerCase().startsWith("animato-"))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function flattenVideoAssets(root: WorkspaceTreeNode | undefined, workspaceId: string): Array<Record<string, string>> {
  return flattenAssets(root, workspaceId, "video", "Assets/videos/", /\.(mp4|webm|mov)$/i, "/api/tools/wan2gp/file");
}

function flattenAnimationAssets(root: WorkspaceTreeNode | undefined, workspaceId: string): Array<Record<string, string>> {
  const rows = flattenAssets(root, workspaceId, "animation", "Assets/models/", /\.(glb|gltf|fbx)$/i, "/api/tools/hunyuan3d/file");
  return rows.filter((row) => row.fileName.toLowerCase().startsWith("animato-"));
}

function flattenAssets(
  root: WorkspaceTreeNode | undefined,
  workspaceId: string,
  kind: string,
  prefix: string,
  extensionPattern: RegExp,
  endpoint: string,
): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const visit = (node: WorkspaceTreeNode | undefined) => {
    if (!node) return;
    if (node.type === "file" && node.path && extensionPattern.test(node.path) && node.path.replace(/\\/g, "/").startsWith(prefix)) {
      const relativePath = node.path.replace(/\\/g, "/");
      rows.push({
        kind,
        relativePath,
        fileName: node.name || relativePath.split("/").pop() || relativePath,
        format: relativePath.split(".").pop()?.toLowerCase() ?? "",
        downloadUrl: `${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}&relativePath=${encodeURIComponent(relativePath)}`,
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

function validateModel3dInput(input: Model3dInput): string | null {
  if (!input || (!input.textPrompt?.trim() && !input.imageUrl?.trim())) return "textPrompt or imageUrl is required";
  if (input.format !== "obj" && input.format !== "glb") return "format must be obj or glb";
  if ((input.numInferenceSteps ?? 20) < 1 || (input.numInferenceSteps ?? 20) > 100) return "numInferenceSteps must be between 1 and 100";
  if ((input.octreeResolution ?? 192) < 64 || (input.octreeResolution ?? 192) > 512) return "octreeResolution must be between 64 and 512";
  return null;
}

function validateModel3dFinishInput(input: Model3dFinishInput): string | null {
  if (!input || !input.relativePath?.trim()) return "relativePath is required";
  if (!/\.(obj|glb|gltf)$/i.test(input.relativePath)) return "relativePath must be an obj, glb, or gltf model";
  if (input.outputFormat !== "obj" && input.outputFormat !== "glb") return "outputFormat must be obj or glb";
  const profiles = ["draft", "game-ready-low", "game-ready-med", "game-ready-high"];
  if (!input.profile || !profiles.includes(input.profile)) return "profile is invalid";
  return null;
}

function validateVideoInput(input: VideoInput): string | null {
  if (!input || !input.prompt?.trim()) return "prompt is required";
  if ((input.width ?? 640) < 320 || (input.width ?? 640) > 1024) return "width must be between 320 and 1024";
  if ((input.height ?? 384) < 192 || (input.height ?? 384) > 1024) return "height must be between 192 and 1024";
  if ((input.durationSeconds ?? 3) < 1 || (input.durationSeconds ?? 3) > 12) return "durationSeconds must be between 1 and 12";
  if ((input.fps ?? 16) < 8 || (input.fps ?? 16) > 32) return "fps must be between 8 and 32";
  if ((input.frameCount ?? 49) < 17 || (input.frameCount ?? 49) > 193) return "frameCount must be between 17 and 193";
  return null;
}

function validateAnimationInput(input: AnimationInput): string | null {
  if (!input || !input.prompt?.trim()) return "prompt is required";
  if (!input.sourceRelativePath?.trim()) return "sourceRelativePath is required";
  if (!/\.(glb|gltf|fbx)$/i.test(input.sourceRelativePath)) return "sourceRelativePath must be a rigged glb, gltf, or fbx model";
  if ((input.variations ?? 1) < 1 || (input.variations ?? 1) > 5) return "variations must be between 1 and 5";
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
