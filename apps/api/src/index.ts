import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildWorkspaceTree,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceById,
  listWorkspaces,
  listFoldersAt,
  listWorkspaceRoots,
  registerWorkspacePath,
} from "./lib/workspaceManager.js";
import { readHarnessRegistry, resolveHarnessHealth } from "./lib/harnessRegistry.js";
import { getRootDir, readSystemState, writeSystemState } from "./lib/stateStore.js";
import { getRouterSummary } from "./lib/routerStatus.js";
import type { ChatMessage, StartupReadiness, SystemState } from "./types.js";
import { invokeHarness, streamHarness } from "./lib/harnessAdapter.js";
import type { AdapterResult } from "./lib/harnessAdapter.js";
import { runHarnessConformance } from "./lib/conformance.js";
import {
  appendTaskOutput,
  buildReplayPrompt,
  createTask,
  getTask,
  listResumableTasks,
  updateTaskStatus,
} from "./lib/taskResumeEngine.js";
import { getLastStartupCheck, persistStartupCheck } from "./lib/startupCheckStore.js";
import {
  ensureRouterState,
  getRouterProviders,
  routeChatWithFallback,
  syncProviderModels,
  updateRouterConfig,
  upsertRouterProvider,
} from "./lib/nexusRouter.js";
import { ensureManagedHarnesses, getManagedHarnessRuntimeStatus } from "./lib/managedHarnessRuntime.js";
import { buildCookbookSnapshot, getVoiceStatus } from "./lib/toolAdvisor.js";
import {
  getRuntimeStatus,
  installAceJam,
  installDefaultPiperVoice,
  installOllama,
  installPiper,
  pullOllamaModel,
  startAceJamIfNeeded,
  startOllamaIfNeeded,
  synthesizeWithPiper,
  synthesizeWithPiperToFile,
} from "./lib/localRuntimeManager.js";
import {
  appendHarnessRun,
  deleteHarnessSchedule,
  ensureHarnessAutomationStore,
  listDueSchedules,
  listHarnessRuns,
  listHarnessSchedules,
  markScheduleRun,
  updateHarnessSchedule,
  upsertHarnessSchedule,
} from "./lib/harnessAutomation.js";
import {
  deleteHarnessThread,
  ensureHarnessChatStore,
  listHarnessThreads,
  upsertHarnessThread,
} from "./lib/harnessChats.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);
const activeStreams = new Map<string, AbortController>();
const activeScheduleRuns = new Set<string>();

type RuntimeJobAction =
  | "install-ollama"
  | "start-ollama"
  | "pull-ollama-model"
  | "install-piper"
  | "install-default-piper-voice"
  | "install-acejam"
  | "start-acejam";

type RuntimeJob = {
  id: string;
  action: RuntimeJobAction;
  model?: string;
  status: "queued" | "running" | "canceling" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
  cancelRequestedAt?: string;
  retryOfId?: string;
};

const runtimeJobs = new Map<string, RuntimeJob>();
const runtimeJobsPath = path.join(getRootDir(), "data", "runtime-jobs.local.json");
const piperAssignmentsPath = path.join(getRootDir(), "data", "piper-voice-assignments.local.json");
let runtimeJobsLoaded = false;
let runtimeJobPersistQueue: Promise<void> = Promise.resolve();

type WorkspaceWriteAction = {
  path: string;
  content: string;
};

function toRuntimeJobPayload(limit = 80): RuntimeJob[] {
  return Array.from(runtimeJobs.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}

async function loadRuntimeJobsFromDisk(): Promise<void> {
  if (runtimeJobsLoaded) {
    return;
  }

  runtimeJobsLoaded = true;

  try {
    const raw = await fs.readFile(runtimeJobsPath, "utf-8");
    const parsed = JSON.parse(raw) as { jobs?: RuntimeJob[] };
    for (const job of parsed.jobs ?? []) {
      runtimeJobs.set(job.id, job);
    }
  } catch {
    // No persisted runtime jobs yet.
  }
}

function scheduleRuntimeJobPersist(): void {
  runtimeJobPersistQueue = runtimeJobPersistQueue
    .then(async () => {
      await fs.mkdir(path.dirname(runtimeJobsPath), { recursive: true });
      await fs.writeFile(runtimeJobsPath, JSON.stringify({ jobs: toRuntimeJobPayload(200) }, null, 2), "utf-8");
    })
    .catch(() => {
      // Persist failures are non-fatal for runtime control.
    });
}

function requestRuntimeJobCancel(job: RuntimeJob): boolean {
  if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
    return false;
  }
  if (job.status === "queued") {
    job.status = "canceled";
    job.cancelRequestedAt = new Date().toISOString();
    job.finishedAt = job.cancelRequestedAt;
    job.updatedAt = job.cancelRequestedAt;
    appendRuntimeJobLog(job, "Canceled while queued.");
    return true;
  }

  if (job.status === "running") {
    job.status = "canceling";
    job.cancelRequestedAt = new Date().toISOString();
    job.updatedAt = job.cancelRequestedAt;
    appendRuntimeJobLog(job, "Cancellation requested. Waiting for current step to finish.");
    return true;
  }

  return false;
}

function ensureRuntimeJobNotCanceled(job: RuntimeJob): void {
  if (job.status === "canceling") {
    const canceled = new Error("Runtime job canceled");
    canceled.name = "RuntimeJobCanceledError";
    throw canceled;
  }
}

function createRuntimeJob(action: RuntimeJobAction, model?: string, retryOfId?: string): RuntimeJob {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    action,
    model: model?.trim(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    logs: [],
    retryOfId,
  };
}

function startRuntimeJob(job: RuntimeJob): void {
  runtimeJobs.set(job.id, job);
  appendRuntimeJobLog(job, "Queued");
  scheduleRuntimeJobPersist();

  void (async () => {
    try {
      if (job.status !== "queued") {
        return;
      }
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      appendRuntimeJobLog(job, "Job is running.");
      await executeRuntimeJob(job);
      ensureRuntimeJobNotCanceled(job);
      job.status = "completed";
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      appendRuntimeJobLog(job, "Completed successfully.");
      scheduleRuntimeJobPersist();
    } catch (error) {
      if (error instanceof Error && error.name === "RuntimeJobCanceledError") {
        job.status = "canceled";
        job.finishedAt = new Date().toISOString();
        job.updatedAt = job.finishedAt;
        appendRuntimeJobLog(job, "Canceled.");
      } else {
        job.status = "failed";
        job.error = String(error);
        job.finishedAt = new Date().toISOString();
        job.updatedAt = job.finishedAt;
        appendRuntimeJobLog(job, `Failed: ${job.error}`);
      }
      scheduleRuntimeJobPersist();
    }
  })();
}

function appendRuntimeJobLog(job: RuntimeJob, message: string): void {
  job.logs.push(`[${new Date().toISOString()}] ${message}`);
  if (job.logs.length > 200) {
    job.logs = job.logs.slice(job.logs.length - 200);
  }
  job.updatedAt = new Date().toISOString();
  scheduleRuntimeJobPersist();
}

