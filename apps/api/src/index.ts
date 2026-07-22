import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import type {
  ChatMessage,
  GameCreatorSetupWizardDraft,
  StartupReadiness,
  SystemState,
} from "./types.js";
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
  transcribeWithWhisper,
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
import { generateLocalImageStreaming, getLocalImageStatus } from "./lib/localImageGenerator.js";
import {
  generateWithHunyuan3dStreaming,
  getHunyuan3dStatus,
  inferMeshExtension,
  installHunyuan3d,
  readMeshBytes,
  startHunyuan3dIfNeeded,
} from "./lib/hunyuan3dRuntime.js";
import {
  runBlenderFinishStreaming,
  type BlenderFinishProfile,
} from "./lib/blenderAssetPipeline.js";
import {
  getAnimatoBaseUrl,
  getAnimatoStatus,
  installAnimato,
  startAnimatoIfNeeded,
} from "./lib/animatoRuntime.js";
import {
  generateWithWan2GpStreaming,
  getMachineProfileHint,
  getWan2GpModelCatalog,
  getWan2GpStatus,
  inferMediaExtension,
  installWan2Gp,
  readMediaBytes,
  startWan2GpIfNeeded,
  synthesizeWithWanDeepy,
  synthesizeWithWanDeepyToFile,
} from "./lib/wan2gpRuntime.js";
import { listProviderCatalog, listRouterFallbackTemplates } from "./lib/providerCatalog.js";
import { getHarnessCapabilities, updateHarnessCapabilities } from "./lib/harnessCapabilities.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);
const activeStreams = new Map<string, AbortController>();
const activeScheduleRuns = new Set<string>();
const execFileAsync = promisify(execFile);

type RuntimeJobAction =
  | "install-ollama"
  | "start-ollama"
  | "pull-ollama-model"
  | "install-piper"
  | "install-default-piper-voice"
  | "install-acejam"
  | "start-acejam"
  | "install-wan2gp"
  | "start-wan2gp"
  | "install-hunyuan3d"
  | "start-hunyuan3d"
  | "install-animato"
  | "start-animato";

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
  autoRetryAttempt?: number;
};

const runtimeJobs = new Map<string, RuntimeJob>();
const runtimeJobsPath = path.join(getRootDir(), "data", "runtime-jobs.local.json");
const webCapabilitiesHistoryPath = path.join(getRootDir(), "data", "web-capabilities-history.local.json");
const fableTelemetryPath = path.join(getRootDir(), "data", "fable-telemetry.local.json");
const piperAssignmentsPath = path.join(getRootDir(), "data", "piper-voice-assignments.local.json");
const githubConnectorPath = path.join(getRootDir(), "data", "connectors.github.local.json");
let runtimeJobsLoaded = false;
let runtimeJobPersistQueue: Promise<void> = Promise.resolve();
const pendingGitHubDeviceFlows = new Map<string, GitHubDeviceFlowSession>();

type CrawlRunHistoryEntry = {
  id: string;
  harnessId: string;
  url: string;
  domain: string;
  workspaceId: string;
  outputFile?: string;
  status: "success" | "failed";
  durationMs: number;
  checkedAt: string;
  error?: string;
};

type OfficeRunHistoryEntry = {
  id: string;
  harnessId: string;
  workspaceId: string;
  file: string;
  args: string[];
  preset?: string;
  status: "success" | "failed";
  durationMs: number;
  checkedAt: string;
  error?: string;
};

type WebCapabilitiesHistory = {
  crawl4aiRuns: CrawlRunHistoryEntry[];
  officeCliRuns: OfficeRunHistoryEntry[];
};

type FableTelemetryEntry = {
  id: string;
  harnessId: string;
  profile: "off" | "balanced" | "strict";
  success: boolean;
  fallbackUsed: boolean;
  createdAt: string;
};

type GitHubConnectorState = {
  accessToken: string;
  login?: string;
  scopes?: string[];
  connectedAt?: string;
  lastVerifiedAt?: string;
};

type GitHubDeviceFlowSession = {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  interval: number;
};

type GitHubDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

type GitHubDeviceTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type WorkspaceWriteAction = {
  path: string;
  content: string;
};

const GAME_CREATOR_TARGETS = ["unity-3d", "unity-2d", "web-2d"] as const;
const GAME_CREATOR_GENRES = ["action-adventure", "platformer", "shooter", "rpg", "survival", "puzzle"] as const;
const GAME_CREATOR_PERSPECTIVES = ["first-person", "third-person", "top-down", "isometric", "side-scroller"] as const;
const GAME_CREATOR_SCOPE_TIERS = ["mini-vertical-slice", "small-prototype", "medium-prototype"] as const;
const GAME_CREATOR_ART_STYLES = ["stylized-low-poly", "pixel-art", "hand-painted", "realistic"] as const;
const GAME_CREATOR_NARRATIVE_DEPTHS = ["none", "light", "moderate", "lore-heavy"] as const;
const GAME_CREATOR_CONTROL_TYPES = ["keyboard-mouse", "controller", "both"] as const;
const GAME_CREATOR_CORE_LOOPS = ["combat", "exploration", "crafting", "puzzle", "mixed"] as const;
const GAME_CREATOR_DIFFICULTY = ["casual", "normal", "hard"] as const;

const PERSPECTIVES_BY_TARGET: Record<(typeof GAME_CREATOR_TARGETS)[number], Array<(typeof GAME_CREATOR_PERSPECTIVES)[number]>> = {
  "unity-3d": ["third-person", "first-person", "top-down", "isometric"],
  "unity-2d": ["side-scroller", "top-down", "isometric"],
  "web-2d": ["side-scroller", "top-down", "isometric"],
};

type GameCreatorSpecPackage = {
  generatedAt: string;
  sourceDraftVersion: number;
  setupWizard: GameCreatorSetupWizardDraft;
  constraints: {
    perspectivesAllowedForTarget: string[];
    uses3dPipeline: boolean;
    requiresExtendedLoreSections: boolean;
    requiresControllerChecklist: boolean;
  };
  scopeWarnings: string[];
};

function pickEnumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  if (typeof value !== "string") {
    return fallback;
  }
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function getDefaultGameCreatorDraft(): GameCreatorSetupWizardDraft {
  return {
    version: 1,
    target: "unity-3d",
    genre: "action-adventure",
    perspective: "third-person",
    scopeTier: "mini-vertical-slice",
    artStyle: "stylized-low-poly",
    narrativeDepth: "light",
    controls: "keyboard-mouse",
    coreLoopPriority: "combat",
    difficultyTarget: "casual",
    enemyFamilies: 2,
    biomes: 1,
    bosses: 0,
    preferredDocHarnesses: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeGameCreatorDraft(input: unknown, existing?: Partial<GameCreatorSetupWizardDraft>): GameCreatorSetupWizardDraft {
  const base = {
    ...getDefaultGameCreatorDraft(),
    ...(existing ?? {}),
  };
  const candidate = (typeof input === "object" && input) ? input as Partial<GameCreatorSetupWizardDraft> : {};

  const target = pickEnumValue(candidate.target, GAME_CREATOR_TARGETS, pickEnumValue(base.target, GAME_CREATOR_TARGETS, "unity-3d"));
  const allowedPerspectives = PERSPECTIVES_BY_TARGET[target];
  const requestedPerspective = pickEnumValue(candidate.perspective, GAME_CREATOR_PERSPECTIVES, pickEnumValue(base.perspective, GAME_CREATOR_PERSPECTIVES, "third-person"));
  const perspective = allowedPerspectives.includes(requestedPerspective) ? requestedPerspective : allowedPerspectives[0];

  const normalizeCount = (value: unknown, fallback: number, min: number, max: number): number => {
    const raw = Number(value);
    if (!Number.isFinite(raw)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(raw)));
  };

  const preferredDocHarnesses = Array.isArray(candidate.preferredDocHarnesses)
    ? candidate.preferredDocHarnesses.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .slice(0, 5)
    : Array.isArray(base.preferredDocHarnesses)
      ? base.preferredDocHarnesses
      : [];

  return {
    version: Number.isFinite(Number(candidate.version)) ? Math.max(1, Math.floor(Number(candidate.version))) : (base.version ?? 1),
    target,
    genre: pickEnumValue(candidate.genre, GAME_CREATOR_GENRES, pickEnumValue(base.genre, GAME_CREATOR_GENRES, "action-adventure")),
    perspective,
    scopeTier: pickEnumValue(candidate.scopeTier, GAME_CREATOR_SCOPE_TIERS, pickEnumValue(base.scopeTier, GAME_CREATOR_SCOPE_TIERS, "mini-vertical-slice")),
    artStyle: pickEnumValue(candidate.artStyle, GAME_CREATOR_ART_STYLES, pickEnumValue(base.artStyle, GAME_CREATOR_ART_STYLES, "stylized-low-poly")),
    narrativeDepth: pickEnumValue(candidate.narrativeDepth, GAME_CREATOR_NARRATIVE_DEPTHS, pickEnumValue(base.narrativeDepth, GAME_CREATOR_NARRATIVE_DEPTHS, "light")),
    controls: pickEnumValue(candidate.controls, GAME_CREATOR_CONTROL_TYPES, pickEnumValue(base.controls, GAME_CREATOR_CONTROL_TYPES, "keyboard-mouse")),
    coreLoopPriority: pickEnumValue(candidate.coreLoopPriority, GAME_CREATOR_CORE_LOOPS, pickEnumValue(base.coreLoopPriority, GAME_CREATOR_CORE_LOOPS, "combat")),
    difficultyTarget: pickEnumValue(candidate.difficultyTarget, GAME_CREATOR_DIFFICULTY, pickEnumValue(base.difficultyTarget, GAME_CREATOR_DIFFICULTY, "casual")),
    enemyFamilies: normalizeCount(candidate.enemyFamilies, Number(base.enemyFamilies ?? 2), 0, 20),
    biomes: normalizeCount(candidate.biomes, Number(base.biomes ?? 1), 0, 12),
    bosses: normalizeCount(candidate.bosses, Number(base.bosses ?? 0), 0, 8),
    preferredDocHarnesses,
    notes: typeof candidate.notes === "string" ? candidate.notes.trim().slice(0, 2000) : (typeof base.notes === "string" ? base.notes : ""),
    updatedAt: new Date().toISOString(),
  };
}

function buildGameCreatorSpecPackage(draft: GameCreatorSetupWizardDraft): GameCreatorSpecPackage {
  const warnings: string[] = [];
  if (draft.scopeTier === "mini-vertical-slice" && (draft.enemyFamilies > 3 || draft.biomes > 2 || draft.bosses > 1)) {
    warnings.push("Scope baseline may be too large for a mini vertical slice.");
  }
  if (draft.scopeTier === "small-prototype" && (draft.enemyFamilies > 6 || draft.biomes > 3 || draft.bosses > 2)) {
    warnings.push("Scope baseline may be too large for a small prototype.");
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceDraftVersion: draft.version,
    setupWizard: draft,
    constraints: {
      perspectivesAllowedForTarget: PERSPECTIVES_BY_TARGET[draft.target],
      uses3dPipeline: draft.target === "unity-3d",
      requiresExtendedLoreSections: draft.narrativeDepth === "lore-heavy",
      requiresControllerChecklist: draft.controls === "controller" || draft.controls === "both",
    },
    scopeWarnings: warnings,
  };
}

function readGameCreatorDraft(state: SystemState): GameCreatorSetupWizardDraft {
  return normalizeGameCreatorDraft(state.gameCreator?.setupWizardDraft, state.gameCreator?.setupWizardDraft);
}

function writeGameCreatorDraft(state: SystemState, draft: GameCreatorSetupWizardDraft): void {
  state.gameCreator = {
    ...(state.gameCreator ?? {}),
    setupWizardDraft: draft,
  };
}

async function resolveWorkspacePathFromState(state: SystemState, workspaceId?: string): Promise<string> {
  const resolvedId = String(workspaceId ?? state.activeWorkspaceId).trim() || state.activeWorkspaceId;
  const workspace = await getWorkspaceById(resolvedId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${resolvedId}`);
  }
  return workspace.path;
}

function safeWorkspaceJoin(workspacePath: string, relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
  const absolute = path.resolve(workspacePath, normalized);
  const rel = path.relative(workspacePath, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes active workspace");
  }
  return absolute;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractDomain(urlValue: string): string {
  return new URL(urlValue).hostname.toLowerCase();
}

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

function shouldAutoRetryRuntimeJob(job: RuntimeJob): boolean {
  return ["install-ollama", "install-piper", "install-default-piper-voice", "install-acejam", "install-wan2gp", "install-hunyuan3d", "install-animato"].includes(job.action);
}

function runtimeJobRetryDepth(job: RuntimeJob): number {
  let depth = 0;
  let cursor: RuntimeJob | undefined = job;
  while (cursor?.retryOfId) {
    depth += 1;
    cursor = runtimeJobs.get(cursor.retryOfId);
  }
  return depth;
}

function queueRuntimeJobAutoRetry(job: RuntimeJob): void {
  const depth = runtimeJobRetryDepth(job);
  const maxRetries = 2;
  if (depth >= maxRetries) {
    appendRuntimeJobLog(job, "Auto-retry budget exhausted.");
    return;
  }

  const delayMs = 1500 * (2 ** depth);
  appendRuntimeJobLog(job, `Scheduling automatic retry in ${delayMs}ms.`);
  setTimeout(() => {
    const retry = createRuntimeJob(job.action, job.model, job.id);
    retry.autoRetryAttempt = depth + 1;
    appendRuntimeJobLog(retry, `Automatic retry #${depth + 1} for failed job ${job.id}.`);
    startRuntimeJob(retry);
  }, delayMs);
}