async function readPiperAssignments(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(piperAssignmentsPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function writePiperAssignments(assignments: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(piperAssignmentsPath), { recursive: true });
  await fs.writeFile(piperAssignmentsPath, JSON.stringify(assignments, null, 2), "utf-8");
}

function inferExtensionFromContentType(contentType: string | null, fallback = "bin"): string {
  if (!contentType) return fallback;
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/jpeg")) return "jpg";
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("audio/wav")) return "wav";
  if (normalized.includes("audio/mpeg")) return "mp3";
  if (normalized.includes("audio/ogg")) return "ogg";
  return fallback;
}

function sanitizeFileNameSegment(input: string, fallback: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || fallback;
}

async function ensureWorkspaceAssetsDir(workspaceId?: string): Promise<{ workspaceId: string; assetsPath: string }> {
  const state = await readSystemState();
  const workspace = await resolveWorkspaceContext(state, workspaceId);
  if (!workspace.path) {
    throw new Error("Active workspace path is unavailable.");
  }
  const assetsPath = path.join(workspace.path, "Assets");
  await fs.mkdir(assetsPath, { recursive: true });
  return { workspaceId: workspace.id, assetsPath };
}

async function saveBufferToWorkspaceAssets(input: {
  workspaceId?: string;
  category: "images" | "voice" | "music";
  baseName: string;
  extension: string;
  bytes: Buffer;
}): Promise<{ workspaceId: string; absolutePath: string; relativePath: string }> {
  const resolved = await ensureWorkspaceAssetsDir(input.workspaceId);
  const categoryDir = path.join(resolved.assetsPath, input.category);
  await fs.mkdir(categoryDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${sanitizeFileNameSegment(input.baseName, input.category)}-${timestamp}.${input.extension}`;
  const absolutePath = path.join(categoryDir, fileName);
  await fs.writeFile(absolutePath, input.bytes);
  const relativePath = path.relative(path.dirname(resolved.assetsPath), absolutePath).replace(/\\/g, "/");

  return { workspaceId: resolved.workspaceId, absolutePath, relativePath };
}

function findActiveRuntimeJobByAction(action: RuntimeJobAction): RuntimeJob | undefined {
  return Array.from(runtimeJobs.values()).find((job) =>
    job.action === action && (job.status === "queued" || job.status === "running" || job.status === "canceling")
  );
}

async function ensureCoreRuntimeProvisioning(): Promise<void> {
  await loadRuntimeJobsFromDisk();
  const status = await getRuntimeStatus();
  if (!status.ollamaInstalled || !status.ollamaRunning) {
    if (!findActiveRuntimeJobByAction("install-ollama")) {
      const ollamaJob = createRuntimeJob("install-ollama");
      appendRuntimeJobLog(ollamaJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(ollamaJob);
    }
  }

  if (!status.piperInstalled) {
    if (!findActiveRuntimeJobByAction("install-piper")) {
      const piperJob = createRuntimeJob("install-piper");
      appendRuntimeJobLog(piperJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(piperJob);
    }
    return;
  }

  if (!status.defaultVoiceInstalled || status.piperVoices.length < 3) {
    if (!findActiveRuntimeJobByAction("install-default-piper-voice")) {
      const voiceJob = createRuntimeJob("install-default-piper-voice");
      appendRuntimeJobLog(voiceJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(voiceJob);
    }
  }
}

async function executeRuntimeJob(job: RuntimeJob): Promise<void> {
  ensureRuntimeJobNotCanceled(job);
  appendRuntimeJobLog(job, `Starting ${job.action}`);

  if (job.action === "install-ollama") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Installing Ollama runtime...");
    await installOllama();
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Starting Ollama service...");
    await startOllamaIfNeeded();
    appendRuntimeJobLog(job, "Ollama install completed.");
    return;
  }

  if (job.action === "start-ollama") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Starting Ollama service...");
    await startOllamaIfNeeded();
    appendRuntimeJobLog(job, "Ollama is running.");
    return;
  }

  if (job.action === "pull-ollama-model") {
    if (!job.model?.trim()) {
      throw new Error("pull-ollama-model requires a model name.");
    }
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, `Pulling Ollama model ${job.model}...`);
    await pullOllamaModel(job.model.trim());
    appendRuntimeJobLog(job, `Model ${job.model} pulled successfully.`);
    return;
  }

  if (job.action === "install-piper") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Installing Piper runtime...");
    await installPiper();
    appendRuntimeJobLog(job, "Piper install completed.");
    return;
  }

  if (job.action === "install-default-piper-voice") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Downloading default Piper voice...");
    await installDefaultPiperVoice();
    appendRuntimeJobLog(job, "Default Piper voice installed.");
    return;
  }

  if (job.action === "install-acejam") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Installing AceJAM runtime...");
    await installAceJam();
    appendRuntimeJobLog(job, "AceJAM install completed.");
    return;
  }

  if (job.action === "start-acejam") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Starting AceJAM service...");
    await startAceJamIfNeeded();
    appendRuntimeJobLog(job, "AceJAM is running.");
    return;
  }

  throw new Error(`Unsupported runtime action: ${job.action}`);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildStartupReadiness(onboardingComplete: boolean, liveHarnesses: number, totalHarnesses: number): StartupReadiness {
  const blockers: string[] = [];

  if (!onboardingComplete) {
    blockers.push("Nexus Router is not configured.");
  }

  if (liveHarnesses === 0) {
    blockers.push("No live harnesses detected. Start at least one harness service.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    onboardingComplete,
    liveHarnesses,
    totalHarnesses,
    checkedAt: new Date().toISOString(),
  };
}

async function applyWorkspaceActionsFromHarnessOutput(output: string, workspacePath: string): Promise<{ output: string; applied: number }> {
  const actions = extractWorkspaceWriteActions(output);
  if (!actions.length || !workspacePath) {
    return { output, applied: 0 };
  }

  const appliedPaths: string[] = [];
  for (const action of actions) {
    const targetPath = resolveWorkspaceTargetPath(workspacePath, action.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, action.content, "utf-8");
    appliedPaths.push(path.relative(workspacePath, targetPath).replace(/\\/g, "/"));
  }

  const footer = [
    "",
    "[workspace actions applied]",
    ...appliedPaths.map((relativePath) => `- wrote ${relativePath}`),
  ].join("\n");

  return {
    output: `${output}${footer}`,
    applied: appliedPaths.length,
  };
}

function extractWorkspaceWriteActions(output: string): WorkspaceWriteAction[] {
  const candidates = extractJsonCandidates(output);
  const actions: WorkspaceWriteAction[] = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      collectWorkspaceWriteActions(parsed, actions);
    } catch {
      // Ignore malformed snippets.
    }
  }

  // Fallback extractor for non-JSON tool payloads like single-quoted dicts.
  collectLooseWriteActions(output, actions);

  const unique = new Map<string, WorkspaceWriteAction>();
  for (const action of actions) {
    const key = `${action.path}::${action.content}`;
    unique.set(key, action);
  }
  return Array.from(unique.values());
}

function extractJsonCandidates(output: string): string[] {
  const candidates: string[] = [];
  const trimmed = output.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    candidates.push(trimmed);
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fencedMatch = fenced.exec(output);
  while (fencedMatch) {
    const snippet = fencedMatch[1]?.trim();
    if (snippet) {
      candidates.push(snippet);
    }
    fencedMatch = fenced.exec(output);
  }

  const inlineObject = /(\{[\s\S]*?["'](?:action|name|type)["']\s*:\s*["']write_file["'][\s\S]*?\})/gi;
  let inlineMatch = inlineObject.exec(output);
  while (inlineMatch) {
    const snippet = inlineMatch[1]?.trim();
    if (snippet) {
      candidates.push(snippet);
    }
    inlineMatch = inlineObject.exec(output);
  }

  return candidates;
}

function collectWorkspaceWriteActions(value: unknown, bucket: WorkspaceWriteAction[]): void {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectWorkspaceWriteActions(entry, bucket);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const obj = value as Record<string, unknown>;

  const actionName = typeof obj.action === "string"
    ? obj.action
    : (typeof obj.name === "string"
      ? obj.name
      : (typeof obj.type === "string" ? obj.type : ""));
  if (actionName === "write_file") {
    const pathValue = typeof obj.path === "string" ? obj.path : undefined;
    const contentValue = typeof obj.content === "string" ? obj.content : undefined;
    if (pathValue && contentValue !== undefined) {
      bucket.push({ path: pathValue.trim(), content: contentValue });
    }
  }

  if (actionName === "write_file" && obj.arguments) {
    if (typeof obj.arguments === "string") {
      try {
        const parsedArgs = tryParseMaybeJson(obj.arguments);
        const pathValue = typeof parsedArgs.path === "string" ? parsedArgs.path : undefined;
        const contentValue = typeof parsedArgs.content === "string" ? parsedArgs.content : undefined;
        if (pathValue && contentValue !== undefined) {
          bucket.push({ path: pathValue.trim(), content: contentValue });
        }
      } catch {
        // ignore invalid arguments payload
      }
    } else if (typeof obj.arguments === "object") {
      const args = obj.arguments as Record<string, unknown>;
      const pathValue = typeof args.path === "string" ? args.path : undefined;
      const contentValue = typeof args.content === "string" ? args.content : undefined;
      if (pathValue && contentValue !== undefined) {
        bucket.push({ path: pathValue.trim(), content: contentValue });
      }
    }
  }

  if (Array.isArray(obj.actions)) {
    collectWorkspaceWriteActions(obj.actions, bucket);
  }

  if (Array.isArray(obj.tool_calls)) {
    collectWorkspaceWriteActions(obj.tool_calls, bucket);
  }

  if (obj.function && typeof obj.function === "object") {
    collectWorkspaceWriteActions(obj.function, bucket);
  }
}

function tryParseMaybeJson(input: string): Record<string, unknown> {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    const normalized = input
      .replace(/([,{]\s*)'([^']+?)'\s*:/g, "$1\"$2\":")
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value) => `: \"${value.replace(/\"/g, "\\\"")}\"`);
    return JSON.parse(normalized) as Record<string, unknown>;
  }
}

function collectLooseWriteActions(output: string, bucket: WorkspaceWriteAction[]): void {
  const patterns = [
    /["'](?:action|name|type)["']\s*:\s*["']write_file["'][\s\S]*?["']path["']\s*:\s*["']([^"'\n]+)["'][\s\S]*?["']content["']\s*:\s*["']([\s\S]*?)["']/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(output);
    while (match) {
      const pathValue = match[1]?.trim();
      const contentValue = (match[2] ?? "").replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\\"/g, "\"");
      if (pathValue) {
        bucket.push({ path: pathValue, content: contentValue });
      }
      match = pattern.exec(output);
    }
  }
}

function resolveWorkspaceTargetPath(workspacePath: string, requestedPath: string): string {
  const root = path.resolve(workspacePath);
  const normalizedRequest = requestedPath.replace(/^\.?[\\/]+/, "").trim();
  if (!normalizedRequest) {
    throw new Error("write_file action provided an empty path");
  }

  const resolved = path.resolve(root, normalizedRequest);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`write_file path is outside workspace: ${requestedPath}`);
  }
  return resolved;
}

function isNexusRouterConfigured(state: SystemState): boolean {
  const router = ensureRouterState(state);
  return router.providers.some((provider) => provider.enabled);
}

async function resolveWorkspaceContext(state: SystemState, workspaceId?: string): Promise<{ id: string; path: string }> {
  const targetId = (workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const workspace = await getWorkspaceById(targetId);
  if (workspace) {
    return { id: workspace.id, path: workspace.path };
  }

  const fallback = await getWorkspaceById(state.activeWorkspaceId);
  if (fallback) {
    return { id: fallback.id, path: fallback.path };
  }

  return { id: targetId, path: "" };
}

async function runScheduledHarnessTask(input: {
  harnessId: string;
  workspaceId: string;
  prompt: string;
  trigger: "manual" | "scheduled";
  scheduleId?: string;
  attempt?: number;
  maxAttempts?: number;
}): Promise<{ ok: boolean }> {
  const state = await readSystemState();
  const workspace = await resolveWorkspaceContext(state, input.workspaceId);
  const harnesses = await readHarnessRegistry();
  const harness = harnesses.find((entry) => entry.id === input.harnessId);
  const startedAt = Date.now();
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 1;
  if (!harness) {
    appendHarnessRun(state, {
      id: crypto.randomUUID(),
      harnessId: input.harnessId,
      workspaceId: input.workspaceId,
      scheduleId: input.scheduleId,
      trigger: input.trigger,
      prompt: input.prompt,
      status: "failed",
      error: `Unknown harness ${input.harnessId}`,
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    });
    await writeSystemState(state);
    return { ok: false };
  }

  try {
    const result = await invokeHarness({
      harness,
      message: input.prompt,
      history: [],
      state,
      workspace,
    });

    appendHarnessRun(state, {
      id: crypto.randomUUID(),
      harnessId: input.harnessId,
      workspaceId: input.workspaceId,
      scheduleId: input.scheduleId,
      trigger: input.trigger,
      prompt: input.prompt,
      status: "completed",
      output: result.content,
      model: result.meta.model,
      provider: result.meta.provider,
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    });
    await writeSystemState(state);
    return { ok: true };
  } catch (error) {
    appendHarnessRun(state, {
      id: crypto.randomUUID(),
      harnessId: input.harnessId,
      workspaceId: input.workspaceId,
      scheduleId: input.scheduleId,
      trigger: input.trigger,
      prompt: input.prompt,
      status: "failed",
      error: String(error),
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    });
    await writeSystemState(state);
    return { ok: false };
  }
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nexus-os-api" });
});