async function readWebCapabilitiesHistory(): Promise<WebCapabilitiesHistory> {
  try {
    const raw = await fs.readFile(webCapabilitiesHistoryPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WebCapabilitiesHistory>;
    return {
      crawl4aiRuns: Array.isArray(parsed.crawl4aiRuns) ? parsed.crawl4aiRuns : [],
      officeCliRuns: Array.isArray(parsed.officeCliRuns) ? parsed.officeCliRuns : [],
    };
  } catch {
    return { crawl4aiRuns: [], officeCliRuns: [] };
  }
}

async function writeWebCapabilitiesHistory(history: WebCapabilitiesHistory): Promise<void> {
  await fs.mkdir(path.dirname(webCapabilitiesHistoryPath), { recursive: true });
  await fs.writeFile(webCapabilitiesHistoryPath, JSON.stringify(history, null, 2), "utf-8");
}

async function appendCrawlRunHistory(entry: CrawlRunHistoryEntry): Promise<void> {
  const history = await readWebCapabilitiesHistory();
  history.crawl4aiRuns.unshift(entry);
  history.crawl4aiRuns = history.crawl4aiRuns.slice(0, 120);
  await writeWebCapabilitiesHistory(history);
}

async function appendOfficeRunHistory(entry: OfficeRunHistoryEntry): Promise<void> {
  const history = await readWebCapabilitiesHistory();
  history.officeCliRuns.unshift(entry);
  history.officeCliRuns = history.officeCliRuns.slice(0, 120);
  await writeWebCapabilitiesHistory(history);
}

async function readFableTelemetry(): Promise<FableTelemetryEntry[]> {
  try {
    const raw = await fs.readFile(fableTelemetryPath, "utf-8");
    const parsed = JSON.parse(raw) as FableTelemetryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFableTelemetry(entries: FableTelemetryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(fableTelemetryPath), { recursive: true });
  await fs.writeFile(fableTelemetryPath, JSON.stringify(entries.slice(0, 400), null, 2), "utf-8");
}

async function appendFableTelemetry(entry: FableTelemetryEntry): Promise<void> {
  const current = await readFableTelemetry();
  current.unshift(entry);
  await writeFableTelemetry(current);
}

function summarizeFableTelemetry(entries: FableTelemetryEntry[]): Array<{ harnessId: string; profile: string; total: number; success: number; fallbackUsed: number }> {
  const map = new Map<string, { harnessId: string; profile: string; total: number; success: number; fallbackUsed: number }>();
  for (const entry of entries) {
    const key = `${entry.harnessId}::${entry.profile}`;
    const current = map.get(key) ?? { harnessId: entry.harnessId, profile: entry.profile, total: 0, success: 0, fallbackUsed: 0 };
    current.total += 1;
    if (entry.success) current.success += 1;
    if (entry.fallbackUsed) current.fallbackUsed += 1;
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function isStartupStrictModeEnabled(state: SystemState): boolean {
  return Boolean(state.startupStrictMode);
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
        if (shouldAutoRetryRuntimeJob(job)) {
          queueRuntimeJobAutoRetry(job);
        }
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

async function ensureWorkspaceAgentsLogsDir(workspaceId?: string): Promise<{ workspaceId: string; logsPath: string }> {
  const state = await readSystemState();
  const workspace = await resolveWorkspaceContext(state, workspaceId);
  if (!workspace.path) {
    throw new Error("Active workspace path is unavailable.");
  }
  const logsPath = path.join(workspace.path, "Agents", "Logs", "hunyuan3d");
  await fs.mkdir(logsPath, { recursive: true });
  return { workspaceId: workspace.id, logsPath };
}

async function appendHunyuanAgentLog(logFilePath: string, entry: Record<string, unknown>): Promise<void> {
  await fs.appendFile(logFilePath, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function ensureWorkspaceAgentsScaffold(workspacePath: string): Promise<void> {
  await fs.mkdir(path.join(workspacePath, "Agents", "Logs"), { recursive: true });
}

async function saveBufferToWorkspaceAssets(input: {
  workspaceId?: string;
  category: "images" | "videos" | "voice" | "music" | "models";
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
  const [status, wan2gpStatus, hunyuan3dStatus] = await Promise.all([
    getRuntimeStatus(),
    getWan2GpStatus(),
    getHunyuan3dStatus(),
  ]);
  if (!status.ollamaInstalled) {
    if (!findActiveRuntimeJobByAction("install-ollama")) {
      const ollamaJob = createRuntimeJob("install-ollama");
      appendRuntimeJobLog(ollamaJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(ollamaJob);
    }
  } else if (!status.ollamaRunning) {
    if (!findActiveRuntimeJobByAction("start-ollama")) {
      const startJob = createRuntimeJob("start-ollama");
      appendRuntimeJobLog(startJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(startJob);
    }
  }

  if (!status.piperInstalled) {
    if (!findActiveRuntimeJobByAction("install-piper")) {
      const piperJob = createRuntimeJob("install-piper");
      appendRuntimeJobLog(piperJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(piperJob);
    }
  } else if (!status.defaultVoiceInstalled || status.piperVoices.length < 3) {
    if (!findActiveRuntimeJobByAction("install-default-piper-voice")) {
      const voiceJob = createRuntimeJob("install-default-piper-voice");
      appendRuntimeJobLog(voiceJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(voiceJob);
    }
  }

  if (!wan2gpStatus.installed || !wan2gpStatus.envReady) {
    if (!findActiveRuntimeJobByAction("install-wan2gp")) {
      const wanInstallJob = createRuntimeJob("install-wan2gp");
      appendRuntimeJobLog(wanInstallJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(wanInstallJob);
    }
  } else if (!wan2gpStatus.apiReady) {
    if (!findActiveRuntimeJobByAction("start-wan2gp")) {
      const wanStartJob = createRuntimeJob("start-wan2gp");
      appendRuntimeJobLog(wanStartJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(wanStartJob);
    }
  }

  if (!hunyuan3dStatus.installed || !hunyuan3dStatus.envReady) {
    if (!findActiveRuntimeJobByAction("install-hunyuan3d")) {
      const hy3dInstallJob = createRuntimeJob("install-hunyuan3d");
      appendRuntimeJobLog(hy3dInstallJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(hy3dInstallJob);
    }
  } else if (!hunyuan3dStatus.apiReady) {
    if (!findActiveRuntimeJobByAction("start-hunyuan3d")) {
      const hy3dStartJob = createRuntimeJob("start-hunyuan3d");
      appendRuntimeJobLog(hy3dStartJob, "Queued by NexusOS core runtime provisioning.");
      startRuntimeJob(hy3dStartJob);
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

  if (job.action === "install-wan2gp") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Installing Wan2GP runtime...");
    await installWan2Gp();
    appendRuntimeJobLog(job, "Wan2GP install completed.");
    return;
  }

  if (job.action === "start-wan2gp") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Checking Wan2GP readiness...");
    await startWan2GpIfNeeded();
    appendRuntimeJobLog(job, "Wan2GP API is ready.");
    return;
  }

  if (job.action === "install-hunyuan3d") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Installing Hunyuan3D-2GP runtime...");
    await installHunyuan3d();
    appendRuntimeJobLog(job, "Hunyuan3D-2GP install completed.");
    return;
  }

  if (job.action === "start-hunyuan3d") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Checking Hunyuan3D-2GP readiness...");
    await startHunyuan3dIfNeeded();
    appendRuntimeJobLog(job, "Hunyuan3D-2GP runtime is ready.");
    return;
  }

  if (job.action === "install-animato") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Installing Animato runtime...");
    await installAnimato();
    appendRuntimeJobLog(job, "Animato install completed.");
    return;
  }

  if (job.action === "start-animato") {
    ensureRuntimeJobNotCanceled(job);
    appendRuntimeJobLog(job, "Starting Animato API...");
    await startAnimatoIfNeeded();
    appendRuntimeJobLog(job, "Animato API is ready.");
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

function buildStartupReadiness(input: {
  onboardingComplete: boolean;
  liveHarnesses: number;
  totalHarnesses: number;
  runtimeStatus?: Awaited<ReturnType<typeof getRuntimeStatus>>;
  managedStatuses?: ReturnType<typeof getManagedHarnessRuntimeStatus>;
}): StartupReadiness {
  const blockers: string[] = [];
  const {
    onboardingComplete,
    liveHarnesses,
    totalHarnesses,
    runtimeStatus,
    managedStatuses,
  } = input;

  if (!onboardingComplete) {
    blockers.push("Nexus Router is not configured.");
  }

  if (liveHarnesses === 0) {
    blockers.push("No live harnesses detected. Start at least one harness service.");
  }

  if (runtimeStatus) {
    if (!runtimeStatus.ollamaInstalled) {
      blockers.push("Ollama is not installed yet.");
    } else if (!runtimeStatus.ollamaRunning) {
      blockers.push("Ollama is installed but not running.");
    }

    if (!runtimeStatus.piperInstalled) {
      blockers.push("Piper is not installed yet.");
    } else if (!runtimeStatus.defaultVoiceInstalled) {
      blockers.push("Piper is installed but default voices are not ready.");
    }
  }

  if (managedStatuses?.some((entry) => entry.mode === "failed")) {
    blockers.push("One or more managed harness runtimes failed to initialize.");
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

function buildSelfRepairReport(): {
  attempted: number;
  completed: number;
  failed: number;
  recent: Array<{ id: string; action: string; status: string; updatedAt: string; error?: string }>;
} {
  const recent = toRuntimeJobPayload(20)
    .filter((job) => job.logs.some((log) => log.includes("Queued by NexusOS core runtime provisioning.")))
    .slice(0, 10)
    .map((job) => ({
      id: job.id,
      action: job.action,
      status: job.status,
      updatedAt: job.updatedAt,
      error: job.error,
    }));

  return {
    attempted: recent.length,
    completed: recent.filter((job) => job.status === "completed").length,
    failed: recent.filter((job) => job.status === "failed").length,
    recent,
  };
}

async function runGit(
  args: string[],
  options?: { githubToken?: string; remoteUrl?: string },
): Promise<{ stdout: string; stderr: string }> {
  const finalArgs = [...args];
  const remoteUrl = options?.remoteUrl?.trim() ?? "";
  const githubToken = options?.githubToken?.trim() ?? "";
  const isHttpsGitHubRemote = /^https?:\/\//i.test(remoteUrl) && /github\.com/i.test(remoteUrl);
  if (githubToken && isHttpsGitHubRemote) {
    const auth = Buffer.from(`x-access-token:${githubToken}`, "utf-8").toString("base64");
    finalArgs.unshift("-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`);
  }

  try {
    const result = await execFileAsync("git", finalArgs, {
      cwd: getRootDir(),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

async function readGitHubConnectorState(): Promise<GitHubConnectorState | null> {
  try {
    const raw = await fs.readFile(githubConnectorPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GitHubConnectorState> & { token?: string; accessToken?: string };
    const accessToken = typeof parsed.accessToken === "string"
      ? parsed.accessToken.trim()
      : (typeof parsed.token === "string" ? parsed.token.trim() : "");
    if (!parsed || !accessToken) {
      return null;
    }
    return {
      ...parsed,
      accessToken,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
    };
  } catch {
    return null;
  }
}

async function writeGitHubConnectorState(next: GitHubConnectorState): Promise<void> {
  await fs.mkdir(path.dirname(githubConnectorPath), { recursive: true });
  await fs.writeFile(githubConnectorPath, JSON.stringify(next, null, 2), "utf-8");
}

async function clearGitHubConnectorState(): Promise<void> {
  await fs.rm(githubConnectorPath, { force: true });
}

function maskToken(token: string): string {
  if (token.length <= 8) {
    return "****";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function normalizeGitHubRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  if (/^git@github\.com:/i.test(trimmed)) {
    return `https://github.com/${trimmed.replace(/^git@github\.com:/i, "")}`;
  }
  if (/^ssh:\/\/git@github\.com\//i.test(trimmed)) {
    return `https://github.com/${trimmed.replace(/^ssh:\/\/git@github\.com\//i, "")}`;
  }
  return trimmed;
}

type StableAudioMode = "small-music" | "small-sfx" | "medium";

type StableAudioStatusPayload = {
  installed: boolean;
  running: boolean;
  ready: boolean;
  readyUrl: string | null;
  state: string;
  appId: string;
  ref: string | null;
  supportsMedium: boolean;
  modes: Array<{ id: StableAudioMode; label: string; description: string; recommendedPrompt: string; available: boolean }>;
};

const STABLE_AUDIO_APP_ID = "stable-audio-3-small.pinokio.git";
const STABLE_AUDIO_REPO_URL = "https://github.com/cocktailpeanut/stable-audio-3-small.pinokio.git";
const STABLE_AUDIO_UPSTREAM_REPO_URL = "https://github.com/Stability-AI/stable-audio-3";
const STABLE_AUDIO_MODEL_MIRRORS: Record<StableAudioMode, string> = {
  "small-music": "cocktailpeanut/stable-audio-3-small-music",
  "small-sfx": "cocktailpeanut/stable-audio-3-small-sfx",
  medium: "cocktailpeanut/stable-audio-3-medium",
};

type PinokioConfig = {
  home?: string;
};

async function readPinokioConfig(): Promise<PinokioConfig> {
  const pinokioConfigPath = path.join(os.homedir(), ".pinokio", "config.json");
  try {
    const raw = await fs.readFile(pinokioConfigPath, "utf-8");
    return JSON.parse(raw) as PinokioConfig;
  } catch {
    return {};
  }
}

async function resolvePinokioHome(): Promise<string | null> {
  const config = await readPinokioConfig();
  if (config.home?.trim()) {
    return config.home.trim();
  }
  return null;
}

async function resolveStableAudioAppPath(): Promise<string | null> {
  const pinokioHome = await resolvePinokioHome();
  if (!pinokioHome) {
    return null;
  }
  return path.join(pinokioHome, "api", STABLE_AUDIO_APP_ID);
}

async function resolveStableAudioSourcePath(): Promise<string | null> {
  const appPath = await resolveStableAudioAppPath();
  if (!appPath) {
    return null;
  }
  return path.join(appPath, "app");
}

async function stableAudioScriptsPresent(): Promise<boolean> {
  const appPath = await resolveStableAudioAppPath();
  if (!appPath) {
    return false;
  }

  try {
    await fs.access(path.join(appPath, "install.js"));
    await fs.access(path.join(appPath, "start.js"));
    return true;
  } catch {
    return false;
  }
}

async function stableAudioSourcePresent(): Promise<boolean> {
  const sourcePath = await resolveStableAudioSourcePath();
  if (!sourcePath) {
    return false;
  }

  try {
    await fs.access(path.join(sourcePath, "pyproject.toml"));
    await fs.access(path.join(sourcePath, "run_gradio.py"));
    return true;
  } catch {
    return false;
  }
}

async function stableAudioEnvReady(): Promise<boolean> {
  const sourcePath = await resolveStableAudioSourcePath();
  if (!sourcePath) {
    return false;
  }

  const candidates = process.platform === "win32"
    ? [path.join(sourcePath, ".venv", "Scripts", "python.exe")]
    : [path.join(sourcePath, ".venv", "bin", "python")];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

async function execGit(args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd: getRootDir(),
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function ensureStableAudioAppFiles(): Promise<void> {
  if (await stableAudioScriptsPresent()) {
    return;
  }

  const appPath = await resolveStableAudioAppPath();
  if (!appPath) {
    throw new Error("Pinokio home is not configured. Open Pinokio once and try again.");
  }

  await fs.mkdir(appPath, { recursive: true });

  const gitDir = path.join(appPath, ".git");
  let hasGit = true;
  try {
    await fs.access(gitDir);
  } catch {
    hasGit = false;
  }

  if (!hasGit) {
    await execGit(["-C", appPath, "init"]);
    try {
      await execGit(["-C", appPath, "remote", "add", "origin", STABLE_AUDIO_REPO_URL]);
    } catch {
      // Ignore if remote already exists.
    }
  }

  await execGit(["-C", appPath, "fetch", "--depth", "1", "origin", "main"]);
  await execGit(["-C", appPath, "reset", "--hard", "FETCH_HEAD"]);
  await execGit(["-C", appPath, "clean", "-fd"]);

  if (!(await stableAudioScriptsPresent())) {
    throw new Error("Stable Audio app files are still missing after bootstrap.");
  }
}

async function ensureStableAudioSourceRepo(): Promise<string> {
  const sourcePath = await resolveStableAudioSourcePath();
  if (!sourcePath) {
    throw new Error("Pinokio home is not configured. Open Pinokio once and try again.");
  }

  if (await stableAudioSourcePresent()) {
    return sourcePath;
  }

  await fs.mkdir(sourcePath, { recursive: true });
  await execGit(["-C", sourcePath, "init"]);
  try {
    await execGit(["-C", sourcePath, "remote", "add", "origin", STABLE_AUDIO_UPSTREAM_REPO_URL]);
  } catch {
    // Ignore if remote already exists.
  }

  await execGit(["-C", sourcePath, "fetch", "--depth", "1", "origin", "main"]);
  await execGit(["-C", sourcePath, "reset", "--hard", "FETCH_HEAD"]);
  await execGit(["-C", sourcePath, "clean", "-fd"]);

  if (!(await stableAudioSourcePresent())) {
    throw new Error("Stable Audio source repository is missing required files.");
  }

  return sourcePath;
}

async function runUv(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync("uv", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env,
  });
}

async function ensureStableAudioNativeReady(): Promise<{ sourcePath: string }> {
  await ensureStableAudioAppFiles();
  const sourcePath = await ensureStableAudioSourceRepo();
  if (!(await stableAudioEnvReady())) {
    await runUv(["sync", "--extra", "ui"], sourcePath);
  }
  return { sourcePath };
}

async function generateStableAudioAudio(input: {
  mode: StableAudioMode;
  prompt: string;
  duration: number;
}): Promise<{ outputPath: string }> {
  const ready = await ensureStableAudioNativeReady();
  const outputDir = path.join(ready.sourcePath, "outputs");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `nexus-${input.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`,
  );

  const scriptPath = path.join(ready.sourcePath, ".nexus-generate-stable-audio.py");
  const pythonScript = [
    "import os",
    "import stable_audio_3.model as model_module",
    "import stable_audio_3.model_configs as model_configs",
    "from stable_audio_3.model_configs import ModelConfig",
    "from stable_audio_3 import StableAudioModel",
    "import torchaudio",
    "",
    "mode = os.environ['NEXUS_STABLE_AUDIO_MODE']",
    "prompt = os.environ['NEXUS_STABLE_AUDIO_PROMPT']",
    "duration = float(os.environ['NEXUS_STABLE_AUDIO_DURATION'])",
    "output_path = os.environ['NEXUS_STABLE_AUDIO_OUTPUT']",
    "",
    "mirrors = {",
    "  'small-music': os.environ['NEXUS_SA3_MIRROR_SMALL_MUSIC'],",
    "  'small-sfx': os.environ['NEXUS_SA3_MIRROR_SMALL_SFX'],",
    "  'medium': os.environ['NEXUS_SA3_MIRROR_MEDIUM'],",
    "}",
    "",
    "for name, repo_id in mirrors.items():",
    "  config = ModelConfig(repo_id, 'model_config.json', 'model.safetensors')",
    "  model_configs.models[name] = config",
    "  model_configs.all_models[name] = config",
    "",
    "model_module.all_models = model_configs.all_models",
    "model = StableAudioModel.from_pretrained(mode)",
    "audio = model.generate(prompt=prompt, duration=duration)",
    "torchaudio.save(output_path, audio[0].cpu(), model.model.sample_rate)",
  ].join("\n");
  await fs.writeFile(scriptPath, pythonScript, "utf-8");

  await runUv(["run", "python", scriptPath], ready.sourcePath, {
    ...process.env,
    NEXUS_STABLE_AUDIO_MODE: input.mode,
    NEXUS_STABLE_AUDIO_PROMPT: input.prompt,
    NEXUS_STABLE_AUDIO_DURATION: String(input.duration),
    NEXUS_STABLE_AUDIO_OUTPUT: outputPath,
    NEXUS_SA3_MIRROR_SMALL_MUSIC: STABLE_AUDIO_MODEL_MIRRORS["small-music"],
    NEXUS_SA3_MIRROR_SMALL_SFX: STABLE_AUDIO_MODEL_MIRRORS["small-sfx"],
    NEXUS_SA3_MIRROR_MEDIUM: STABLE_AUDIO_MODEL_MIRRORS.medium,
  });

  return { outputPath };
}

async function resolvePtermPath(): Promise<string> {
  const candidates: string[] = [];
  const pinokioHome = await resolvePinokioHome();
  if (pinokioHome) {
    candidates.push(path.join(pinokioHome, "bin", "npm", "pterm.cmd"));
    candidates.push(path.join(pinokioHome, "bin", "npm", "pterm"));
    candidates.push(path.join(pinokioHome, "bin", "pterm"));
  }

  candidates.push("pterm");

  for (const candidate of candidates) {
    try {
      if (candidate === "pterm") {
        await execFileAsync("where", ["pterm"], { windowsHide: true, maxBuffer: 256 * 1024 });
        return candidate;
      }
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Pinokio pterm executable not found.");
}

async function runPterm(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const ptermPath = await resolvePtermPath();
  const useWindowsCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(ptermPath);

  try {
    const result = useWindowsCmdShim
      ? await execFileAsync(
        "cmd.exe",
        ["/d", "/c", "call", ptermPath, ...args],
        {
          cwd: getRootDir(),
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        },
      )
      : await execFileAsync(ptermPath, args, {
      cwd: getRootDir(),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function stableAudioModeConfig(mode: StableAudioMode): { label: string; prompt: string; title: string } {
  if (mode === "small-sfx") {
    return {
      label: "Small SFX",
      prompt: "cinematic whoosh impact",
      title: "Stable Audio 3 Small SFX",
    };
  }
  if (mode === "medium") {
    return {
      label: "Medium",
      prompt: "cinematic electronic track, melodic, 124 BPM",
      title: "Stable Audio 3 Medium",
    };
  }
  return {
    label: "Small Music",
    prompt: "lo-fi hip hop beat, 90 BPM",
    title: "Stable Audio 3 Small Music",
  };
}

function stableAudioDefaultTarget(mode: StableAudioMode): string {
  const params = new URLSearchParams({ model: mode });
  return `start.js?${params.toString()}`;
}

function parseStableAudioStatus(raw: string, scriptsPresent: boolean): StableAudioStatusPayload {
  const parsed = JSON.parse(raw) as {
    app_id?: string;
    running?: boolean;
    ready?: boolean;
    ready_url?: string | null;
    state?: string;
    ref?: string | null;
  };
  const supportsMedium = process.platform === "win32" || process.platform === "linux";
  return {
    installed: scriptsPresent,
    running: Boolean(parsed.running),
    ready: Boolean(parsed.ready),
    readyUrl: parsed.ready_url ?? null,
    state: parsed.state ?? "offline",
    appId: parsed.app_id ?? STABLE_AUDIO_APP_ID,
    ref: parsed.ref ?? null,
    supportsMedium,
    modes: [
      {
        id: "small-music",
        label: "Small Music",
        description: "CPU-friendly music generation up to 120 seconds.",
        recommendedPrompt: stableAudioModeConfig("small-music").prompt,
        available: true,
      },
      {
        id: "small-sfx",
        label: "Small SFX",
        description: "CPU-friendly sound-effect generation up to 120 seconds.",
        recommendedPrompt: stableAudioModeConfig("small-sfx").prompt,
        available: true,
      },
      {
        id: "medium",
        label: "Medium",
        description: "Higher-quality music generation, GPU-oriented, up to 380 seconds.",
        recommendedPrompt: stableAudioModeConfig("medium").prompt,
        available: supportsMedium,
      },
    ],
  };
}

async function getStableAudioStatus(): Promise<StableAudioStatusPayload> {
  const scriptsPresent = await stableAudioScriptsPresent();
  const sourcePresent = await stableAudioSourcePresent();
  const envPresent = await stableAudioEnvReady();
  try {
    const result = await runPterm(["status", STABLE_AUDIO_APP_ID]);
    const parsed = parseStableAudioStatus(result.stdout, scriptsPresent && sourcePresent && envPresent);
    parsed.running = false;
    parsed.ready = false;
    parsed.readyUrl = null;
    return parsed;
  } catch {
    return {
      installed: scriptsPresent && sourcePresent && envPresent,
      running: false,
      ready: false,
      readyUrl: null,
      state: "offline",
      appId: STABLE_AUDIO_APP_ID,
      ref: null,
      supportsMedium: process.platform === "win32" || process.platform === "linux",
      modes: [
        {
          id: "small-music",
          label: "Small Music",
          description: "CPU-friendly music generation up to 120 seconds.",
          recommendedPrompt: stableAudioModeConfig("small-music").prompt,
          available: true,
        },
        {
          id: "small-sfx",
          label: "Small SFX",
          description: "CPU-friendly sound-effect generation up to 120 seconds.",
          recommendedPrompt: stableAudioModeConfig("small-sfx").prompt,
          available: true,
        },
        {
          id: "medium",
          label: "Medium",
          description: "Higher-quality music generation, GPU-oriented, up to 380 seconds.",
          recommendedPrompt: stableAudioModeConfig("medium").prompt,
          available: process.platform === "win32" || process.platform === "linux",
        },
      ],
    };
  }
}

async function launchStableAudio(mode: StableAudioMode): Promise<{ status: StableAudioStatusPayload; notice?: string }> {
  await ensureStableAudioNativeReady();
  if (mode === "medium" && !(process.platform === "win32" || process.platform === "linux")) {
    return {
      status: await getStableAudioStatus(),
      notice: "Stable Audio Medium requires a supported GPU/runtime path. Check Cookbook for compatible music model guidance.",
    };
  }
  return {
    status: await getStableAudioStatus(),
    notice: "Stable Audio is now controlled from the Nexus-native generator UI.",
  };
}

async function verifyGitHubToken(token: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "NexusOS",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub auth failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { login?: string };
  if (!payload.login) {
    throw new Error("GitHub auth response did not include login.");
  }

  const scopesRaw = response.headers.get("x-oauth-scopes") ?? "";
  const scopes = scopesRaw
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  return {
    login: payload.login,
    scopes,
  };
}

async function startGitHubDeviceFlow(clientId: string, scopes: string[]): Promise<GitHubDeviceCodeResponse> {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NexusOS",
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopes.join(" "),
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub device flow start failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as GitHubDeviceCodeResponse;
  if (!payload.device_code || !payload.user_code || !payload.verification_uri || !payload.expires_in) {
    throw new Error("GitHub device flow response was incomplete.");
  }

  return payload;
}

async function pollGitHubDeviceFlow(clientId: string, deviceCode: string): Promise<GitHubDeviceTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NexusOS",
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub device flow poll failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<GitHubDeviceTokenResponse>;
}

async function saveVerifiedGitHubConnector(accessToken: string): Promise<{ connector: ReturnType<typeof toGitHubConnectorStatus> }> {
  const verified = await verifyGitHubToken(accessToken);
  const now = new Date().toISOString();
  const connector: GitHubConnectorState = {
    accessToken,
    login: verified.login,
    scopes: verified.scopes,
    connectedAt: now,
    lastVerifiedAt: now,
  };
  await writeGitHubConnectorState(connector);
  return { connector: toGitHubConnectorStatus(connector) };
}

function toGitHubConnectorStatus(state: GitHubConnectorState | null): {
  connected: boolean;
  login: string | null;
  maskedToken: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
} {
  if (!state) {
    return {
      connected: false,
      login: null,
      maskedToken: null,
      scopes: [],
      connectedAt: null,
      lastVerifiedAt: null,
    };
  }

  return {
    connected: true,
    login: state.login ?? null,
    maskedToken: maskToken(state.accessToken),
    scopes: state.scopes ?? [],
    connectedAt: state.connectedAt ?? null,
    lastVerifiedAt: state.lastVerifiedAt ?? null,
  };
}

async function getGitStatusSnapshot(): Promise<{
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  counts: { staged: number; unstaged: number; untracked: number; total: number };
  entries: Array<{ x: string; y: string; path: string }>;
  remotes: string[];
  rootDir: string;
}> {
  const [{ stdout: statusRaw }, { stdout: remotesRaw }] = await Promise.all([
    runGit(["status", "--porcelain=v1", "--branch"]),
    runGit(["remote"]),
  ]);

  const lines = statusRaw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const branchLine = lines.find((line) => line.startsWith("## ")) ?? "## detached";
  const branchMeta = branchLine.slice(3).trim();
  const branch = branchMeta.split("...")[0]?.trim() || "detached";
  const aheadMatch = branchMeta.match(/ahead\s+(\d+)/);
  const behindMatch = branchMeta.match(/behind\s+(\d+)/);

  const entries = lines
    .filter((line) => !line.startsWith("## "))
    .map((line) => ({
      x: line[0] ?? " ",
      y: line[1] ?? " ",
      path: line.slice(3).trim().replace(/^"|"$/g, ""),
    }));

  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const entry of entries) {
    if (entry.x === "?" && entry.y === "?") {
      untracked += 1;
      continue;
    }
    if (entry.x !== " " && entry.x !== "?") {
      staged += 1;
    }
    if (entry.y !== " ") {
      unstaged += 1;
    }
  }

  const remotes = remotesRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    branch,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    clean: entries.length === 0,
    counts: {
      staged,
      unstaged,
      untracked,
      total: entries.length,
    },
    entries,
    remotes,
    rootDir: getRootDir(),
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

function isWriteActionName(name: unknown): boolean {
  if (typeof name !== "string") {
    return false;
  }

  const normalized = name.trim().toLowerCase();
  return normalized === "write_file" || normalized === "write" || normalized === "create_file";
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

  const inlineObject = /(\{[\s\S]*?["'](?:action|name|type|tool)["']\s*:\s*["'](?:write_file|write|create_file)["'][\s\S]*?\})/gi;
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
      : (typeof obj.type === "string"
        ? obj.type
        : (typeof obj.tool === "string" ? obj.tool : "")));
  const pathValue = typeof obj.path === "string" ? obj.path : undefined;
  const contentValue = typeof obj.content === "string" ? obj.content : undefined;
  const looksLikeBareWrite = !actionName && Boolean(pathValue && contentValue !== undefined);

  if (isWriteActionName(actionName) || looksLikeBareWrite) {
    if (pathValue && contentValue !== undefined) {
      bucket.push({ path: pathValue.trim(), content: contentValue });
    }
  }

  if ((isWriteActionName(actionName) || looksLikeBareWrite) && obj.arguments) {
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
    /["'](?:action|name|type|tool)["']\s*:\s*["'](?:write_file|write|create_file)["'][\s\S]*?["']path["']\s*:\s*["']([^"'\n]+)["'][\s\S]*?["']content["']\s*:\s*["']([\s\S]*?)["']/gi,
    /\{[\s\S]*?["']path["']\s*:\s*["']([^"'\n]+)["'][\s\S]*?["']content["']\s*:\s*["']([\s\S]*?)["'][\s\S]*?\}/gi,
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

async function openPathInFileManager(targetPath: string): Promise<void> {
  if (process.platform === "win32") {
    // Use cmd.exe /c start which is more reliable than direct explorer.exe spawn
    const { spawn } = await import("node:child_process");
    const child = spawn("cmd.exe", ["/c", "start", "", targetPath], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    // Give it a moment to start, but don't block
    await new Promise((resolve) => setTimeout(resolve, 100));
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("open", [targetPath], { maxBuffer: 256 * 1024 });
    return;
  }
  await execFileAsync("xdg-open", [targetPath], { maxBuffer: 256 * 1024 });
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
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nexus-os-api" });
});

app.get("/api/bootstrap", async (_req, res) => {
  void ensureCoreRuntimeProvisioning();
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const harnessStatus = await resolveHarnessHealth(harnesses);
  const runtimeStatus = await getRuntimeStatus();
  const stableAudioStatus = await getStableAudioStatus();
  const wan2gpStatus = await getWan2GpStatus();
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
  const startup = buildStartupReadiness({
    onboardingComplete: routerConfigured,
    liveHarnesses,
    totalHarnesses: harnessStatus.length,
    runtimeStatus,
    managedStatuses: getManagedHarnessRuntimeStatus(),
  });
  const harnessIds = new Set(harnessStatus.map((harness) => harness.id));
  const selectedPane = state.selectedPane.id === "9router"
    ? { type: "tool" as const, id: "nexus-router" }
    : (state.selectedPane.id === "voice-studio"
      || state.selectedPane.id === "music-generator"
      || state.selectedPane.id === "image-generator"
      || state.selectedPane.id === "video-generator"
      || state.selectedPane.id === "models-generator")
      ? { type: "tool" as const, id: "media-center" }
      : (state.selectedPane.type === "agent" && !harnessIds.has(state.selectedPane.id))
        ? { type: "agent" as const, id: harnessStatus[0]?.id ?? "hermes" }
      : state.selectedPane;

  const mediaCenterStatus: "online" | "offline" | "setup-required" = !stableAudioStatus.installed || !wan2gpStatus.apiReady
    ? "setup-required"
    : "online";

  res.json({
    appName: "NEXUS OS",
    onboardingRequired: !routerConfigured,
    startupStrictMode: isStartupStrictModeEnabled(state),
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
      { id: "media-center", name: "Media Center", status: mediaCenterStatus },
      { id: "game-creator", name: "Game Creator", status: "online" },
      { id: "settings", name: "Settings", status: "online" },
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

app.get("/api/tools/game-creator/setup-wizard", async (_req, res) => {
  const state = await readSystemState();
  const draft = readGameCreatorDraft(state);
  const specPackage = buildGameCreatorSpecPackage(draft);
  res.json({ draft, specPackage });
});

app.post("/api/tools/game-creator/setup-wizard", async (req, res) => {
  const body = req.body as { draft?: unknown };
  const state = await readSystemState();
  const current = readGameCreatorDraft(state);
  const nextDraft = normalizeGameCreatorDraft(body?.draft, current);
  writeGameCreatorDraft(state, nextDraft);
  await writeSystemState(state);
  const specPackage = buildGameCreatorSpecPackage(nextDraft);
  res.json({ ok: true, draft: nextDraft, specPackage });
});

app.post("/api/tools/game-creator/setup-wizard/reset", async (_req, res) => {
  const state = await readSystemState();
  const draft = getDefaultGameCreatorDraft();
  writeGameCreatorDraft(state, draft);
  await writeSystemState(state);
  const specPackage = buildGameCreatorSpecPackage(draft);
  res.json({ ok: true, draft, specPackage });
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
  const body = req.body as { runtime?: "ollama" | "piper" | "default-piper-voice" | "acejam" | "wan2gp" | "hunyuan3d" | "animato" };
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
    } else if (body.runtime === "wan2gp") {
      await installWan2Gp();
    } else if (body.runtime === "hunyuan3d") {
      await installHunyuan3d();
    } else if (body.runtime === "animato") {
      await installAnimato();
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

app.post("/api/tools/runtimes/wan2gp/start", async (_req, res) => {
  try {
    await startWan2GpIfNeeded();
    const status = await getWan2GpStatus();
    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/runtimes/hunyuan3d/start", async (_req, res) => {
  try {
    await startHunyuan3dIfNeeded();
    const status = await getHunyuan3dStatus();
    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/runtimes/animato/start", async (_req, res) => {
  try {
    await startAnimatoIfNeeded();
    const status = await getAnimatoStatus();
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
    const audio = await synthesizeWithWanDeepy(body.text.trim());
    return res.json({ ok: true, ...audio, provider: "wan2gp" });
  } catch (error) {
    try {
      const audio = await synthesizeWithPiper(body.text.trim(), body.voiceId?.trim());
      return res.json({ ok: true, ...audio, provider: "piper" });
    } catch (fallbackError) {
      return res.status(500).json({ error: String(error instanceof Error ? error.message : error) || String(fallbackError) });
    }
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
    try {
      await synthesizeWithWanDeepyToFile(body.text.trim(), destination);
    } catch {
      await synthesizeWithPiperToFile(body.text.trim(), destination, body.voiceId?.trim());
    }
    return res.json({ ok: true, workspaceId: saveTarget.workspaceId, absolutePath: destination, relativePath: path.relative(path.dirname(saveTarget.assetsPath), destination).replace(/\\/g, "/") });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/voice/transcribe", async (req, res) => {
  const body = req.body as { audioBase64?: string; mimeType?: string };
  if (!body.audioBase64?.trim()) {
    return res.status(400).json({ error: "audioBase64 is required" });
  }

  const decoded = body.audioBase64.replace(/^data:[^;]+;base64,/, "");
  const inputBytes = Buffer.from(decoded, "base64");
  if (inputBytes.length === 0) {
    return res.status(400).json({ error: "audioBase64 did not decode to any audio bytes" });
  }

  const extension = body.mimeType?.includes("webm") ? "webm" : body.mimeType?.includes("ogg") ? "ogg" : body.mimeType?.includes("mp4") ? "m4a" : "wav";
  const tempPath = path.join(getRootDir(), "data", "runtime-tools", `whisper-${Date.now()}.${extension}`);

  try {
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, inputBytes);
    const transcription = await transcribeWithWhisper(tempPath);
    return res.json({ ok: true, ...transcription });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
});

app.post("/api/tools/image/generate", async (req, res) => {
  return res.status(410).json({ error: "Remote image generation is disabled. Use /api/tools/image/local/stream for local-only mode." });
});

app.get("/api/tools/image/local/status", async (_req, res) => {
  try {
    const status = await getLocalImageStatus();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

function chooseWanModelFromInstalled(
  installedModels: string[],
  preferredByProfile: string[][],
): string {
  const installedSet = new Set(installedModels);
  for (const preferenceTier of preferredByProfile) {
    for (const candidate of preferenceTier) {
      if (installedSet.has(candidate)) {
        return candidate;
      }
    }
  }
  return installedModels[0] ?? "auto";
}

function buildWanPreferenceTiers(recommendedProfile: number, mode: "image" | "video"): string[][] {
  const lowVramImage = ["flux_schnell", "alpha_sf", "alpha2_sf", "flux", "alpha2", "alpha"];
  const highVramImage = ["qwen_image_20B", "flux", "alpha2", "flux_schnell", "alpha_sf"];
  const lowVramVideo = ["t2v_1.3B", "t2v_sf", "fun_inp_1.3B", "hunyuan", "animate", "alpha2"];
  const highVramVideo = ["ltx2_22B_distilled", "hunyuan", "animate", "t2v_1.3B", "t2v_sf"];

  if (mode === "image") {
    return recommendedProfile <= 2
      ? [highVramImage, lowVramImage]
      : [lowVramImage, highVramImage];
  }

  return recommendedProfile <= 2
    ? [highVramVideo, lowVramVideo]
    : [lowVramVideo, highVramVideo];
}

app.get("/api/tools/wan2gp/status", async (_req, res) => {
  void ensureCoreRuntimeProvisioning();
  try {
    const [status, machine] = await Promise.all([
      getWan2GpStatus(),
      getMachineProfileHint(),
    ]);
    const catalog = status.apiReady
      ? await getWan2GpModelCatalog().catch(() => ({ image: [], video: [], scannedAt: new Date().toISOString() }))
      : { image: [], video: [], scannedAt: new Date().toISOString() };

    const installedImageModels = catalog.image.filter((item) => item.available).map((item) => item.modelType);
    const installedVideoModels = catalog.video.filter((item) => item.available).map((item) => item.modelType);
    const recommendedImageModel = chooseWanModelFromInstalled(
      installedImageModels,
      buildWanPreferenceTiers(machine.recommendedProfile, "image"),
    );
    const recommendedVideoModel = chooseWanModelFromInstalled(
      installedVideoModels,
      buildWanPreferenceTiers(machine.recommendedProfile, "video"),
    );

    const notes = [...status.notes];
    if (status.apiReady) {
      notes.push(`Installed image models: ${installedImageModels.length}`);
      notes.push(`Installed video models: ${installedVideoModels.length}`);
      if (installedImageModels.length === 0 || installedVideoModels.length === 0) {
        notes.push("Installed-only model routing is active. Install at least one Wan2GP model per mode to generate successfully.");
      }
    }

    return res.json({
      ...status,
      notes,
      machine,
      recommended: {
        profile: machine.recommendedProfile,
        image: {
          model: recommendedImageModel,
          width: 768,
          height: 768,
          steps: 6,
        },
        video: {
          model: recommendedVideoModel,
          width: 640,
          height: 384,
          steps: 6,
          durationSeconds: 3,
          fps: 16,
          frameCount: 49,
        },
      },
      modelHints: {
        image: ["auto", ...installedImageModels],
        video: ["auto", ...installedVideoModels],
      },
      modelCatalog: catalog,
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/hunyuan3d/status", async (_req, res) => {
  void ensureCoreRuntimeProvisioning();
  try {
    const status = await getHunyuan3dStatus();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/wan2gp/file", async (req, res) => {
  const relativePath = String(req.query.relativePath ?? "").trim();
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;
  if (!relativePath) {
    return res.status(400).json({ error: "relativePath is required" });
  }

  try {
    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      return res.status(404).json({ error: "Workspace path is unavailable." });
    }

    const absolutePath = resolveWorkspaceTargetPath(workspace.path, relativePath);
    await fs.access(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const imageTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const videoTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
    };
    const contentType = imageTypes[extension] ?? videoTypes[extension];
    if (!contentType) {
      return res.status(400).json({ error: "Unsupported media extension." });
    }

    res.setHeader("Content-Type", contentType);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

// Backward-compatible media endpoint used by older run payloads.
app.get("/api/tools/media/file", async (req, res) => {
  const relativePath = String(req.query.relativePath ?? "").trim();
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;
  if (!relativePath) {
    return res.status(400).json({ error: "relativePath is required" });
  }

  try {
    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      return res.status(404).json({ error: "Workspace path is unavailable." });
    }

    const absolutePath = resolveWorkspaceTargetPath(workspace.path, relativePath);
    await fs.access(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const imageTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const videoTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
    };
    const contentType = imageTypes[extension] ?? videoTypes[extension];
    if (!contentType) {
      return res.status(400).json({ error: "Unsupported media extension." });
    }

    res.setHeader("Content-Type", contentType);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/hunyuan3d/file", async (req, res) => {
  const relativePath = String(req.query.relativePath ?? "").trim();
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;
  if (!relativePath) {
    return res.status(400).json({ error: "relativePath is required" });
  }

  try {
    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      return res.status(404).json({ error: "Workspace path is unavailable." });
    }

    const absolutePath = resolveWorkspaceTargetPath(workspace.path, relativePath);
    await fs.access(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const contentType = extension === ".glb"
      ? "model/gltf-binary"
      : extension === ".obj"
        ? "text/plain"
        : "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/image/local/file", async (req, res) => {
  const relativePath = String(req.query.relativePath ?? "").trim();
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;
  if (!relativePath) {
    return res.status(400).json({ error: "relativePath is required" });
  }

  try {
    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      return res.status(404).json({ error: "Workspace path is unavailable." });
    }

    const absolutePath = resolveWorkspaceTargetPath(workspace.path, relativePath);
    await fs.access(absolutePath);
    if (!/\.(png|jpg|jpeg|webp)$/i.test(absolutePath)) {
      return res.status(400).json({ error: "Only png/jpg/jpeg/webp files are supported." });
    }

    const extension = path.extname(absolutePath).toLowerCase();
    const contentType = extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : "image/png";
    res.setHeader("Content-Type", contentType);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/image/local/stream", async (req, res) => {
  const prompt = String(req.query.prompt ?? "").trim();
  const model = String(req.query.model ?? "sd15").trim();
  const negativePrompt = String(req.query.negativePrompt ?? "").trim();
  const width = Number(req.query.width ?? 512);
  const height = Number(req.query.height ?? 512);
  const steps = Number(req.query.steps ?? 18);
  const guidanceScale = Number(req.query.guidanceScale ?? 6.5);
  const seed = Number(req.query.seed ?? Date.now() % 2147483647);
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const controller = new AbortController();
  const onClientDisconnect = () => {
    controller.abort();
  };
  req.on("close", onClientDisconnect);

  try {
    send({ type: "status", message: "Starting local image generation..." });
    const generated = await generateLocalImageStreaming(
      {
        model,
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        guidanceScale,
        seed,
      },
      (message) => send({ type: "status", message }),
      controller.signal,
    );

    send({ type: "status", message: "Saving generated image into workspace assets..." });
    const bytes = await fs.readFile(generated.outputPath);
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId,
      category: "images",
      baseName: `${generated.model}-local`,
      extension: "png",
      bytes,
    });

    send({
      type: "done",
      result: {
        imageUrl: `/api/tools/image/local/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
        relativePath: saved.relativePath,
        workspaceId: saved.workspaceId,
        provider: "local-diffusers",
        model: generated.model,
        resolvedModel: generated.resolvedModel,
        width: generated.width,
        height: generated.height,
        steps: generated.steps,
        guidanceScale: generated.guidanceScale,
        seed: generated.seed,
        prompt: generated.prompt,
        negativePrompt: generated.negativePrompt,
      },
    });
    return res.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      send({ type: "error", message: String(error) });
    }
    return res.end();
  } finally {
    req.off("close", onClientDisconnect);
  }
});

app.get("/api/tools/wan2gp/image/stream", async (req, res) => {
  const prompt = String(req.query.prompt ?? "").trim();
  const requestedModel = String(req.query.model ?? "").trim();
  const model = requestedModel.toLowerCase() === "auto" ? "" : requestedModel;
  const negativePrompt = String(req.query.negativePrompt ?? "").trim();
  const width = Number(req.query.width ?? 768);
  const height = Number(req.query.height ?? 768);
  const steps = Number(req.query.steps ?? 6);
  const seed = Number(req.query.seed ?? Date.now() % 2147483647);
  const profile = Number(req.query.profile ?? 4);
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const controller = new AbortController();
  const onClientDisconnect = () => {
    controller.abort();
  };
  req.on("close", onClientDisconnect);

  try {
    send({ type: "status", message: "Starting Wan2GP image generation..." });
    const generated = await generateWithWan2GpStreaming(
      {
        mode: "image",
        prompt,
        negativePrompt,
        model,
        width,
        height,
        steps,
        seed,
        profile,
      },
      (message) => send({ type: "status", message }),
      controller.signal,
    );

    send({ type: "status", message: "Saving generated image into workspace assets..." });
    const bytes = await readMediaBytes(generated.outputPath);
    const extension = inferMediaExtension(generated.outputPath, "png");
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId,
      category: "images",
      baseName: "wan2gp-image",
      extension,
      bytes,
    });

    send({
      type: "done",
      result: {
        imageUrl: `/api/tools/wan2gp/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
        relativePath: saved.relativePath,
        workspaceId: saved.workspaceId,
        provider: generated.provider,
        model: generated.model,
        width: generated.width,
        height: generated.height,
        steps: generated.steps,
        seed: generated.seed,
        profile: generated.profile,
        prompt: generated.prompt,
        negativePrompt: generated.negativePrompt,
      },
    });
    return res.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      send({ type: "error", message: String(error) });
    }
    return res.end();
  } finally {
    req.off("close", onClientDisconnect);
  }
});

app.get("/api/tools/wan2gp/video/stream", async (req, res) => {
  const prompt = String(req.query.prompt ?? "").trim();
  const requestedModel = String(req.query.model ?? "").trim();
  const model = requestedModel.toLowerCase() === "auto" ? "" : requestedModel;
  const negativePrompt = String(req.query.negativePrompt ?? "").trim();
  const width = Number(req.query.width ?? 640);
  const height = Number(req.query.height ?? 384);
  const steps = Number(req.query.steps ?? 6);
  const seed = Number(req.query.seed ?? Date.now() % 2147483647);
  const profile = Number(req.query.profile ?? 4);
  const durationSeconds = Number(req.query.durationSeconds ?? 3);
  const fps = Number(req.query.fps ?? 16);
  const frameCount = Number(req.query.frameCount ?? 49);
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const controller = new AbortController();
  const onClientDisconnect = () => {
    controller.abort();
  };
  req.on("close", onClientDisconnect);

  try {
    send({ type: "status", message: "Starting Wan2GP video generation..." });
    const generated = await generateWithWan2GpStreaming(
      {
        mode: "video",
        prompt,
        negativePrompt,
        model,
        width,
        height,
        steps,
        seed,
        profile,
        durationSeconds,
        fps,
        frameCount,
      },
      (message) => send({ type: "status", message }),
      controller.signal,
    );

    send({ type: "status", message: "Saving generated video into workspace assets..." });
    const bytes = await readMediaBytes(generated.outputPath);
    const extension = inferMediaExtension(generated.outputPath, "mp4");
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId,
      category: "videos",
      baseName: "wan2gp-video",
      extension,
      bytes,
    });

    send({
      type: "done",
      result: {
        videoUrl: `/api/tools/wan2gp/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
        relativePath: saved.relativePath,
        workspaceId: saved.workspaceId,
        provider: generated.provider,
        model: generated.model,
        width: generated.width,
        height: generated.height,
        steps: generated.steps,
        seed: generated.seed,
        profile: generated.profile,
        durationSeconds: generated.durationSeconds,
        fps: generated.fps,
        frameCount: generated.frameCount,
        prompt: generated.prompt,
        negativePrompt: generated.negativePrompt,
      },
    });
    return res.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      send({ type: "error", message: String(error) });
    }
    return res.end();
  } finally {
    req.off("close", onClientDisconnect);
  }
});

async function resolveHunyuanSourceImage(input: {
  imageUrl?: string;
  imageBase64?: string;
  textPrompt?: string;
  textNegativePrompt?: string;
  textImageModel?: string;
  textImageWidth?: number;
  textImageHeight?: number;
  textImageSteps?: number;
  textImageProfile?: number;
  textImageSeed?: number;
}, onStatus: (message: string) => void, signal?: AbortSignal): Promise<{
  imageBase64: string;
  sourceKind: "image" | "text";
  sourceBytes: Buffer;
  sourceExtension: string;
}> {
  const directBase64 = String(input.imageBase64 ?? "").trim();
  if (directBase64) {
    const sourceBytes = Buffer.from(directBase64, "base64");
    if (!sourceBytes.length) {
      throw new Error("imageBase64 was provided but could not be decoded.");
    }
    return {
      imageBase64: directBase64,
      sourceKind: "image",
      sourceBytes,
      sourceExtension: "png",
    };
  }

  const imageUrl = String(input.imageUrl ?? "").trim();
  if (imageUrl) {
    const sourceResponse = await fetchWithTimeout(imageUrl, 30000);
    if (!sourceResponse.ok) {
      throw new Error(`Could not fetch source image: ${sourceResponse.status} ${sourceResponse.statusText}`);
    }
    const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
    return {
      imageBase64: sourceBytes.toString("base64"),
      sourceKind: "image",
      sourceBytes,
      sourceExtension: inferExtensionFromContentType(sourceResponse.headers.get("content-type"), "png"),
    };
  }

  const textPrompt = String(input.textPrompt ?? "").trim();
  if (!textPrompt) {
    throw new Error("Provide either imageUrl/imageBase64 or textPrompt.");
  }

  onStatus("No source image provided. Generating source image from text prompt via Wan2GP...");
  await startWan2GpIfNeeded();

  const textImageSeed = Number.isFinite(input.textImageSeed)
    ? Math.round(Number(input.textImageSeed))
    : Math.floor(Date.now() % 2147483647);

  const generatedImage = await generateWithWan2GpStreaming(
    {
      mode: "image",
      prompt: textPrompt,
      negativePrompt: String(input.textNegativePrompt ?? ""),
      model: String(input.textImageModel ?? "auto"),
      width: Number(input.textImageWidth ?? 768),
      height: Number(input.textImageHeight ?? 768),
      steps: Number(input.textImageSteps ?? 6),
      seed: textImageSeed,
      profile: Number(input.textImageProfile ?? getMachineProfileHint()),
    },
    onStatus,
    signal,
  );

  const sourceBytes = await readMediaBytes(generatedImage.outputPath);
  return {
    imageBase64: sourceBytes.toString("base64"),
    sourceKind: "text",
    sourceBytes,
    sourceExtension: inferMediaExtension(generatedImage.outputPath, "png"),
  };
}

async function streamHunyuan3dGeneration(
  req: express.Request,
  res: express.Response,
  input: {
    imageUrl?: string;
    imageBase64?: string;
    textPrompt?: string;
    textNegativePrompt?: string;
    textImageModel?: string;
    textImageWidth?: number;
    textImageHeight?: number;
    textImageSteps?: number;
    textImageProfile?: number;
    textImageSeed?: number;
    modelPath?: string;
    subfolder?: string;
    numInferenceSteps?: number;
    octreeResolution?: number;
    guidanceScale?: number;
    seed?: number;
    format?: string;
    workspaceId?: string;
  },
): Promise<void> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const modelPath = String(input.modelPath ?? "tencent/Hunyuan3D-2mini").trim();
  const subfolder = String(input.subfolder ?? "hunyuan3d-dit-v2-mini-turbo").trim();
  const numInferenceSteps = Number(input.numInferenceSteps ?? 20);
  const octreeResolution = Number(input.octreeResolution ?? 192);
  const guidanceScale = Number(input.guidanceScale ?? 5.0);
  const seed = Number(input.seed ?? Date.now() % 2147483647);
  const format = String(input.format ?? "glb").trim().toLowerCase() === "obj" ? "obj" : "glb";
  const workspaceId = String(input.workspaceId ?? "").trim() || undefined;
  const resolvedWorkspaceForLogs = await ensureWorkspaceAgentsLogsDir(workspaceId).catch(() => null);
  const logFilePath = resolvedWorkspaceForLogs
    ? path.join(resolvedWorkspaceForLogs.logsPath, `run-${runId}.jsonl`)
    : null;

  if (logFilePath) {
    await appendHunyuanAgentLog(logFilePath, {
      ts: new Date().toISOString(),
      event: "run-start",
      runId,
      startedAt,
      workspaceId: resolvedWorkspaceForLogs?.workspaceId,
      request: {
        modelPath,
        subfolder,
        numInferenceSteps,
        octreeResolution,
        guidanceScale,
        seed,
        format,
        source: String(input.textPrompt ?? "").trim() ? "text" : "image",
      },
    }).catch(() => undefined);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

    if (!logFilePath || typeof payload !== "object" || payload === null) {
      return;
    }
    const envelope = payload as { type?: string; message?: string; result?: unknown };
    void appendHunyuanAgentLog(logFilePath, {
      ts: new Date().toISOString(),
      event: envelope.type ?? "unknown",
      runId,
      message: typeof envelope.message === "string" ? envelope.message : undefined,
      result: envelope.type === "done" ? envelope.result : undefined,
    }).catch(() => undefined);
  };

  const controller = new AbortController();
  const onClientDisconnect = () => {
    controller.abort();
  };
  req.on("close", onClientDisconnect);

  try {
    send({ type: "status", message: "Preparing source image..." });
    const resolvedSource = await resolveHunyuanSourceImage({
      imageUrl: input.imageUrl,
      imageBase64: input.imageBase64,
      textPrompt: input.textPrompt,
      textNegativePrompt: input.textNegativePrompt,
      textImageModel: input.textImageModel,
      textImageWidth: input.textImageWidth,
      textImageHeight: input.textImageHeight,
      textImageSteps: input.textImageSteps,
      textImageProfile: input.textImageProfile,
      textImageSeed: input.textImageSeed,
    }, (message) => send({ type: "status", message }), controller.signal);

    const savedSource = await saveBufferToWorkspaceAssets({
      workspaceId,
      category: "images",
      baseName: resolvedSource.sourceKind === "text" ? "hunyuan3d-source-text" : "hunyuan3d-source-image",
      extension: resolvedSource.sourceExtension,
      bytes: resolvedSource.sourceBytes,
    });
    const sourceImageUrl = `/api/tools/image/local/file?workspaceId=${encodeURIComponent(savedSource.workspaceId)}&relativePath=${encodeURIComponent(savedSource.relativePath)}`;
    send({ type: "status", message: `Source image ready (${resolvedSource.sourceKind}).` });

    send({ type: "status", message: "Starting Hunyuan3D-2GP mesh generation..." });
    const generated = await generateWithHunyuan3dStreaming(
      {
        imageBase64: resolvedSource.imageBase64,
        modelPath,
        subfolder,
        numInferenceSteps,
        octreeResolution,
        guidanceScale,
        seed,
        format,
      },
      (message) => send({ type: "status", message }),
      controller.signal,
    );

    send({ type: "status", message: "Saving generated mesh into workspace assets..." });
    const bytes = await readMeshBytes(generated.outputPath);
    const extension = inferMeshExtension(generated.outputPath, format);
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId,
      category: "models",
      baseName: "hunyuan3d-mesh",
      extension,
      bytes,
    });

    send({
      type: "done",
      result: {
        modelUrl: `/api/tools/hunyuan3d/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
        relativePath: saved.relativePath,
        workspaceId: saved.workspaceId,
        provider: generated.provider,
        modelPath: generated.modelPath,
        subfolder: generated.subfolder,
        numInferenceSteps: generated.numInferenceSteps,
        octreeResolution: generated.octreeResolution,
        guidanceScale: generated.guidanceScale,
        seed: generated.seed,
        format: generated.format,
        device: generated.device,
        sourceKind: resolvedSource.sourceKind,
        sourceImageUrl,
      },
    });
    if (logFilePath) {
      await appendHunyuanAgentLog(logFilePath, {
        ts: new Date().toISOString(),
        event: "run-finished",
        runId,
        ok: true,
      }).catch(() => undefined);
    }
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      send({ type: "error", message: String(error) });
    }
    if (logFilePath) {
      await appendHunyuanAgentLog(logFilePath, {
        ts: new Date().toISOString(),
        event: "run-finished",
        runId,
        ok: false,
        error: String(error),
        aborted: controller.signal.aborted,
      }).catch(() => undefined);
    }
    res.end();
  } finally {
    req.off("close", onClientDisconnect);
  }
}

async function streamHunyuan3dFinish(
  req: express.Request,
  res: express.Response,
  input: {
    relativePath?: string;
    workspaceId?: string;
    outputFormat?: string;
    profile?: string;
    sourceImageUrl?: string;
    sourceRelativePath?: string;
  },
): Promise<void> {
  const relativePath = String(input.relativePath ?? "").trim();
  const workspaceId = String(input.workspaceId ?? "").trim() || undefined;
  const outputFormat = String(input.outputFormat ?? "glb").trim().toLowerCase() === "obj" ? "obj" : "glb";
  const requestedProfile = String(input.profile ?? "game-ready-med").trim();
  const profile: BlenderFinishProfile = requestedProfile === "draft"
    || requestedProfile === "game-ready-low"
    || requestedProfile === "game-ready-high"
    ? requestedProfile
    : "game-ready-med";
  const sourceImageUrl = String(input.sourceImageUrl ?? "").trim();
  const explicitSourceRelativePath = String(input.sourceRelativePath ?? "").trim();

  const extractRelativePathFromToolUrl = (value: string): string => {
    if (!value) {
      return "";
    }
    try {
      const parsed = new URL(value, "http://nexus.local");
      const fromQuery = String(parsed.searchParams.get("relativePath") ?? "").trim();
      return fromQuery;
    } catch {
      return "";
    }
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (!relativePath) {
    send({ type: "error", message: "relativePath is required" });
    res.end();
    return;
  }

  const controller = new AbortController();
  const onClientDisconnect = () => {
    controller.abort();
  };
  req.on("close", onClientDisconnect);

  try {
    send({ type: "status", message: "Resolving workspace mesh path..." });
    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      throw new Error("Workspace path is unavailable.");
    }

    const absoluteInputPath = resolveWorkspaceTargetPath(workspace.path, relativePath);
    await fs.access(absoluteInputPath);
    if (!/\.(glb|gltf|obj)$/i.test(absoluteInputPath)) {
      throw new Error("Only glb/gltf/obj meshes are supported for Blender finishing.");
    }

    const sourceRelativePath = explicitSourceRelativePath || extractRelativePathFromToolUrl(sourceImageUrl);
    let sourceImagePath: string | undefined;
    if (sourceRelativePath) {
      const maybeSourcePath = resolveWorkspaceTargetPath(workspace.path, sourceRelativePath);
      try {
        await fs.access(maybeSourcePath);
        if (/\.(png|jpg|jpeg|webp)$/i.test(maybeSourcePath)) {
          sourceImagePath = maybeSourcePath;
          send({ type: "status", message: `Using source image texture: ${sourceRelativePath}` });
        } else {
          send({ type: "status", message: `Skipping texture source (unsupported extension): ${sourceRelativePath}` });
        }
      } catch {
        send({ type: "status", message: `Skipping texture source (missing file): ${sourceRelativePath}` });
      }
    } else {
      send({ type: "status", message: "No source image provided for texturing; running geometry-only finish." });
    }

    send({ type: "status", message: `Starting Blender finish pipeline for ${relativePath}...` });
    const finished = await runBlenderFinishStreaming({
      inputPath: absoluteInputPath,
      outputFormat,
      profile,
      sourceImagePath,
    }, (message) => send({ type: "status", message }), controller.signal);

    send({ type: "status", message: "Saving finished mesh into workspace assets..." });
    const bytes = await readMeshBytes(finished.outputPath);
    const extension = inferMeshExtension(finished.outputPath, finished.outputFormat);
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId,
      category: "models",
      baseName: "hunyuan3d-finished-mesh",
      extension,
      bytes,
    });

    send({
      type: "done",
      result: {
        modelUrl: `/api/tools/hunyuan3d/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
        relativePath: saved.relativePath,
        workspaceId: saved.workspaceId,
        provider: "blender-headless",
        format: finished.outputFormat,
        profile: finished.profile,
        blenderPath: finished.blenderPath,
        stats: finished.stats,
        sourceTextureApplied: finished.textureApplied,
        sourceRelativePath: relativePath,
        sourceImageRelativePath: sourceRelativePath || undefined,
      },
    });
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      send({ type: "error", message: String(error) });
    }
    res.end();
  } finally {
    req.off("close", onClientDisconnect);
  }
}

type AnimatoStreamEnvelope =
  | { type: "status"; message: string }
  | {
    type: "done";
    result: {
      workspaceId: string;
      clips: Array<{
        variation: number;
        prompt: string;
        modelUrl: string;
        relativePath: string;
        format: "glb" | "obj";
      }>;
    };
  }
  | { type: "error"; message: string };

async function streamAnimatoGeneration(
  req: express.Request,
  res: express.Response,
  input: {
    prompt?: string;
    variations?: number;
    sourceRelativePath?: string;
    workspaceId?: string;
    harnessId?: string;
  },
): Promise<void> {
  const prompt = String(input.prompt ?? "").trim();
  const workspaceId = String(input.workspaceId ?? "").trim() || undefined;
  const sourceRelativePath = String(input.sourceRelativePath ?? "").trim();
  const harnessId = String(input.harnessId ?? "").trim() || undefined;
  const variationCount = Math.min(5, Math.max(1, Number(input.variations ?? 1) || 1));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: AnimatoStreamEnvelope) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (!prompt) {
    send({ type: "error", message: "prompt is required" });
    res.end();
    return;
  }

  if (!sourceRelativePath) {
    send({ type: "error", message: "sourceRelativePath is required" });
    res.end();
    return;
  }

  const controller = new AbortController();
  const onClientDisconnect = () => {
    controller.abort();
  };
  req.on("close", onClientDisconnect);

  const clips: Array<{
    variation: number;
    prompt: string;
    modelUrl: string;
    relativePath: string;
    format: "glb" | "obj";
  }> = [];

  try {
    send({ type: "status", message: "Checking Animato runtime readiness..." });
    await startAnimatoIfNeeded();
    const animatoBaseUrl = getAnimatoBaseUrl();

    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      throw new Error("Workspace path is unavailable.");
    }

    const absoluteInputPath = resolveWorkspaceTargetPath(workspace.path, sourceRelativePath);
    await fs.access(absoluteInputPath);
    if (!/\.(glb|gltf|fbx)$/i.test(absoluteInputPath)) {
      throw new Error("Animato requires a rigged glb/gltf/fbx source model.");
    }

    const sourceBytes = await fs.readFile(absoluteInputPath);
    const sourceFileName = path.basename(absoluteInputPath);

    for (let index = 0; index < variationCount; index += 1) {
      if (controller.signal.aborted) {
        throw new Error("Animation generation canceled.");
      }

      const variation = index + 1;
      const variationPrompt = variationCount > 1
        ? `${prompt}\n\nVariation ${variation}/${variationCount}: keep same action intent but alter timing, emphasis, and pacing.`
        : prompt;

      send({ type: "status", message: `Variation ${variation}/${variationCount}: uploading source model...` });
      const uploadForm = new FormData();
      uploadForm.append("file", new Blob([sourceBytes]), sourceFileName);
      const uploadResponse = await fetch(`${animatoBaseUrl}/api/upload`, {
        method: "POST",
        body: uploadForm,
        signal: controller.signal,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Animato upload failed: HTTP ${uploadResponse.status}`);
      }
      const uploadPayload = (await uploadResponse.json()) as { filename?: string };
      const uploadedFilename = String(uploadPayload.filename ?? "").trim();
      if (!uploadedFilename) {
        throw new Error("Animato upload response did not include a filename.");
      }

      send({ type: "status", message: `Variation ${variation}/${variationCount}: building Animato skeleton prompt...` });
      const promptResponse = await fetch(`${animatoBaseUrl}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadedFilename, message: variationPrompt }),
        signal: controller.signal,
      });
      if (!promptResponse.ok) {
        throw new Error(`Animato prompt build failed: HTTP ${promptResponse.status}`);
      }
      const promptPayload = (await promptResponse.json()) as { prompt?: string };
      const animatoPrompt = String(promptPayload.prompt ?? "").trim();
      if (!animatoPrompt) {
        throw new Error("Animato did not return a prompt payload for script generation.");
      }

      send({ type: "status", message: `Variation ${variation}/${variationCount}: generating bpy script via Nexus Router...` });
      const routed = await routeChatWithFallback(state, {
        harnessId,
        messages: [
          {
            role: "system",
            content: "You generate Blender Python scripts only. Return only executable Python code, no markdown, no commentary.",
          },
          {
            role: "user",
            content: animatoPrompt,
          },
        ],
        temperature: 0.2,
      });
      const script = String(routed.content ?? "").trim();
      if (!script) {
        throw new Error("Nexus Router returned an empty animation script.");
      }

      send({ type: "status", message: `Variation ${variation}/${variationCount}: running Animato bake...` });
      const runResponse = await fetch(`${animatoBaseUrl}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: script,
        signal: controller.signal,
      });
      if (!runResponse.ok) {
        throw new Error(`Animato run failed: HTTP ${runResponse.status}`);
      }
      const runPayload = (await runResponse.json()) as { ok?: boolean; output_url?: string; stderr?: string; returncode?: number };
      if (!runPayload.ok) {
        throw new Error(`Animato run returned failure.${runPayload.stderr ? ` ${runPayload.stderr}` : ""}`);
      }

      const outputUrl = String(runPayload.output_url ?? "").trim();
      if (!outputUrl) {
        throw new Error("Animato run completed without output_url.");
      }

      const resolvedOutputUrl = /^https?:\/\//i.test(outputUrl)
        ? outputUrl
        : `${animatoBaseUrl}${outputUrl.startsWith("/") ? "" : "/"}${outputUrl}`;

      const outputResponse = await fetch(resolvedOutputUrl, {
        signal: controller.signal,
      });
      if (!outputResponse.ok) {
        throw new Error(`Could not download Animato output file: HTTP ${outputResponse.status}`);
      }
      const outputBytes = Buffer.from(await outputResponse.arrayBuffer());
      const extension = path.extname(uploadedFilename).toLowerCase().replace(/^\./, "") || "glb";
      const saved = await saveBufferToWorkspaceAssets({
        workspaceId,
        category: "models",
        baseName: `animato-${sanitizeFileNameSegment(prompt, "animation")}-v${variation}`,
        extension,
        bytes: outputBytes,
      });

      const format: "glb" | "obj" = extension === "obj" ? "obj" : "glb";
      clips.push({
        variation,
        prompt: variationPrompt,
        modelUrl: `/api/tools/hunyuan3d/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
        relativePath: saved.relativePath,
        format,
      });
      send({ type: "status", message: `Variation ${variation}/${variationCount}: saved ${saved.relativePath}` });
    }

    await writeSystemState(state);
    send({
      type: "done",
      result: {
        workspaceId: workspace.id,
        clips,
      },
    });
    res.end();
  } catch (error) {
    send({ type: "error", message: String(error) });
    res.end();
  } finally {
    req.off("close", onClientDisconnect);
  }
}

app.get("/api/tools/hunyuan3d/generate/stream", async (req, res) => {
  await streamHunyuan3dGeneration(req, res, {
    imageUrl: String(req.query.imageUrl ?? ""),
    textPrompt: String(req.query.textPrompt ?? ""),
    textNegativePrompt: String(req.query.textNegativePrompt ?? ""),
    textImageModel: String(req.query.textImageModel ?? ""),
    textImageWidth: Number(req.query.textImageWidth ?? 768),
    textImageHeight: Number(req.query.textImageHeight ?? 768),
    textImageSteps: Number(req.query.textImageSteps ?? 6),
    textImageProfile: Number(req.query.textImageProfile ?? getMachineProfileHint()),
    textImageSeed: Number(req.query.textImageSeed ?? Date.now() % 2147483647),
    modelPath: String(req.query.modelPath ?? "tencent/Hunyuan3D-2mini"),
    subfolder: String(req.query.subfolder ?? "hunyuan3d-dit-v2-mini-turbo"),
    numInferenceSteps: Number(req.query.numInferenceSteps ?? 20),
    octreeResolution: Number(req.query.octreeResolution ?? 192),
    guidanceScale: Number(req.query.guidanceScale ?? 5.0),
    seed: Number(req.query.seed ?? Date.now() % 2147483647),
    format: String(req.query.format ?? "glb"),
    workspaceId: String(req.query.workspaceId ?? ""),
  });
});

app.post("/api/tools/hunyuan3d/generate/stream", async (req, res) => {
  const body = req.body as {
    imageUrl?: string;
    imageBase64?: string;
    textPrompt?: string;
    textNegativePrompt?: string;
    textImageModel?: string;
    textImageWidth?: number;
    textImageHeight?: number;
    textImageSteps?: number;
    textImageProfile?: number;
    textImageSeed?: number;
    modelPath?: string;
    subfolder?: string;
    numInferenceSteps?: number;
    octreeResolution?: number;
    guidanceScale?: number;
    seed?: number;
    format?: string;
    workspaceId?: string;
  };
  await streamHunyuan3dGeneration(req, res, body ?? {});
});

app.post("/api/tools/hunyuan3d/finish/stream", async (req, res) => {
  const body = req.body as {
    relativePath?: string;
    workspaceId?: string;
    outputFormat?: string;
    profile?: string;
    sourceImageUrl?: string;
    sourceRelativePath?: string;
  };
  await streamHunyuan3dFinish(req, res, body ?? {});
});

app.get("/api/tools/animation/status", async (_req, res) => {
  try {
    const status = await getAnimatoStatus();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/animation/generate/stream", async (req, res) => {
  const body = req.body as {
    prompt?: string;
    variations?: number;
    sourceRelativePath?: string;
    workspaceId?: string;
    harnessId?: string;
  };
  await streamAnimatoGeneration(req, res, body ?? {});
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

app.get("/api/tools/music/file", async (req, res) => {
  const relativePath = String(req.query.relativePath ?? "").trim();
  const workspaceId = String(req.query.workspaceId ?? "").trim() || undefined;
  if (!relativePath) {
    return res.status(400).json({ error: "relativePath is required" });
  }

  try {
    const state = await readSystemState();
    const workspace = await resolveWorkspaceContext(state, workspaceId);
    if (!workspace.path) {
      return res.status(404).json({ error: "Workspace path is unavailable." });
    }

    const absolutePath = resolveWorkspaceTargetPath(workspace.path, relativePath);
    await fs.access(absolutePath);
    if (!/\.(wav|mp3|ogg)$/i.test(absolutePath)) {
      return res.status(400).json({ error: "Only wav/mp3/ogg files are supported." });
    }

    const extension = path.extname(absolutePath).toLowerCase();
    const contentType = extension === ".mp3"
      ? "audio/mpeg"
      : extension === ".ogg"
        ? "audio/ogg"
        : "audio/wav";
    res.setHeader("Content-Type", contentType);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/music/stable-audio/status", async (_req, res) => {
  try {
    const status = await getStableAudioStatus();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/music/stable-audio/launch", async (req, res) => {
  const { mode } = req.body as { mode?: StableAudioMode };
  if (mode !== "small-music" && mode !== "small-sfx" && mode !== "medium") {
    return res.status(400).json({ error: "mode must be one of small-music, small-sfx, or medium." });
  }

  try {
    const result = await launchStableAudio(mode);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post("/api/tools/music/stable-audio/generate", async (req, res) => {
  const body = req.body as { mode?: StableAudioMode; prompt?: string; duration?: number; workspaceId?: string; fileName?: string };
  const mode = body.mode;
  const prompt = body.prompt?.trim() ?? "";
  const duration = Number(body.duration ?? 30);

  if (mode !== "small-music" && mode !== "small-sfx" && mode !== "medium") {
    return res.status(400).json({ error: "mode must be one of small-music, small-sfx, or medium." });
  }
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required." });
  }

  const maxDuration = mode === "medium" ? 380 : 120;
  if (!Number.isFinite(duration) || duration < 1 || duration > maxDuration) {
    return res.status(400).json({ error: `duration must be between 1 and ${maxDuration} seconds for ${mode}.` });
  }

  try {
    const generated = await generateStableAudioAudio({ mode, prompt, duration });
    const bytes = await fs.readFile(generated.outputPath);
    const saved = await saveBufferToWorkspaceAssets({
      workspaceId: body.workspaceId,
      category: "music",
      baseName: body.fileName ?? `${mode}-generated`,
      extension: "wav",
      bytes,
    });

    return res.json({
      ok: true,
      mode,
      duration,
      prompt,
      outputPath: generated.outputPath,
      playbackUrl: `/api/tools/music/file?workspaceId=${encodeURIComponent(saved.workspaceId)}&relativePath=${encodeURIComponent(saved.relativePath)}`,
      ...saved,
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/git/status", async (_req, res) => {
  try {
    const snapshot = await getGitStatusSnapshot();
    return res.json(snapshot);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get("/api/tools/connectors/github/status", async (_req, res) => {
  const connector = await readGitHubConnectorState();
  return res.json(toGitHubConnectorStatus(connector));
});

app.post("/api/tools/connectors/github/device/start", async (req, res) => {
  const { clientId, scopes } = req.body as { clientId?: string; scopes?: string[] };
  const trimmedClientId = clientId?.trim() ?? "";
  if (!trimmedClientId) {
    return res.status(400).json({ error: "GitHub OAuth clientId is required." });
  }

  try {
    const flow = await startGitHubDeviceFlow(trimmedClientId, Array.isArray(scopes) && scopes.length > 0 ? scopes : ["repo"]);
    pendingGitHubDeviceFlows.set(flow.device_code, {
      clientId: trimmedClientId,
      scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : ["repo"],
      expiresAt: Date.now() + (flow.expires_in * 1000),
      interval: flow.interval ?? 5,
    });
    return res.json({
      ok: true,
      device: flow,
      clientId: trimmedClientId,
      scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : ["repo"],
    });
  } catch (error) {
    return res.status(502).json({ error: String(error) });
  }
});

app.post("/api/tools/connectors/github/device/poll", async (req, res) => {
  const { clientId, deviceCode } = req.body as { clientId?: string; deviceCode?: string };
  const trimmedClientId = clientId?.trim() ?? "";
  const trimmedDeviceCode = deviceCode?.trim() ?? "";
  if (!trimmedClientId || !trimmedDeviceCode) {
    return res.status(400).json({ error: "clientId and deviceCode are required." });
  }

  const session = pendingGitHubDeviceFlows.get(trimmedDeviceCode);
  if (!session) {
    return res.status(404).json({ error: "GitHub device flow session not found." });
  }

  if (session.clientId !== trimmedClientId) {
    return res.status(400).json({ error: "Client ID does not match the pending device flow." });
  }

  if (Date.now() > session.expiresAt) {
    pendingGitHubDeviceFlows.delete(trimmedDeviceCode);
    return res.status(410).json({ error: "GitHub device flow expired." });
  }

  try {
    const tokenResponse = await pollGitHubDeviceFlow(trimmedClientId, trimmedDeviceCode);
    if (tokenResponse.error) {
      if (tokenResponse.error === "authorization_pending" || tokenResponse.error === "slow_down") {
        return res.status(202).json({
          ok: false,
          pending: true,
          error: tokenResponse.error,
          errorDescription: tokenResponse.error_description ?? null,
          interval: session.interval,
        });
      }

      if (tokenResponse.error === "expired_token") {
        pendingGitHubDeviceFlows.delete(trimmedDeviceCode);
        return res.status(410).json({ error: tokenResponse.error_description ?? "GitHub device token expired." });
      }

      return res.status(401).json({ error: tokenResponse.error_description ?? tokenResponse.error ?? "GitHub device flow failed." });
    }

    if (!tokenResponse.access_token) {
      return res.status(502).json({ error: "GitHub did not return an access token." });
    }

    pendingGitHubDeviceFlows.delete(trimmedDeviceCode);
    const verified = await saveVerifiedGitHubConnector(tokenResponse.access_token);
    return res.json({
      ok: true,
      connector: verified.connector,
      tokenType: tokenResponse.token_type ?? null,
      scope: tokenResponse.scope ?? null,
    });
  } catch (error) {
    return res.status(502).json({ error: String(error) });
  }
});

app.post("/api/tools/connectors/github/connect", async (req, res) => {
  const { token } = req.body as { token?: string };
  const trimmedToken = token?.trim() ?? "";
  if (!trimmedToken) {
    return res.status(400).json({ error: "GitHub token is required." });
  }

  try {
    const verified = await saveVerifiedGitHubConnector(trimmedToken);
    return res.json({ ok: true, connector: verified.connector });
  } catch (error) {
    return res.status(401).json({ error: String(error) });
  }
});

app.post("/api/tools/connectors/github/disconnect", async (_req, res) => {
  await clearGitHubConnectorState();
  return res.json({ ok: true, connector: toGitHubConnectorStatus(null) });
});

app.post("/api/tools/git/commit", async (req, res) => {
  const { message } = req.body as { message?: string };
  const commitMessage = message?.trim() ?? "";
  if (commitMessage.length < 3) {
    return res.status(400).json({ error: "Commit message must be at least 3 characters." });
  }

  try {
    await runGit(["add", "-A"]);
    const commitResult = await runGit(["commit", "-m", commitMessage]);
    const status = await getGitStatusSnapshot();
    return res.json({ ok: true, output: commitResult.stdout || commitResult.stderr, status });
  } catch (error) {
    const messageText = String(error);
    if (messageText.includes("nothing to commit") || messageText.includes("no changes added to commit")) {
      return res.status(400).json({ error: "Nothing to commit. No changes detected." });
    }
    return res.status(500).json({ error: messageText });
  }
});

app.post("/api/tools/git/push", async (req, res) => {
  const { remote, branch } = req.body as { remote?: string; branch?: string };
  const remoteName = remote?.trim() || "origin";

  try {
    const snapshot = await getGitStatusSnapshot();
    const branchName = branch?.trim() || snapshot.branch;
    if (!branchName || branchName === "detached") {
      return res.status(400).json({ error: "Cannot push from detached HEAD. Checkout a branch first." });
    }

    const remoteUrlResult = await runGit(["remote", "get-url", remoteName]);
    const remoteUrl = remoteUrlResult.stdout.trim();
    const connector = await readGitHubConnectorState();
    const normalizedRemoteUrl = normalizeGitHubRemoteUrl(remoteUrl);
    const isGithubRemote = /github\.com/i.test(normalizedRemoteUrl);
    const canUseConnector = Boolean(
      connector?.accessToken
      && /^https?:\/\//i.test(normalizedRemoteUrl)
      && isGithubRemote,
    );

    if (connector?.accessToken && !isGithubRemote) {
      return res.status(400).json({ error: "GitHub connector is connected, but the current remote is not GitHub. Use a GitHub remote or disconnect the connector." });
    }

    const pushResult = await runGit(
      ["push", remoteName, branchName],
      canUseConnector ? { githubToken: connector?.accessToken, remoteUrl: normalizedRemoteUrl } : undefined,
    );
    const status = await getGitStatusSnapshot();
    return res.json({
      ok: true,
      output: pushResult.stdout || pushResult.stderr,
      status,
      usedGithubConnector: canUseConnector,
      remoteUrl,
    });
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
  const runtimeStatus = await getRuntimeStatus();
  const managedStatuses = getManagedHarnessRuntimeStatus();

  const liveHarnesses = conformance.filter((item) =>
    item.checks.some((check) => (check.name === "live-health-check" || check.name.startsWith("live-probe-")) && check.passed)
  ).length;

  const startup = buildStartupReadiness({
    onboardingComplete: isNexusRouterConfigured(state),
    liveHarnesses,
    totalHarnesses: harnesses.length,
    runtimeStatus,
    managedStatuses,
  });
  await persistStartupCheck(startup);
  res.json({
    startup,
    conformance,
    runtimeStatus,
    managedStatuses,
    strictMode: isStartupStrictModeEnabled(state),
    selfRepairReport: buildSelfRepairReport(),
  });
});

app.get("/api/startup/check/last", async (_req, res) => {
  const last = await getLastStartupCheck();
  res.json({ last });
});

app.get("/api/startup/strict-mode", async (_req, res) => {
  const state = await readSystemState();
  res.json({ enabled: isStartupStrictModeEnabled(state) });
});

app.post("/api/startup/strict-mode", async (req, res) => {
  const body = req.body as { enabled?: boolean };
  const state = await readSystemState();
  state.startupStrictMode = Boolean(body.enabled);
  await writeSystemState(state);
  return res.json({ ok: true, enabled: state.startupStrictMode });
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

app.get("/api/router/catalog", (_req, res) => {
  const tier = String(_req.query.tier ?? "").trim();
  const search = String(_req.query.search ?? "").trim();
  res.json({
    providers: listProviderCatalog({ tier, search }),
  });
});

app.get("/api/router/templates", (_req, res) => {
  res.json({ templates: listRouterFallbackTemplates() });
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

app.get("/api/harnesses/:harnessId/capabilities", async (req, res) => {
  const { harnessId } = req.params;
  const state = await readSystemState();
  const capabilities = getHarnessCapabilities(state, harnessId);
  await writeSystemState(state);
  return res.json({ harnessId, capabilities });
});

app.put("/api/harnesses/:harnessId/capabilities", async (req, res) => {
  const { harnessId } = req.params;
  const body = req.body as {
    fableMode?: {
      enabled?: boolean;
    };
    openDesign?: {
      enabled?: boolean;
    };
    crawl4ai?: {
      enabled?: boolean;
      allowedDomains?: string[];
      allowExternalDomains?: boolean;
      obeyRobotsTxt?: boolean;
      maxPages?: number;
      timeoutMs?: number;
    };
    officeCli?: {
      enabled?: boolean;
      allowedExtensions?: string[];
      maxFileSizeMb?: number;
    };
  };

  const state = await readSystemState();
  const capabilities = updateHarnessCapabilities(state, harnessId, {
    fableMode: body.fableMode,
    openDesign: body.openDesign,
    crawl4ai: body.crawl4ai,
    officeCli: body.officeCli,
  });
  await writeSystemState(state);
  return res.json({ ok: true, harnessId, capabilities });
});

app.get("/api/tools/web-capabilities/diagnostics", async (_req, res) => {
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const history = await readWebCapabilitiesHistory();
  const fableTelemetry = summarizeFableTelemetry(await readFableTelemetry());

  const probes = {
    crawl4ai: { available: false, command: "", details: "" },
    officecli: { available: false, command: "", details: "" },
  };

  const probeCandidates: Array<{ key: keyof typeof probes; command: string; args: string[] }> = [
    { key: "crawl4ai", command: "crawl4ai", args: ["--help"] },
    { key: "crawl4ai", command: "python", args: ["-m", "crawl4ai", "--help"] },
    { key: "crawl4ai", command: "py", args: ["-m", "crawl4ai", "--help"] },
    { key: "officecli", command: "officecli", args: ["--help"] },
    { key: "officecli", command: "office", args: ["--help"] },
  ];

  for (const probe of probeCandidates) {
    if (probes[probe.key].available) {
      continue;
    }

    try {
      await execFileAsync(probe.command, probe.args, { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 * 4 });
      probes[probe.key] = {
        available: true,
        command: [probe.command, ...probe.args].join(" "),
        details: "Command probe succeeded.",
      };
    } catch (error) {
      probes[probe.key] = {
        ...probes[probe.key],
        command: probes[probe.key].command || [probe.command, ...probe.args].join(" "),
        details: String(error),
      };
    }
  }

  const harnessCapabilitySummary = harnesses.map((harness) => {
    const capabilities = getHarnessCapabilities(state, harness.id);
    return {
      harnessId: harness.id,
      harnessName: harness.name,
      fableModeEnabled: capabilities.fableMode.enabled,
      crawl4aiEnabled: capabilities.crawl4ai.enabled,
      officeCliEnabled: capabilities.officeCli.enabled,
      crawlAllowlistCount: capabilities.crawl4ai.allowedDomains.length,
    };
  });

  const policyWarnings = harnesses.flatMap((harness) => {
    const capabilities = getHarnessCapabilities(state, harness.id);
    const warnings: string[] = [];
    if (capabilities.crawl4ai.enabled) {
      if (capabilities.crawl4ai.allowedDomains.length === 0) {
        warnings.push(`${harness.name}: Crawl4AI enabled with empty allowlist.`);
      }
      if (capabilities.crawl4ai.allowExternalDomains) {
        warnings.push(`${harness.name}: Crawl4AI external domains enabled.`);
      }
    }
    if (capabilities.officeCli.enabled && capabilities.officeCli.allowedExtensions.length > 8) {
      warnings.push(`${harness.name}: OfficeCLI extension allowlist is very broad.`);
    }
    return warnings;
  });

  const runtimeStatus = await getRuntimeStatus();
  const managedStatuses = getManagedHarnessRuntimeStatus();
  await writeSystemState(state);

  return res.json({
    probes,
    harnessCapabilitySummary,
    runtimeStatus,
    managedStatuses,
    history,
    policyWarnings,
    fableTelemetry,
    checkedAt: new Date().toISOString(),
  });
});

app.post("/api/tools/crawl4ai/run", async (req, res) => {
  const body = req.body as {
    harnessId?: string;
    url?: string;
    workspaceId?: string;
    maxPages?: number;
  };

  const harnessId = String(body.harnessId ?? "").trim();
  const targetUrl = String(body.url ?? "").trim();
  const startedAt = Date.now();
  if (!harnessId || !targetUrl) {
    return res.status(400).json({ error: "harnessId and url are required" });
  }
  if (!isHttpUrl(targetUrl)) {
    return res.status(400).json({ error: "url must be an http(s) URL" });
  }

  const state = await readSystemState();
  const capabilities = getHarnessCapabilities(state, harnessId);
  if (!capabilities.crawl4ai.enabled) {
    return res.status(403).json({ error: "Crawl4AI is disabled for this harness" });
  }

  const domain = extractDomain(targetUrl);
  const inAllowList = capabilities.crawl4ai.allowedDomains.includes(domain);
  if (!capabilities.crawl4ai.allowExternalDomains && capabilities.crawl4ai.allowedDomains.length > 0 && !inAllowList) {
    return res.status(403).json({ error: `Domain ${domain} is not in this harness allowlist` });
  }

  let workspacePath = "";
  try {
    workspacePath = await resolveWorkspacePathFromState(state, body.workspaceId);
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }

  const outputFile = path.join(workspacePath, `crawl4ai-${Date.now()}.json`);
  const maxPages = Math.max(1, Math.min(Number(body.maxPages ?? capabilities.crawl4ai.maxPages), capabilities.crawl4ai.maxPages));

  const commandCandidates: Array<{ cmd: string; args: string[] }> = [
    {
      cmd: "crawl4ai",
      args: ["crawl", targetUrl, "--max-pages", String(maxPages), "--output", outputFile],
    },
    {
      cmd: "python",
      args: ["-m", "crawl4ai", "crawl", targetUrl, "--max-pages", String(maxPages), "--output", outputFile],
    },
    {
      cmd: "py",
      args: ["-m", "crawl4ai", "crawl", targetUrl, "--max-pages", String(maxPages), "--output", outputFile],
    },
  ];

  let lastError = "";
  for (const candidate of commandCandidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate.cmd, candidate.args, {
        cwd: workspacePath,
        timeout: capabilities.crawl4ai.timeoutMs,
      });

      const preview = await fs.readFile(outputFile, "utf-8").catch(() => "");
      await appendCrawlRunHistory({
        id: crypto.randomUUID(),
        harnessId,
        url: targetUrl,
        domain,
        workspaceId: String(body.workspaceId ?? state.activeWorkspaceId),
        outputFile,
        status: "success",
        durationMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      });
      return res.json({
        ok: true,
        harnessId,
        url: targetUrl,
        outputFile,
        domain,
        command: [candidate.cmd, ...candidate.args].join(" "),
        stdout,
        stderr,
        preview: preview.slice(0, 60_000),
      });
    } catch (error) {
      lastError = String(error);
    }
  }

  await appendCrawlRunHistory({
    id: crypto.randomUUID(),
    harnessId,
    url: targetUrl,
    domain,
    workspaceId: String(body.workspaceId ?? state.activeWorkspaceId),
    status: "failed",
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    error: lastError,
  });

  return res.status(502).json({
    error: "Crawl4AI command failed. Install crawl4ai in your local Python environment or add crawl4ai to PATH.",
    details: lastError,
  });
});

app.post("/api/tools/officecli/run", async (req, res) => {
  const body = req.body as {
    harnessId?: string;
    workspaceId?: string;
    args?: string[];
    file?: string;
    preset?: string;
  };

  const harnessId = String(body.harnessId ?? "").trim();
  const startedAt = Date.now();
  if (!harnessId) {
    return res.status(400).json({ error: "harnessId is required" });
  }

  const state = await readSystemState();
  const capabilities = getHarnessCapabilities(state, harnessId);
  if (!capabilities.officeCli.enabled) {
    return res.status(403).json({ error: "OfficeCLI is disabled for this harness" });
  }

  let workspacePath = "";
  try {
    workspacePath = await resolveWorkspacePathFromState(state, body.workspaceId);
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }

  const args = Array.isArray(body.args) ? body.args.map((entry) => String(entry)) : [];
  const filePathRaw = String(body.file ?? "").trim();
  if (!filePathRaw) {
    return res.status(400).json({ error: "file is required (workspace-relative path)" });
  }

  let absoluteFilePath = "";
  try {
    absoluteFilePath = safeWorkspaceJoin(workspacePath, filePathRaw);
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }

  const extension = path.extname(absoluteFilePath).toLowerCase();
  if (!capabilities.officeCli.allowedExtensions.includes(extension)) {
    return res.status(403).json({ error: `Extension ${extension || "(none)"} is blocked for this harness` });
  }

  const stat = await fs.stat(absoluteFilePath).catch(() => null);
  if (!stat) {
    return res.status(404).json({ error: "file does not exist in workspace" });
  }

  const maxBytes = capabilities.officeCli.maxFileSizeMb * 1024 * 1024;
  if (stat.size > maxBytes) {
    return res.status(413).json({ error: `file exceeds maxFileSizeMb (${capabilities.officeCli.maxFileSizeMb} MB)` });
  }

  const commandCandidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: "officecli", args: [...args, absoluteFilePath] },
    { cmd: "office", args: [...args, absoluteFilePath] },
  ];

  let lastError = "";
  for (const candidate of commandCandidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate.cmd, candidate.args, {
        cwd: workspacePath,
        timeout: 120000,
      });
      await appendOfficeRunHistory({
        id: crypto.randomUUID(),
        harnessId,
        workspaceId: String(body.workspaceId ?? state.activeWorkspaceId),
        file: filePathRaw,
        args,
        preset: body.preset,
        status: "success",
        durationMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      });
      return res.json({
        ok: true,
        harnessId,
        file: filePathRaw,
        command: [candidate.cmd, ...candidate.args].join(" "),
        stdout,
        stderr,
      });
    } catch (error) {
      lastError = String(error);
    }
  }

  await appendOfficeRunHistory({
    id: crypto.randomUUID(),
    harnessId,
    workspaceId: String(body.workspaceId ?? state.activeWorkspaceId),
    file: filePathRaw,
    args,
    preset: body.preset,
    status: "failed",
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    error: lastError,
  });

  return res.status(502).json({
    error: "OfficeCLI command failed. Install officecli and ensure it is available on PATH.",
    details: lastError,
  });
});

app.get("/api/tools/officecli/presets", (_req, res) => {
  res.json({
    presets: [
      { id: "view", label: "View (json)", description: "Read document structure/output safely.", args: ["view", "--json"] },
      { id: "validate", label: "Validate", description: "Validate Office file integrity.", args: ["validate"] },
      { id: "create", label: "Create", description: "Create file scaffold for selected type.", args: ["create"] },
    ],
  });
});

app.post("/api/tools/officecli/run-preset", async (req, res) => {
  const body = req.body as {
    harnessId?: string;
    workspaceId?: string;
    preset?: "view" | "validate" | "create";
    file?: string;
    kind?: "docx" | "xlsx" | "pptx";
  };

  const preset = body.preset;
  if (!preset || !body.file?.trim() || !body.harnessId?.trim()) {
    return res.status(400).json({ error: "harnessId, preset, and file are required" });
  }

  let args: string[] = [];
  if (preset === "view") {
    args = ["view", "--json"];
  } else if (preset === "validate") {
    args = ["validate"];
  } else if (preset === "create") {
    const kind = body.kind ?? "docx";
    args = ["create", "--type", kind];
  }

  const proxyResponse = await fetch(`http://127.0.0.1:${port}/api/tools/officecli/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      harnessId: body.harnessId,
      workspaceId: body.workspaceId,
      file: body.file,
      args,
      preset,
    }),
  });

  const payload = await proxyResponse.json();
  if (!proxyResponse.ok) {
    return res.status(proxyResponse.status).json(payload);
  }

  return res.json({ ok: true, preset, ...payload });
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
    await ensureWorkspaceAgentsScaffold(created.path);
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

app.post("/api/workspaces/open", async (req, res) => {
  const body = req.body as { workspaceId?: string; relativePath?: string };
  const state = await readSystemState();
  const workspace = await resolveWorkspaceContext(state, body.workspaceId);
  if (!workspace.path) {
    return res.status(404).json({ error: "Workspace path is unavailable." });
  }

  try {
    const targetPath = body.relativePath?.trim()
      ? resolveWorkspaceTargetPath(workspace.path, body.relativePath)
      : workspace.path;
    const stats = await fs.stat(targetPath);
    const openTarget = stats.isDirectory() ? targetPath : path.dirname(targetPath);
    await openPathInFileManager(openTarget);
    return res.json({ ok: true, openedPath: openTarget });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
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
  const githubConnectorForChat = await readGitHubConnectorState();
  const githubLoginForChat = githubConnectorForChat?.login ?? undefined;
  const taskId = requestId ?? crypto.randomUUID();

  if (!isNexusRouterConfigured(state)) {
    return res.status(412).json({
      error: "Complete Nexus Router setup before starting chats.",
    });
  }

  if (isStartupStrictModeEnabled(state)) {
    const liveHarnesses = (await resolveHarnessHealth(harnesses)).filter((entry) => entry.status === "online").length;
    const runtimeStatus = await getRuntimeStatus();
    const startup = buildStartupReadiness({
      onboardingComplete: isNexusRouterConfigured(state),
      liveHarnesses,
      totalHarnesses: harnesses.length,
      runtimeStatus,
      managedStatuses: getManagedHarnessRuntimeStatus(),
    });
    if (!startup.ready) {
      return res.status(412).json({ error: `Strict startup mode is enabled. Resolve blockers first: ${startup.blockers.join(" ")}` });
    }
  }

  if (!harness) {
    return res.status(404).json({ error: `Unknown harness: ${harnessId}` });
  }

  const fableProfile = getHarnessCapabilities(state, harnessId).fableMode.profile;

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
      githubLogin: githubLoginForChat,
    });

    if (workspace.path) {
      const actionResult = await applyWorkspaceActionsFromHarnessOutput(adapterResult.content, workspace.path);
      adapterResult = {
        ...adapterResult,
        content: actionResult.output,
      };
    }
  } catch (error) {
    if (fableProfile !== "off") {
      await appendFableTelemetry({
        id: crypto.randomUUID(),
        harnessId,
        profile: fableProfile,
        success: false,
        fallbackUsed: false,
        createdAt: new Date().toISOString(),
      });
    }
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

  if (fableProfile !== "off") {
    await appendFableTelemetry({
      id: crypto.randomUUID(),
      harnessId,
      profile: fableProfile,
      success: true,
      fallbackUsed: Boolean(adapterResult.meta?.fallbackUsed),
      createdAt: new Date().toISOString(),
    });
  }

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
  const githubConnectorForStream = await readGitHubConnectorState();
  const githubLoginForChat = githubConnectorForStream?.login ?? undefined;

  if (!isNexusRouterConfigured(state)) {
    return res.status(412).json({ error: "Complete Nexus Router setup before starting chats." });
  }

  if (isStartupStrictModeEnabled(state)) {
    const liveHarnesses = (await resolveHarnessHealth(harnesses)).filter((entry) => entry.status === "online").length;
    const runtimeStatus = await getRuntimeStatus();
    const startup = buildStartupReadiness({
      onboardingComplete: isNexusRouterConfigured(state),
      liveHarnesses,
      totalHarnesses: harnesses.length,
      runtimeStatus,
      managedStatuses: getManagedHarnessRuntimeStatus(),
    });
    if (!startup.ready) {
      return res.status(412).json({ error: `Strict startup mode is enabled. Resolve blockers first: ${startup.blockers.join(" ")}` });
    }
  }

  if (!harness) {
    return res.status(404).json({ error: `Unknown harness: ${harnessId}` });
  }

  const fableProfile = getHarnessCapabilities(state, harnessId).fableMode.profile;

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
      githubLogin: githubLoginForChat,
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

    if (!controller.signal.aborted && fableProfile !== "off") {
      await appendFableTelemetry({
        id: crypto.randomUUID(),
        harnessId,
        profile: fableProfile,
        success: true,
        fallbackUsed: Boolean(latestMeta?.fallbackUsed),
        createdAt: new Date().toISOString(),
      });
    }

    res.write("data: {\"type\":\"done\"}\n\n");
    res.end();
  } catch (error) {
    const failureMessage = String(error);
    if (fableProfile !== "off") {
      await appendFableTelemetry({
        id: crypto.randomUUID(),
        harnessId,
        profile: fableProfile,
        success: false,
        fallbackUsed: false,
        createdAt: new Date().toISOString(),
      });
    }
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