app.get("/api/bootstrap", async (_req, res) => {
  void ensureCoreRuntimeProvisioning();
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const harnessStatus = await resolveHarnessHealth(harnesses);
  const runtimeStatus = await getRuntimeStatus();
  const workspaces = await listWorkspaces({
    [state.activeWorkspaceId]: harnessStatus.filter((h) => h.status === "online").map((h) => h.id),
  });
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
    ? state.activeWorkspaceId
    : (workspaces[0]?.id ?? "default");
  if (activeWorkspaceId !== state.activeWorkspaceId) {
    state.activeWorkspaceId = activeWorkspaceId;
    await writeSystemState(state);
  }
  const liveHarnesses = harnessStatus.filter((entry) => entry.status === "online").length;
  const routerConfigured = isNexusRouterConfigured(state);
  const startup = buildStartupReadiness(routerConfigured, liveHarnesses, harnessStatus.length);
  const selectedPane = state.selectedPane.id === "9router"
    ? { type: "tool" as const, id: "nexus-router" }
    : state.selectedPane;

  res.json({
    appName: "NEXUS OS",
    onboardingRequired: !routerConfigured,
    selectedPane,
    activeWorkspaceId,
    harnesses: harnessStatus,
    startup,
    tools: [
      {
        id: "nexus-router",
        name: "Nexus Router",
        status: (state.nexusRouter?.providers ?? []).some((p) => p.enabled) ? "online" : "setup-required",
      },
      { id: "cookbook", name: "Cookbook", status: "online" },
      { id: "voice-studio", name: "Voice Studio", status: "online" },
      {
        id: "music-generator",
        name: "Music Generator",
        status: runtimeStatus.acejamRunning ? "online" : (runtimeStatus.acejamInstalled ? "setup-required" : "offline"),
      },
      { id: "image-generator", name: "Image Generator", status: "online" },
      { id: "video-generator", name: "Video Generator", status: "offline" },
    ],
    router9: getRouterSummary(state),
    workspaces,
  });
});

app.get("/api/harnesses", async (_req, res) => {
  const harnesses = await readHarnessRegistry();
  const status = await resolveHarnessHealth(harnesses);
  res.json({ harnesses: status });
});

app.get("/api/harnesses/runtime", (_req, res) => {
  res.json({ runtimes: getManagedHarnessRuntimeStatus() });
});

app.get("/api/tools/cookbook/scan", async (_req, res) => {
  const state = await readSystemState();
  const snapshot = await buildCookbookSnapshot(state);
  res.json(snapshot);
});

app.get("/api/tools/runtimes/status", async (_req, res) => {
  void ensureCoreRuntimeProvisioning();
  const status = await getRuntimeStatus();
  res.json(status);
});

app.get("/api/tools/runtimes/jobs", async (_req, res) => {
  await loadRuntimeJobsFromDisk();
  const jobs = toRuntimeJobPayload();
  res.json({ jobs });
});

app.get("/api/tools/runtimes/jobs/:jobId", async (req, res) => {
  await loadRuntimeJobsFromDisk();
  const job = runtimeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Unknown runtime job" });
  }
  return res.json({ job });
});

app.post("/api/tools/runtimes/jobs", async (req, res) => {
  await loadRuntimeJobsFromDisk();
  const body = req.body as { action?: RuntimeJobAction; model?: string };
  if (!body.action) {
    return res.status(400).json({ error: "action is required" });
  }

  const job = createRuntimeJob(body.action, body.model);
  startRuntimeJob(job);

  return res.status(202).json({ ok: true, job });
});

app.post("/api/tools/runtimes/jobs/:jobId/cancel", async (req, res) => {
  await loadRuntimeJobsFromDisk();
  const job = runtimeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Unknown runtime job" });
  }

  const accepted = requestRuntimeJobCancel(job);
  scheduleRuntimeJobPersist();
  if (!accepted) {
    return res.status(409).json({ error: "Runtime job is already finished", job });
  }
  return res.json({ ok: true, job });
});

app.post("/api/tools/runtimes/jobs/:jobId/retry", async (req, res) => {
  await loadRuntimeJobsFromDisk();
  const job = runtimeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Unknown runtime job" });
  }

  if (job.status !== "failed" && job.status !== "canceled") {
    return res.status(409).json({ error: "Only failed or canceled jobs can be retried", job });
  }

  const retryJob = createRuntimeJob(job.action, job.model, job.id);
  appendRuntimeJobLog(retryJob, `Retry created from job ${job.id}.`);
  startRuntimeJob(retryJob);
  return res.status(202).json({ ok: true, job: retryJob });
});

app.post("/api/tools/runtimes/install", async (req, res) => {
  const body = req.body as { runtime?: "ollama" | "piper" | "default-piper-voice" | "acejam" };
  try {
    if (body.runtime === "ollama") {
      await installOllama();
      await startOllamaIfNeeded();
    } else if (body.runtime === "acejam") {
      await installAceJam();
    } else if (body.runtime === "piper") {
      await installPiper();
    } else if (body.runtime === "default-piper-voice") {
      await installDefaultPiperVoice();
    } else {
      return res.status(400).json({ error: "Unknown runtime target" });
    }

    const status = await getRuntimeStatus();
    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/runtimes/ollama/start", async (_req, res) => {
  try {
    await startOllamaIfNeeded();
    const status = await getRuntimeStatus();
    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/runtimes/acejam/start", async (_req, res) => {
  try {
    await startAceJamIfNeeded();
    const status = await getRuntimeStatus();
    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/runtimes/ollama/pull", async (req, res) => {
  const body = req.body as { model?: string };
  if (!body.model?.trim()) {
    return res.status(400).json({ error: "model is required" });
  }

  try {
    await pullOllamaModel(body.model.trim());
    const status = await getRuntimeStatus();
    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/voice/status", async (_req, res) => {
  void ensureCoreRuntimeProvisioning();
  const status = await getVoiceStatus();
  res.json(status);
});

app.get("/api/tools/voice/voices", async (_req, res) => {
  const runtime = await getRuntimeStatus();
  const assignments = await readPiperAssignments();
  res.json({
    voices: runtime.piperVoices,
    defaultVoiceId: runtime.piperVoices.includes("en_US-lessac-medium") ? "en_US-lessac-medium" : runtime.piperVoices[0] ?? null,
    assignments,
  });
});

app.get("/api/tools/voice/assignments", async (_req, res) => {
  const harnesses = await readHarnessRegistry();
  const runtime = await getRuntimeStatus();
  const assignments = await readPiperAssignments();
  res.json({
    voices: runtime.piperVoices,
    harnesses: harnesses.map((h) => ({ id: h.id, name: h.name })),
    assignments,
  });
});

app.post("/api/tools/voice/assignments", async (req, res) => {
  const body = req.body as { assignments?: Record<string, string> };
  if (!body.assignments || typeof body.assignments !== "object") {
    return res.status(400).json({ error: "assignments map is required" });
  }

  const runtime = await getRuntimeStatus();
  const validVoiceSet = new Set(runtime.piperVoices);
  const cleaned: Record<string, string> = {};
  for (const [harnessId, voiceId] of Object.entries(body.assignments)) {
    const trimmedVoice = voiceId.trim();
    if (trimmedVoice && validVoiceSet.has(trimmedVoice)) {
      cleaned[harnessId.trim()] = trimmedVoice;
    }
  }

  await writePiperAssignments(cleaned);
  return res.json({ ok: true, assignments: cleaned });
});

app.post("/api/tools/voice/speak", async (req, res) => {
  const body = req.body as { text?: string; voiceId?: string };
  if (!body.text?.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  try {
    const audio = await synthesizeWithPiper(body.text.trim(), body.voiceId?.trim());
    return res.json({ ok: true, ...audio });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/voice/save", async (req, res) => {
  const body = req.body as { text?: string; voiceId?: string; workspaceId?: string; fileName?: string };
  if (!body.text?.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  try {
    const voiceId = body.voiceId?.trim() || "default";
    const saveTarget = await ensureWorkspaceAssetsDir(body.workspaceId);
    const destination = path.join(
      saveTarget.assetsPath,
      "voice",
      `${sanitizeFileNameSegment(body.fileName ?? `tts-${voiceId}`, "tts")}-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`,
    );
    await synthesizeWithPiperToFile(body.text.trim(), destination, body.voiceId?.trim());
    return res.json({ ok: true, workspaceId: saveTarget.workspaceId, absolutePath: destination, relativePath: path.relative(path.dirname(saveTarget.assetsPath), destination).replace(/\\/g, "/") });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/image/generate", async (req, res) => {
  const body = req.body as { prompt?: string };
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&nologo=true&enhance=true&seed=${Date.now()}`;
    return res.json({ ok: true, imageUrl, engine: "pollinations", model: "flux" });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/image/save", async (req, res) => {
  const body = req.body as { imageUrl?: string; prompt?: string; workspaceId?: string; fileName?: string };
  const imageUrl = body.imageUrl?.trim();
  if (!imageUrl) {
    return res.status(400).json({ error: "imageUrl is required" });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return res.status(500).json({ error: `Failed to download image: ${response.status} ${response.statusText}` });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const extension = inferExtensionFromContentType(response.headers.get("content-type"), "png");
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId: body.workspaceId,
      category: "images",
      baseName: body.fileName ?? body.prompt ?? "generated-image",
      extension,
      bytes,
    });
    return res.json({ ok: true, ...saved });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/music/save", async (req, res) => {
  const body = req.body as { sourceUrl?: string; workspaceId?: string; fileName?: string };
  const sourceUrl = body.sourceUrl?.trim();
  if (!sourceUrl) {
    return res.status(400).json({ error: "sourceUrl is required" });
  }

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return res.status(500).json({ error: `Failed to download music file: ${response.status} ${response.statusText}` });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const extension = inferExtensionFromContentType(response.headers.get("content-type"), "wav");
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId: body.workspaceId,
      category: "music",
      baseName: body.fileName ?? "generated-music",
      extension,
      bytes,
    });
    return res.json({ ok: true, ...saved });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/harnesses/conformance", async (_req, res) => {
  const harnesses = await readHarnessRegistry();
  const results = await runHarnessConformance(harnesses);
  res.json({ results });
});

app.get("/api/startup/check", async (_req, res) => {
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const conformance = await runHarnessConformance(harnesses, state);

  const liveHarnesses = conformance.filter((item) =>
    item.checks.some((check) => (check.name === "live-health-check" || check.name.startsWith("live-probe-")) && check.passed)
  ).length;

  const startup = buildStartupReadiness(isNexusRouterConfigured(state), liveHarnesses, harnesses.length);
  await persistStartupCheck(startup);
  res.json({ startup, conformance });
});

app.get("/api/startup/check/last", async (_req, res) => {
  const last = await getLastStartupCheck();
  res.json({ last });
});

app.get("/api/tools/9router/status", async (_req, res) => {
  const state = await readSystemState();
  res.json(getRouterSummary(state));
});

app.get("/api/tools/9router/probe", async (_req, res) => {
  const state = await readSystemState();
  let origin = "http://localhost:20128";

  try {
    origin = new URL(state.router9.baseUrl).origin;
  } catch {
    // Keep fallback origin
  }

  const candidates = [`${origin}/dashboard`, `${origin}/`];
  const checks: Array<{ url: string; ok: boolean; status?: number; error?: string }> = [];

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, 2000);
      checks.push({ url, ok: response.ok, status: response.status });
    } catch (error) {
      checks.push({ url, ok: false, error: String(error) });
    }
  }

  const preferred = checks.find((entry) => entry.ok) ?? checks[0];
  const dashboardUrl = preferred?.url ?? `${origin}/dashboard`;
  const reachable = checks.some((entry) => entry.ok);

  res.json({
    origin,
    dashboardUrl,
    reachable,
    checks,
    checkedAt: new Date().toISOString(),
  });
});

app.post("/api/tools/9router/config", async (req, res) => {
  const { apiKey, baseUrl, defaultModel, fallbackOrder } = req.body as {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    fallbackOrder?: string[];
  };

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl.trim())) {
    return res.status(400).json({ error: "A valid 9router base URL is required (http/https)." });
  }

  const state = await readSystemState();
  state.router9.apiKey = apiKey?.trim() || "";
  state.router9.baseUrl = baseUrl.trim();
  state.router9.defaultModel = defaultModel?.trim() || state.router9.defaultModel;
  state.router9.fallbackOrder = Array.isArray(fallbackOrder) && fallbackOrder.length > 0
    ? fallbackOrder
    : state.router9.fallbackOrder;
  state.onboardingComplete = true;
  state.selectedPane = { type: "agent", id: "hermes" };
  state.router9.logs.unshift({
    timestamp: new Date().toISOString(),
    level: "info",
    message: state.router9.apiKey
      ? "9router configured with API key. Provider routing is enabled."
      : "9router configured in local mode (no API key). Provider routing is enabled.",
  });

  await writeSystemState(state);
  return res.json({ ok: true, router9: getRouterSummary(state) });
});

app.get("/api/router/providers", async (_req, res) => {
  const state = await readSystemState();
  res.json({ providers: getRouterProviders(state) });
});

app.post("/api/router/providers", async (req, res) => {
  const body = req.body as {
    id?: string;
    name?: string;
    type?: "openai-compatible" | "openrouter";
    baseUrl?: string;
    apiKey?: string;
    enabled?: boolean;
    defaultModel?: string;
  };

  if (!body.id || !body.name || !body.type || !body.baseUrl) {
    return res.status(400).json({ error: "id, name, type, and baseUrl are required" });
  }

  const state = await readSystemState();
  const provider = upsertRouterProvider(state, {
    id: body.id,
    name: body.name,
    type: body.type,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    enabled: body.enabled,
    defaultModel: body.defaultModel,
  });
  state.onboardingComplete = isNexusRouterConfigured(state);
  if (state.onboardingComplete && state.selectedPane.id === "9router") {
    state.selectedPane = { type: "tool", id: "nexus-router" };
  }
  await writeSystemState(state);
  return res.json({ ok: true, provider });
});

app.get("/api/router/models", async (req, res) => {
  const providerId = String(req.query.providerId ?? "").trim();
  if (!providerId) {
    return res.status(400).json({ error: "providerId is required" });
  }

  const state = await readSystemState();
  try {
    const models = await syncProviderModels(state, providerId);
    await writeSystemState(state);
    return res.json({ providerId, models });
  } catch (error) {
    return res.status(502).json({ error: String(error) });
  }
});

app.get("/api/router/config", async (_req, res) => {
  const state = await readSystemState();
  const router = ensureRouterState(state);
  res.json({
    fallbackChain: router.fallbackChain,
    harnessAssignments: router.harnessAssignments,
    retryPolicy: router.retryPolicy,
    logs: router.logs.slice(0, 30),
  });
});

app.post("/api/router/config", async (req, res) => {
  const body = req.body as {
    fallbackChain?: Array<{ providerId: string; model: string }>;
    harnessAssignments?: Record<string, Array<{ providerId: string; model: string }>>;
    retryPolicy?: {
      maxAttempts?: number;
      backoffMs?: number;
      retryOnStatus?: number[];
    };
  };

  const state = await readSystemState();
  const updated = updateRouterConfig(state, {
    fallbackChain: body.fallbackChain,
    harnessAssignments: body.harnessAssignments,
    retryPolicy: body.retryPolicy,
  });
  state.onboardingComplete = isNexusRouterConfigured(state);
  await writeSystemState(state);
  res.json({ ok: true, ...updated });
});

app.post("/api/router/chat", async (req, res) => {
  const body = req.body as {
    providerId?: string;
    model?: string;
    harnessId?: string;
    fallbackChain?: Array<{ providerId: string; model: string }>;
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    temperature?: number;
  };

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  const state = await readSystemState();
  try {
    const result = await routeChatWithFallback(state, {
      providerId: body.providerId,
      model: body.model,
      harnessId: body.harnessId,
      fallbackChain: body.fallbackChain,
      messages: body.messages,
      temperature: body.temperature,
    });
    await writeSystemState(state);
    return res.json(result);
  } catch (error) {
    await writeSystemState(state);
    return res.status(502).json({ error: String(error) });
  }
});

app.get("/api/harnesses/:harnessId/chats", async (req, res) => {
  const { harnessId } = req.params;
  const state = await readSystemState();
  const workspaceId = String(req.query.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const threads = listHarnessThreads(state, workspaceId, harnessId);
  return res.json({ workspaceId, harnessId, threads });
});

app.put("/api/harnesses/:harnessId/chats/:threadId", async (req, res) => {
  const { harnessId, threadId } = req.params;
  const body = req.body as {
    workspaceId?: string;
    title?: string;
    messages?: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; createdAt: string }>;
    meta?: {
      model: string;
      provider: string;
      fallbackUsed: boolean;
      elapsedMs: number;
      tokenUsage: { input: number; output: number };
    } | null;
    createdAt?: string;
    updatedAt?: string;
  };

  const state = await readSystemState();
  const workspaceId = String(body.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const thread = upsertHarnessThread(state, {
    workspaceId,
    harnessId,
    thread: {
      id: threadId,
      title: body.title ?? "New chat",
      messages: body.messages ?? [],
      meta: body.meta ?? null,
      createdAt: body.createdAt ?? new Date().toISOString(),
      updatedAt: body.updatedAt ?? new Date().toISOString(),
    },
  });
  await writeSystemState(state);
  return res.json({ ok: true, thread });
});

app.delete("/api/harnesses/:harnessId/chats/:threadId", async (req, res) => {
  const { harnessId, threadId } = req.params;
  const state = await readSystemState();
  const workspaceId = String(req.query.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const removed = deleteHarnessThread(state, workspaceId, harnessId, threadId);
  if (!removed) {
    return res.status(404).json({ error: "thread not found" });
  }
  await writeSystemState(state);
  return res.json({ ok: true });
});

app.get("/api/harnesses/:harnessId/schedules", async (req, res) => {
  const { harnessId } = req.params;
  const state = await readSystemState();
  const workspaceId = String(req.query.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const schedules = listHarnessSchedules(state, workspaceId, harnessId);
  res.json({ workspaceId, harnessId, schedules });
});

app.post("/api/harnesses/:harnessId/schedules", async (req, res) => {
  const { harnessId } = req.params;
  const body = req.body as {
    workspaceId?: string;
    id?: string;
    title?: string;
    prompt?: string;
    intervalMinutes?: number;
    enabled?: boolean;
  };

  if (!body.prompt || !body.prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const state = await readSystemState();
  const workspaceId = (body.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const schedule = upsertHarnessSchedule(state, {
    workspaceId,
    harnessId,
    id: body.id,
    title: body.title,
    prompt: body.prompt,
    intervalMinutes: body.intervalMinutes,
    enabled: body.enabled,
  });
  await writeSystemState(state);
  return res.json({ ok: true, schedule });
});

app.delete("/api/harnesses/:harnessId/schedules/:scheduleId", async (req, res) => {
  const { harnessId, scheduleId } = req.params;
  const state = await readSystemState();
  const workspaceId = String(req.query.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const removed = deleteHarnessSchedule(state, workspaceId, harnessId, scheduleId);
  if (!removed) {
    return res.status(404).json({ error: "schedule not found" });
  }
  await writeSystemState(state);
  return res.json({ ok: true });
});

app.patch("/api/harnesses/:harnessId/schedules/:scheduleId", async (req, res) => {
  const { harnessId, scheduleId } = req.params;
  const body = req.body as {
    workspaceId?: string;
    title?: string;
    prompt?: string;
    intervalMinutes?: number;
    enabled?: boolean;
  };

  const state = await readSystemState();
  const workspaceId = String(body.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const schedule = updateHarnessSchedule(state, {
    workspaceId,
    harnessId,
    scheduleId,
    patch: {
      title: body.title,
      prompt: body.prompt,
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled,
    },
  });

  if (!schedule) {
    return res.status(404).json({ error: "schedule not found" });
  }

  await writeSystemState(state);
  return res.json({ ok: true, schedule });
});

app.get("/api/harnesses/:harnessId/runs", async (req, res) => {
  const { harnessId } = req.params;
  const state = await readSystemState();
  const workspaceId = String(req.query.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const runs = listHarnessRuns(state, workspaceId, harnessId);
  res.json({ workspaceId, harnessId, runs });
});

app.post("/api/harnesses/:harnessId/runs/manual", async (req, res) => {
  const { harnessId } = req.params;
  const body = req.body as { workspaceId?: string; prompt?: string };
  if (!body.prompt || !body.prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const state = await readSystemState();
  const workspaceId = (body.workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  await runScheduledHarnessTask({
    harnessId,
    workspaceId,
    prompt: body.prompt,
    trigger: "manual",
    attempt: 1,
    maxAttempts: 1,
  });

  const refreshed = await readSystemState();
  const runs = listHarnessRuns(refreshed, workspaceId, harnessId);
  return res.json({ ok: true, run: runs[0] ?? null });
});

app.get("/api/workspaces", async (_req, res) => {
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const records = await listWorkspaces({
    [state.activeWorkspaceId]: harnesses.map((h) => h.id),
  });
  const activeWorkspaceId = records.some((workspace) => workspace.id === state.activeWorkspaceId)
    ? state.activeWorkspaceId
    : (records[0]?.id ?? "default");
  if (activeWorkspaceId !== state.activeWorkspaceId) {
    state.activeWorkspaceId = activeWorkspaceId;
    await writeSystemState(state);
  }
  res.json({
    activeWorkspaceId,
    workspaces: records,
  });
});

app.post("/api/workspaces", async (req, res) => {
  const { name, workspacePath } = req.body as { name?: string; workspacePath?: string };
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: "Workspace name must be at least 2 characters." });
  }

  try {
    const created = workspacePath?.trim()
      ? await registerWorkspacePath({ name, workspacePath })
      : await createWorkspace(name);
    return res.json({ ok: true, workspace: created });
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }
});

app.get("/api/workspaces/browse/roots", async (_req, res) => {
  const roots = await listWorkspaceRoots();
  return res.json({ roots });
});

app.get("/api/workspaces/browse", async (req, res) => {
  const targetPath = String(req.query.path ?? "").trim();
  if (!targetPath) {
    return res.status(400).json({ error: "path is required" });
  }

  try {
    const listing = await listFoldersAt(targetPath);
    return res.json(listing);
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }
});

app.delete("/api/workspaces/:id", async (req, res) => {
  const { id } = req.params;
  if (id === "default") {
    return res.status(400).json({ error: "The default workspace cannot be deleted." });
  }

  await deleteWorkspace(id);

  const state = await readSystemState();
  if (state.activeWorkspaceId === id) {
    state.activeWorkspaceId = "default";
    await writeSystemState(state);
  }

  return res.json({ ok: true });
});

app.post("/api/workspaces/switch", async (req, res) => {
  const { id } = req.body as { id?: string };
  if (!id) {
    return res.status(400).json({ error: "Workspace id is required." });
  }

  const exists = await getWorkspaceById(id);
  if (!exists) {
    return res.status(404).json({ error: `Unknown workspace ${id}` });
  }

  const state = await readSystemState();
  state.activeWorkspaceId = id;
  await writeSystemState(state);
  return res.json({ ok: true });
});

app.get("/api/workspaces/:id/tree", async (req, res) => {
  const { id } = req.params;
  try {
    const tree = await buildWorkspaceTree(id);
    return res.json({ tree });
  } catch (error) {
    return res.status(404).json({ error: String(error) });
  }
});

app.post("/api/chat", async (req, res) => {
  const { harnessId, message, history, requestId } = req.body as {
    harnessId: string;
    message: string;
    history?: ChatMessage[];
    requestId?: string;
  };

  const state = await readSystemState();
  const workspace = await resolveWorkspaceContext(state, state.activeWorkspaceId);
  const safeHistory = history ?? [];
  const harnesses = await readHarnessRegistry();
  const harness = harnesses.find((entry) => entry.id === harnessId);
  const taskId = requestId ?? crypto.randomUUID();

  if (!isNexusRouterConfigured(state)) {
    return res.status(412).json({
      error: "Complete Nexus Router setup before starting chats.",
    });
  }

  if (!harness) {
    return res.status(404).json({ error: `Unknown harness: ${harnessId}` });
  }

  await createTask({
    requestId: taskId,
    harnessId,
    workspaceId: workspace.id,
    mode: "sync",
    message,
    history: safeHistory,
    startedAt: new Date().toISOString(),
  });

  let adapterResult: AdapterResult;
  try {
    adapterResult = await invokeHarness({
      harness,
      message,
      history: safeHistory,
      state,
      workspace,
    });

    if (workspace.path) {
      const actionResult = await applyWorkspaceActionsFromHarnessOutput(adapterResult.content, workspace.path);
      adapterResult = {
        ...adapterResult,
        content: actionResult.output,
      };
    }
  } catch (error) {
    await updateTaskStatus(taskId, "failed", { error: String(error) });
    return res.status(502).json({ error: String(error), requestId: taskId });
  }

  state.router9.logs.unshift({
    timestamp: new Date().toISOString(),
    level: "info",
    message: `Routed request for ${harnessId} to ${adapterResult.meta.model} via ${state.router9.baseUrl}`,
  });

  if (state.router9.logs.length > 30) {
    state.router9.logs = state.router9.logs.slice(0, 30);
  }

  await writeSystemState(state);

  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: adapterResult.content,
    createdAt: new Date().toISOString(),
  };

  await updateTaskStatus(taskId, "completed", {
    finalOutput: adapterResult.content,
    meta: adapterResult.meta,
  });

  return res.json({
    requestId: taskId,
    message: assistantMessage,
    meta: adapterResult.meta,
  });
});

app.post("/api/chat/stop", (req, res) => {
  const { requestId } = req.body as { requestId?: string };
  if (!requestId) {
    return res.status(400).json({ error: "requestId is required" });
  }

  const controller = activeStreams.get(requestId);
  if (controller) {
    controller.abort();
    activeStreams.delete(requestId);
  }

  void updateTaskStatus(requestId, "aborted", { error: "Stopped by user" });

  return res.json({ ok: true });
});

app.get("/api/chat/tasks/resumable", async (_req, res) => {
  const tasks = await listResumableTasks();
  res.json({ tasks });
});

app.post("/api/chat/tasks/:requestId/resume", async (req, res) => {
  const { requestId } = req.params;
  const state = await readSystemState();
  const task = await getTask(requestId);

  if (!task) {
    return res.status(404).json({ error: `Unknown task ${requestId}` });
  }

  if (task.status !== "failed") {
    return res.status(400).json({ error: `Task ${requestId} is not resumable` });
  }

  const harnesses = await readHarnessRegistry();
  const harness = harnesses.find((entry) => entry.id === task.harnessId);
  if (!harness) {
    return res.status(404).json({ error: `Unknown harness ${task.harnessId}` });
  }

  const replayPrompt = buildReplayPrompt(task);
  const workspace = await resolveWorkspaceContext(state, task.workspaceId);
  const resumed = await invokeHarness({
    harness,
    message: replayPrompt,
    history: task.history,
    state,
    workspace,
  });

  const resumedContent = workspace.path
    ? (await applyWorkspaceActionsFromHarnessOutput(resumed.content, workspace.path)).output
    : resumed.content;

  await updateTaskStatus(requestId, "completed", {
    finalOutput: `${task.partialOutput}${resumedContent}`,
    meta: resumed.meta,
  });

  return res.json({
    requestId,
    resumed: true,
    content: resumedContent,
    meta: resumed.meta,
  });
});

app.post("/api/chat/stream", async (req, res) => {
  const { harnessId, message, history, requestId } = req.body as {
    harnessId: string;
    message: string;
    history?: ChatMessage[];
    requestId?: string;
  };

  if (!requestId) {
    return res.status(400).json({ error: "requestId is required" });
  }

  const state = await readSystemState();
  const workspace = await resolveWorkspaceContext(state, state.activeWorkspaceId);
  const safeHistory = history ?? [];
  const harnesses = await readHarnessRegistry();
  const harness = harnesses.find((entry) => entry.id === harnessId);

  if (!isNexusRouterConfigured(state)) {
    return res.status(412).json({ error: "Complete Nexus Router setup before starting chats." });
  }

  if (!harness) {
    return res.status(404).json({ error: `Unknown harness: ${harnessId}` });
  }

  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  await createTask({
    requestId,
    harnessId,
    workspaceId: workspace.id,
    mode: "stream",
    message,
    history: safeHistory,
    startedAt: new Date().toISOString(),
  });

  req.on("close", () => {
    controller.abort();
    activeStreams.delete(requestId);
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let output = "";
    let latestMeta:
      | {
          model: string;
          provider: string;
          fallbackUsed: boolean;
          elapsedMs: number;
          tokenUsage: { input: number; output: number };
        }
      | undefined;

    for await (const chunk of streamHarness({
      harness,
      message,
      history: safeHistory,
      state,
      workspace,
      signal: controller.signal,
    })) {
      if (controller.signal.aborted) {
        break;
      }

      if (chunk.type === "meta") {
        latestMeta = chunk.meta;
      }

      if (chunk.type === "delta") {
        output += chunk.text;
        await appendTaskOutput(requestId, chunk.text);
      }

      res.write(`data: ${JSON.stringify(chunk)}\n\n`);

      if (chunk.type === "done") {
        break;
      }
    }

    state.router9.logs.unshift({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Streaming route completed for ${harnessId} on ${latestMeta?.model ?? state.router9.defaultModel}`,
    });
    if (state.router9.logs.length > 30) {
      state.router9.logs = state.router9.logs.slice(0, 30);
    }
    await writeSystemState(state);

    let finalOutput = output;
    if (!controller.signal.aborted && workspace.path) {
      const actionResult = await applyWorkspaceActionsFromHarnessOutput(output, workspace.path);
      finalOutput = actionResult.output;
      if (actionResult.applied > 0) {
        const suffix = finalOutput.slice(output.length);
        if (suffix.trim()) {
          res.write(`data: ${JSON.stringify({ type: "delta", text: suffix })}\n\n`);
        }
      }
    }

    await updateTaskStatus(requestId, controller.signal.aborted ? "aborted" : "completed", {
      finalOutput,
      meta: latestMeta,
      error: controller.signal.aborted ? "Stopped by user" : undefined,
    });

    res.write("data: {\"type\":\"done\"}\n\n");
    res.end();
  } catch (error) {
    const failureMessage = String(error);
    await updateTaskStatus(requestId, "failed", { error: failureMessage });

    const replayTask = await getTask(requestId);
    if (replayTask && !controller.signal.aborted) {
      const replayPrompt = buildReplayPrompt(replayTask);
      try {
        const resumed = await invokeHarness({
          harness,
          message: replayPrompt,
          history: safeHistory,
          state,
          workspace,
        });

        const resumedContent = workspace.path
          ? (await applyWorkspaceActionsFromHarnessOutput(resumed.content, workspace.path)).output
          : resumed.content;

        await appendTaskOutput(requestId, resumedContent);
        await updateTaskStatus(requestId, "completed", {
          finalOutput: `${replayTask.partialOutput}${resumedContent}`,
          meta: resumed.meta,
        });

        res.write(`data: ${JSON.stringify({ type: "meta", meta: { ...resumed.meta, fallbackUsed: true } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "delta", text: resumedContent })}\n\n`);
        res.write("data: {\"type\":\"done\"}\n\n");
        res.end();
      } catch (replayError) {
        await updateTaskStatus(requestId, "failed", { error: `${failureMessage} | replay-failed: ${String(replayError)}` });
        res.write(`data: ${JSON.stringify({ type: "error", message: String(replayError) })}\n\n`);
        res.end();
      }
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: failureMessage })}\n\n`);
      res.end();
    }
  } finally {
    activeStreams.delete(requestId);
  }
});

void (async () => {
  const harnesses = await readHarnessRegistry();
  const runtimes = await ensureManagedHarnesses(harnesses);
  const state = await readSystemState();
  ensureRouterState(state);
  ensureHarnessAutomationStore(state);
  ensureHarnessChatStore(state);
  await writeSystemState(state);

  setInterval(async () => {
    try {
      const nowIso = new Date().toISOString();
      const runState = await readSystemState();
      const due = listDueSchedules(runState, nowIso);
      if (!due.length) {
        return;
      }

      for (const schedule of due) {
        const runAtIso = new Date().toISOString();
        markScheduleRun(runState, {
          workspaceId: schedule.workspaceId,
          harnessId: schedule.harnessId,
          scheduleId: schedule.id,
          runAtIso,
        });
      }
      await writeSystemState(runState);

      for (const schedule of due) {
        const lockKey = `${schedule.workspaceId}::${schedule.harnessId}::${schedule.id}`;
        if (activeScheduleRuns.has(lockKey)) {
          continue;
        }

        activeScheduleRuns.add(lockKey);
        try {
          const latestState = await readSystemState();
          const maxAttempts = Math.max(1, Math.min(5, latestState.nexusRouter?.retryPolicy.maxAttempts ?? 2));
          const backoffMs = Math.max(200, Math.min(10_000, latestState.nexusRouter?.retryPolicy.backoffMs ?? 1_000));

          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const result = await runScheduledHarnessTask({
              harnessId: schedule.harnessId,
              workspaceId: schedule.workspaceId,
              prompt: schedule.prompt,
              trigger: "scheduled",
              scheduleId: schedule.id,
              attempt,
              maxAttempts,
            });

            if (result.ok) {
              break;
            }

            if (attempt < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
            }
          }
        } finally {
          activeScheduleRuns.delete(lockKey);
        }
      }
    } catch (error) {
      console.error("[scheduler] tick failed", error);
    }
  }, 15_000);

  app.listen(port, () => {
    void ensureCoreRuntimeProvisioning();
    // eslint-disable-next-line no-console
    console.log(`NEXUS OS API running on http://localhost:${port}`);
    // eslint-disable-next-line no-console
    console.log(`Managed harness runtimes: ${runtimes.map((entry) => `${entry.harnessId}:${entry.mode}`).join(", ")}`);
  });
})();