import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dashboardLogo from "./assets/DashboardLogo_Nexus.png";

type PaneSelection = {
  type: "agent" | "tool";
  id: string;
};

type Harness = {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  status: "online" | "offline";
  health: "healthy" | "degraded" | "offline";
};

type Tool = {
  id: string;
  name: string;
  status: "online" | "offline" | "setup-required";
};

type Workspace = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  lastModified: string;
  activeHarnesses: string[];
};

type RouterProvider = {
  id: string;
  name: string;
  health: "healthy" | "degraded" | "offline";
  latencyMs: number;
};

type RouterLog = {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
};

type RouterSummary = {
  configured: boolean;
  baseUrl: string;
  defaultModel: string;
  fallbackOrder: string[];
  providers: RouterProvider[];
  logs: RouterLog[];
  maskedApiKey: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type ChatMeta = {
  model: string;
  provider: string;
  fallbackUsed: boolean;
  elapsedMs: number;
  tokenUsage: {
    input: number;
    output: number;
  };
};

type HarnessChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  meta: ChatMeta | null;
  createdAt: string;
  updatedAt: string;
};

type HarnessSchedule = {
  id: string;
  harnessId: string;
  workspaceId: string;
  title: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

type HarnessRunRecord = {
  id: string;
  harnessId: string;
  workspaceId: string;
  scheduleId?: string;
  trigger: "manual" | "scheduled";
  prompt: string;
  status: "completed" | "failed";
  output?: string;
  error?: string;
  model?: string;
  provider?: string;
  createdAt: string;
};

type HarnessSubTab = "chats" | "scheduled" | "runs";

type FailedTask = {
  requestId: string;
  harnessId: string;
  workspaceId: string;
  message: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "failed" | "completed" | "aborted";
  partialOutput: string;
  error?: string;
};

type StreamEnvelope =
  | { type: "meta"; meta: ChatMeta }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

type StartupReadiness = {
  ready: boolean;
  blockers: string[];
  onboardingComplete: boolean;
  liveHarnesses: number;
  totalHarnesses: number;
  checkedAt: string;
};

type BootstrapPayload = {
  appName: string;
  onboardingRequired: boolean;
  selectedPane: PaneSelection;
  activeWorkspaceId: string;
  harnesses: Harness[];
  startup: StartupReadiness;
  tools: Tool[];
  router9: RouterSummary;
  workspaces: Workspace[];
};

type WorkspaceTreeNode = {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: WorkspaceTreeNode[];
};

type WorkspaceFolderEntry = {
  name: string;
  path: string;
};

type CookbookRecommendation = {
  id: string;
  name: string;
  category: "coding" | "chat" | "voice";
  size: "small" | "medium" | "large";
  runtime: "ollama" | "llama.cpp" | "piper";
  summary: string;
  fitReason: string;
  installHint: string;
};

type CookbookSnapshot = {
  workspace: { id: string; path: string } | null;
  machine: {
    platform: string;
    arch: string;
    cpuModel: string;
    logicalCores: number;
    totalRamGb: number;
    freeRamGb: number;
    freeDiskGb: number | null;
    gpuNames: string[];
  };
  runtimes: {
    ollamaInstalled: boolean;
    piperInstalled: boolean;
  };
  installedModels: string[];
  recommendations: CookbookRecommendation[];
  scannedAt: string;
};

const RECOMMENDED_OLLAMA_MODELS: Record<string, string> = {
  "coding-qwen3-coder-30b": "qwen2.5-coder:32b",
  "coding-qwen2-5-coder-7b": "qwen2.5-coder:7b",
  "chat-llama3-2-3b": "llama3.2:3b",
};

type VoiceStatus = {
  piperInstalled: boolean;
  piperPath: string | null;
  browserSpeechRecommended: boolean;
  notes: string[];
  scannedAt: string;
};

type VoiceAssignmentsPayload = {
  voices: string[];
  harnesses: Array<{ id: string; name: string }>;
  assignments: Record<string, string>;
};

type RuntimeStatus = {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaModels: string[];
  acejamInstalled: boolean;
  acejamRunning: boolean;
  acejamUrl: string;
  piperInstalled: boolean;
  piperPath: string | null;
  piperVoices: string[];
  defaultVoiceInstalled: boolean;
};

type StableAudioStatus = {
  installed: boolean;
  running: boolean;
  ready: boolean;
  readyUrl: string | null;
  state: string;
  appId: string;
  ref: string | null;
  supportsMedium: boolean;
  modes: Array<{
    id: "small-music" | "small-sfx" | "medium";
    label: string;
    description: string;
    recommendedPrompt: string;
    available: boolean;
  }>;
};

type StableAudioGeneratedClip = {
  mode: "small-music" | "small-sfx" | "medium";
  duration: number;
  prompt: string;
  relativePath: string;
  playbackUrl: string;
};

type ImageGeneratedResult = {
  imageUrl: string;
  prompt: string;
  provider: string;
  model: string;
  resolvedModel?: string;
  width: number;
  height: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  negativePrompt?: string;
  createdAt: string;
  relativePath?: string;
};

type LocalImageStatus = {
  ready: boolean;
  uvInstalled: boolean;
  models: Array<{
    id: string;
    label: string;
    repoId: string;
    defaultWidth: number;
    defaultHeight: number;
    recommendedMaxSide: number;
    notes: string;
    installed: boolean;
  }>;
};

type LocalImageStreamEnvelope =
  | { type: "status"; message: string }
  | {
    type: "done";
    result: {
      imageUrl: string;
      relativePath: string;
      workspaceId: string;
      provider: string;
      model: string;
      resolvedModel: string;
      width: number;
      height: number;
      steps: number;
      guidanceScale: number;
      seed: number;
      prompt: string;
      negativePrompt: string;
    };
  }
  | { type: "error"; message: string };

type ImageSizePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

type RuntimeJob = {
  id: string;
  action: "install-ollama" | "start-ollama" | "pull-ollama-model" | "install-piper" | "install-default-piper-voice" | "install-acejam" | "start-acejam";
  model?: string;
  status: "queued" | "running" | "canceling" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
  retryOfId?: string;
};

type ThemePreset = {
  id: string;
  name: string;
  hint: string;
};

type GitStatusPayload = {
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  counts: {
    staged: number;
    unstaged: number;
    untracked: number;
    total: number;
  };
  entries: Array<{ x: string; y: string; path: string }>;
  remotes: string[];
  rootDir: string;
};

type GitHubConnectorStatus = {
  connected: boolean;
  login: string | null;
  maskedToken: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
};

type GitHubDeviceFlow = {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
  expiresAt: number;
  scopes: string[];
};

type SettingsTab = "connectors" | "appearance" | "automation";

type ConnectorCard = {
  id: "github" | "gmail" | "slack" | "discord" | "notion" | "dropbox";
  name: string;
  connected: boolean;
  kind: "oauth" | "token" | "placeholder";
};

// ── Nexus Router types ──────────────────────────────────────────────────────
type NxProvider = {
  id: string;
  name: string;
  type: "openai-compatible" | "openrouter";
  baseUrl: string;
  enabled: boolean;
  defaultModel?: string;
  models?: string[];
  lastSyncedAt?: string;
  maskedApiKey: string;
};

type NxProviderView = {
  id: string;
  name: string;
  enabled: boolean;
  models: string[];
  baseUrl?: string;
  lastSyncedAt?: string;
  maskedApiKey: string;
  isLocal?: boolean;
};

type NxFallbackTarget = { providerId: string; model: string };

type NxRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  retryOnStatus: number[];
};

type NxRouterConfig = {
  fallbackChain: NxFallbackTarget[];
  harnessAssignments: Record<string, NxFallbackTarget[]>;
  retryPolicy: NxRetryPolicy;
  logs: Array<{ timestamp: string; level: string; message: string }>;
};

type NxFallbackRow = {
  id: string;
  providerId: string;
  model: string;
};

const PRESET_PROVIDERS: Array<{ id: string; name: string; type: NxProvider["type"]; baseUrl: string; defaultModel: string }> = [
  { id: "openrouter", name: "OpenRouter", type: "openrouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1-mini" },
  { id: "openai", name: "OpenAI", type: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
  { id: "iflow", name: "iFlow AI (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "iflow/default" },
  { id: "qwencode", name: "Qwen Code (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "qwencode/default" },
  { id: "gemini-cli", name: "Gemini CLI (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "gemini-cli/default" },
  { id: "kiro-ai", name: "Kiro AI (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "kiro-ai/default" },
  { id: "anthropic-compat", name: "Anthropic (via OpenRouter)", type: "openrouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-sonnet-4-5" },
  { id: "together", name: "Together AI", type: "openai-compatible", baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3-8b-chat-hf" },
  { id: "groq", name: "Groq", type: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama3-8b-8192" },
  { id: "custom", name: "Custom / Local", type: "openai-compatible", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3" },
];

const PROVIDER_API_KEY_LINKS: Record<string, string> = {
  openrouter: "https://openrouter.ai/keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  together: "https://api.together.xyz/settings/api-keys",
  groq: "https://console.groq.com/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  xai: "https://console.x.ai/team/api-keys",
  fireworks: "https://fireworks.ai/account/api-keys",
  google: "https://aistudio.google.com/app/apikey",
};

const THEME_PRESETS: ThemePreset[] = [
  { id: "ember", name: "Ember Ops", hint: "default warm cyber theme" },
  { id: "ocean", name: "Ocean Grid", hint: "cool steel + cyan accents" },
  { id: "forest", name: "Forest Signal", hint: "green tactical terminal tone" },
  { id: "sunset", name: "Sunset Neon", hint: "gold + coral high contrast" },
];

const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
  { id: "square", label: "Square 512", width: 512, height: 512 },
  { id: "portrait", label: "Portrait 512x768", width: 512, height: 768 },
  { id: "landscape", label: "Landscape 768x512", width: 768, height: 512 },
  { id: "thumbnail", label: "Thumbnail 640x384", width: 640, height: 384 },
];

function App() {
  const [themeId, setThemeId] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "ember";
    }
    return window.localStorage.getItem("nexus-theme") || "ember";
  });
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [selectedPane, setSelectedPane] = useState<PaneSelection>({ type: "tool", id: "nexus-router" });
  const [composer, setComposer] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [chatThreadsByHarness, setChatThreadsByHarness] = useState<Record<string, HarnessChatThread[]>>({});
  const [activeThreadByHarness, setActiveThreadByHarness] = useState<Record<string, string>>({});
  const [harnessSubTabByHarness, setHarnessSubTabByHarness] = useState<Record<string, HarnessSubTab>>({});
  const [harnessSchedulesByHarness, setHarnessSchedulesByHarness] = useState<Record<string, HarnessSchedule[]>>({});
  const [harnessRunsByHarness, setHarnessRunsByHarness] = useState<Record<string, HarnessRunRecord[]>>({});
  const [scheduleDraftByHarness, setScheduleDraftByHarness] = useState<Record<string, { title: string; prompt: string; intervalMinutes: number }>>({});
  const [scheduleBusyHarnessId, setScheduleBusyHarnessId] = useState<string | null>(null);
  const [manualRunBusyHarnessId, setManualRunBusyHarnessId] = useState<string | null>(null);
  const [editingScheduleIdByHarness, setEditingScheduleIdByHarness] = useState<Record<string, string | null>>({});
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [failedTasks, setFailedTasks] = useState<FailedTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [workspacePathDraft, setWorkspacePathDraft] = useState<string>("");
  const [workspaceBrowserOpen, setWorkspaceBrowserOpen] = useState(false);
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([]);
  const [workspaceBrowsePath, setWorkspaceBrowsePath] = useState<string>("");
  const [workspaceBrowseParentPath, setWorkspaceBrowseParentPath] = useState<string | null>(null);
  const [workspaceBrowseFolders, setWorkspaceBrowseFolders] = useState<WorkspaceFolderEntry[]>([]);
  const [workspaceBrowseBusy, setWorkspaceBrowseBusy] = useState(false);
  const [cookbookSnapshot, setCookbookSnapshot] = useState<CookbookSnapshot | null>(null);
  const [cookbookBusy, setCookbookBusy] = useState(false);
  const [cookbookTab, setCookbookTab] = useState<"overview" | "jobs">("overview");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceText, setVoiceText] = useState("Nexus OS voice check. This is your text to speech tool.");
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voicePreviewVoiceId, setVoicePreviewVoiceId] = useState<string>("");
  const [voiceAvailableVoices, setVoiceAvailableVoices] = useState<string[]>([]);
  const [voiceAssignments, setVoiceAssignments] = useState<Record<string, string>>({});
  const [voiceAssignmentsBusy, setVoiceAssignmentsBusy] = useState(false);
  const [voiceSaveBusy, setVoiceSaveBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeBusyAction, setRuntimeBusyAction] = useState<string | null>(null);
  const [runtimeJobs, setRuntimeJobs] = useState<RuntimeJob[]>([]);
  const [expandedRuntimeJobIds, setExpandedRuntimeJobIds] = useState<Record<string, boolean>>({});
  const [stableAudioStatus, setStableAudioStatus] = useState<StableAudioStatus | null>(null);
  const [stableAudioBusyAction, setStableAudioBusyAction] = useState<"refresh" | "generate" | null>(null);
  const [stableAudioMode, setStableAudioMode] = useState<"small-music" | "small-sfx" | "medium">("small-music");
  const [stableAudioPrompt, setStableAudioPrompt] = useState("lo-fi hip hop beat, 90 BPM");
  const [stableAudioDuration, setStableAudioDuration] = useState(30);
  const [stableAudioGenerated, setStableAudioGenerated] = useState<StableAudioGeneratedClip[]>([]);
  const [imagePrompt, setImagePrompt] = useState("pixel-art hero sprite sheet, transparent background, game-ready");
  const [imageNegativePrompt, setImageNegativePrompt] = useState("blurry, low quality, watermark, text");
  const [imageModel, setImageModel] = useState<"sd15" | "dreamshaper-8">("sd15");
  const [imageWidth, setImageWidth] = useState(512);
  const [imageHeight, setImageHeight] = useState(512);
  const [imageSteps, setImageSteps] = useState(18);
  const [imageGuidanceScale, setImageGuidanceScale] = useState(6.5);
  const [imageSeed, setImageSeed] = useState(-1);
  const [imageBusyAction, setImageBusyAction] = useState<"generate" | "save" | null>(null);
  const [imageResult, setImageResult] = useState<ImageGeneratedResult | null>(null);
  const [recentImages, setRecentImages] = useState<ImageGeneratedResult[]>([]);
  const [imageStatusTrace, setImageStatusTrace] = useState("");
  const [localImageStatus, setLocalImageStatus] = useState<LocalImageStatus | null>(null);
  const imageGenerationAbortRef = useRef<AbortController | null>(null);
  const [statusMessage, setStatusMessage] = useState("Booting NEXUS OS...");
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone: "ok" | "warn" | "err" }>>([]);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [gitStatus, setGitStatus] = useState<GitStatusPayload | null>(null);
  const [gitBusyAction, setGitBusyAction] = useState<"refresh" | "commit" | "push" | null>(null);
  const [gitCommitMessage, setGitCommitMessage] = useState("Update NexusOS workspace changes");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("connectors");
  const [activeConnectorId, setActiveConnectorId] = useState<ConnectorCard["id"] | null>(null);
  const [githubConnector, setGithubConnector] = useState<GitHubConnectorStatus | null>(null);
  const [githubClientId, setGithubClientId] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem("nexus-github-client-id") ?? "";
  });
  const [githubTokenDraft, setGithubTokenDraft] = useState("");
  const [githubDeviceFlow, setGithubDeviceFlow] = useState<GitHubDeviceFlow | null>(null);
  const [githubBusy, setGithubBusy] = useState<"connect" | "disconnect" | "refresh" | "device-start" | "device-poll" | null>(null);
  const [githubInlineError, setGithubInlineError] = useState<string | null>(null);
  const [nxConfigSaving, setNxConfigSaving] = useState(false);
  const [startupChecking, setStartupChecking] = useState(false);
  const [lastStartupCheck, setLastStartupCheck] = useState<{ readiness: StartupReadiness; timestamp: string } | null>(null);
  const [rightTab, setRightTab] = useState<"workspace" | "diagnostics">("workspace");
  const [streamTrace, setStreamTrace] = useState("");
  const [streamTraceOpen, setStreamTraceOpen] = useState(false);
  const [autoSpeakHarnessReplies, setAutoSpeakHarnessReplies] = useState(true);
  const [harnessSpeaking, setHarnessSpeaking] = useState(false);
  const harnessSpeechAudioRef = useRef<HTMLAudioElement | null>(null);
  const harnessSpeechUrlRef = useRef<string | null>(null);
  
  async function loadCookbookSnapshot() {
    setCookbookBusy(true);
    const response = await fetch("/api/tools/cookbook/scan");
    if (!response.ok) {
      setCookbookBusy(false);
      setStatusMessage("Failed to scan machine for cookbook recommendations");
      return;
    }
    const payload = (await response.json()) as CookbookSnapshot;
    setCookbookSnapshot(payload);
    await loadRuntimeStatus();
    setCookbookBusy(false);
  }

  async function loadRuntimeStatus() {
    const response = await fetch("/api/tools/runtimes/status");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as RuntimeStatus;
    setRuntimeStatus(payload);
  }

  async function loadRuntimeJobs() {
    const response = await fetch("/api/tools/runtimes/jobs");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { jobs: RuntimeJob[] };
    setRuntimeJobs(payload.jobs ?? []);
  }
  
  async function loadVoiceStatus() {
    setVoiceBusy(true);
    const response = await fetch("/api/tools/voice/status");
    if (!response.ok) {
      setVoiceBusy(false);
      setStatusMessage("Failed to load voice tool status");
      return;
    }
    const payload = (await response.json()) as VoiceStatus;
    setVoiceStatus(payload);
    await loadVoiceAssignments();
    await loadRuntimeStatus();
    setVoiceBusy(false);
  }

  async function loadVoiceAssignments() {
    const response = await fetch("/api/tools/voice/assignments");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as VoiceAssignmentsPayload;
    setVoiceAvailableVoices(payload.voices ?? []);
    setVoiceAssignments(payload.assignments ?? {});
    if (!voicePreviewVoiceId && (payload.voices?.length ?? 0) > 0) {
      setVoicePreviewVoiceId(payload.voices[0]);
    }
  }

  function stopHarnessSpeech() {
    const activeAudio = harnessSpeechAudioRef.current;
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      harnessSpeechAudioRef.current = null;
    }
    if (harnessSpeechUrlRef.current) {
      URL.revokeObjectURL(harnessSpeechUrlRef.current);
      harnessSpeechUrlRef.current = null;
    }
    setHarnessSpeaking(false);
  }

  async function playAudioPayload(payload: { audioBase64: string; mimeType: string }, trackAsHarnessSpeech = false) {
    const byteChars = atob(payload.audioBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let index = 0; index < byteChars.length; index += 1) {
      bytes[index] = byteChars.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: payload.mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    if (trackAsHarnessSpeech) {
      stopHarnessSpeech();
      harnessSpeechAudioRef.current = audio;
      harnessSpeechUrlRef.current = url;
      setHarnessSpeaking(true);
    }

    await new Promise<void>((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (trackAsHarnessSpeech) {
          harnessSpeechAudioRef.current = null;
          harnessSpeechUrlRef.current = null;
          setHarnessSpeaking(false);
        }
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (trackAsHarnessSpeech) {
          harnessSpeechAudioRef.current = null;
          harnessSpeechUrlRef.current = null;
          setHarnessSpeaking(false);
        }
        resolve();
      };
      void audio.play().catch(() => {
        URL.revokeObjectURL(url);
        if (trackAsHarnessSpeech) {
          harnessSpeechAudioRef.current = null;
          harnessSpeechUrlRef.current = null;
          setHarnessSpeaking(false);
        }
        resolve();
      });
    });
  }

  async function speakHarnessReplyIfAssigned(harnessId: string, text: string) {
    if (!autoSpeakHarnessReplies) {
      return;
    }

    const voiceId = voiceAssignments[harnessId];
    if (!voiceId || !text.trim()) {
      return;
    }

    const response = await fetch("/api/tools/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), voiceId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Assigned harness voice playback failed.");
      return;
    }

    const payload = (await response.json()) as { audioBase64: string; mimeType: string };
    await playAudioPayload(payload, true);
  }

  async function saveVoiceAssignments(next: Record<string, string>) {
    setVoiceAssignmentsBusy(true);
    const response = await fetch("/api/tools/voice/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments: next }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to save voice assignments.");
      setVoiceAssignmentsBusy(false);
      return;
    }

    setVoiceAssignments(next);
    setVoiceAssignmentsBusy(false);
    setStatusMessage("Harness voice assignments saved.");
  }

  async function waitForRuntimeJobCompletion(jobId: string, successMessage: string) {
    while (true) {
      const poll = await fetch(`/api/tools/runtimes/jobs/${encodeURIComponent(jobId)}`);
      if (!poll.ok) {
        setStatusMessage("Runtime job disappeared before completion.");
        setRuntimeBusyAction(null);
        return;
      }

      const pollPayload = (await poll.json()) as { job: RuntimeJob };
      const job = pollPayload.job;
      await loadRuntimeJobs();

      if (job.status === "completed") {
        await Promise.all([loadRuntimeStatus(), loadCookbookSnapshot(), loadVoiceStatus(), loadRuntimeJobs()]);
        setStatusMessage(successMessage);
        setRuntimeBusyAction(null);
        return;
      }

      if (job.status === "failed") {
        setStatusMessage(job.error ?? "Runtime job failed");
        setRuntimeBusyAction(null);
        return;
      }

      if (job.status === "canceled") {
        setStatusMessage("Runtime job canceled.");
        setRuntimeBusyAction(null);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function runRuntimeJob(actionId: string, action: RuntimeJob["action"], successMessage: string, model?: string) {
    setRuntimeBusyAction(actionId);
    const response = await fetch("/api/tools/runtimes/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, model }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Runtime job failed to start");
      setRuntimeBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { job: RuntimeJob };
    const jobId = payload.job.id;
    setStatusMessage(`${action} queued...`);
    await loadRuntimeJobs();
    await waitForRuntimeJobCompletion(jobId, successMessage);
  }

  async function cancelRuntimeJob(job: RuntimeJob) {
    const response = await fetch(`/api/tools/runtimes/jobs/${encodeURIComponent(job.id)}/cancel`, {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Could not cancel runtime job.");
      return;
    }

    setStatusMessage(`Cancellation requested for ${job.action}.`);
    await loadRuntimeJobs();
  }

  async function retryRuntimeJob(job: RuntimeJob) {
    const response = await fetch(`/api/tools/runtimes/jobs/${encodeURIComponent(job.id)}/retry`, {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Could not retry runtime job.");
      return;
    }

    setStatusMessage(`Retry queued for ${job.action}.`);
    await loadRuntimeJobs();
  }

  function toggleRuntimeJobExpanded(jobId: string) {
    setExpandedRuntimeJobIds((current) => ({ ...current, [jobId]: !current[jobId] }));
  }
  
  function stopVoicePlayback() {
    window.speechSynthesis.cancel();
    setVoicePlaying(false);
  }
  
  function playVoicePreview() {
    const text = voiceText.trim();
    if (!text) {
      return;
    }

    void (async () => {
      if (runtimeStatus?.piperInstalled && runtimeStatus.defaultVoiceInstalled) {
        setVoicePlaying(true);
        const response = await fetch("/api/tools/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceId: voicePreviewVoiceId || undefined }),
        });

        if (response.ok) {
          const payload = (await response.json()) as { audioBase64: string; mimeType: string };
          await playAudioPayload(payload);
          setVoicePlaying(false);
          return;
        }

        const payload = (await response.json()) as { error?: string };
        setStatusMessage(payload.error ?? "Piper playback failed.");
        setVoicePlaying(false);
        return;
      }

      stopVoicePlayback();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setVoicePlaying(false);
      utterance.onerror = () => setVoicePlaying(false);
      setVoicePlaying(true);
      window.speechSynthesis.speak(utterance);
    })();
  }

  async function saveVoiceGeneration() {
    const text = voiceText.trim();
    if (!text) {
      return;
    }

    setVoiceSaveBusy(true);
    const response = await fetch("/api/tools/voice/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId: voicePreviewVoiceId || undefined, workspaceId: boot?.activeWorkspaceId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Voice save failed.");
      setVoiceSaveBusy(false);
      return;
    }

    const payload = (await response.json()) as { relativePath: string };
    setStatusMessage(`Saved voice to ${payload.relativePath}`);
    setVoiceSaveBusy(false);
  }

  async function loadStableAudioStatus() {
    setStableAudioBusyAction("refresh");
    const response = await fetch("/api/tools/music/stable-audio/status");
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to load Stable Audio status.");
      pushToast(payload.error ?? "Failed to load Stable Audio status.", "err");
      setStableAudioBusyAction(null);
      return;
    }
    const payload = (await response.json()) as StableAudioStatus;
    setStableAudioStatus(payload);
    setStableAudioBusyAction(null);
  }

  async function generateStableAudio() {
    setStableAudioBusyAction("generate");
    const response = await fetch("/api/tools/music/stable-audio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: stableAudioMode,
        prompt: stableAudioPrompt,
        duration: stableAudioDuration,
        workspaceId: boot?.activeWorkspaceId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const message = payload.error ?? "Stable Audio generation failed.";
      setStatusMessage(message);
      pushToast(message, "err");
      setStableAudioBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { mode: "small-music" | "small-sfx" | "medium"; duration: number; prompt: string; relativePath: string; playbackUrl: string; workspaceId: string };
    setStableAudioGenerated((current) => [
      {
        mode: payload.mode,
        duration: payload.duration,
        prompt: payload.prompt,
        relativePath: payload.relativePath,
        playbackUrl: payload.playbackUrl,
      },
      ...current,
    ].slice(0, 8));
    setStatusMessage(`Saved generated audio to ${payload.relativePath}`);
    pushToast(`Generated ${payload.mode} clip saved to Assets.`, "ok");
    setStableAudioBusyAction(null);
    await refreshActiveWorkspaceTree(payload.workspaceId);
    await loadStableAudioStatus();
  }

  async function generateImage() {
    if (imageGenerationAbortRef.current) {
      imageGenerationAbortRef.current.abort();
    }
    const controller = new AbortController();
    imageGenerationAbortRef.current = controller;
    setImageBusyAction("generate");
    setImageStatusTrace("Starting local generation...\n");
    const seedToUse = imageSeed < 0 ? Math.floor(Math.random() * 2147483647) : imageSeed;
    const params = new URLSearchParams({
      prompt: imagePrompt,
      model: imageModel,
      negativePrompt: imageNegativePrompt,
      width: String(imageWidth),
      height: String(imageHeight),
      steps: String(imageSteps),
      guidanceScale: String(imageGuidanceScale),
      seed: String(seedToUse),
      workspaceId: boot?.activeWorkspaceId ?? "default",
    });

    try {
      const response = await fetch(`/api/tools/image/local/stream?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as { error?: string };
        const message = payload.error ?? "Local image generation failed.";
        setStatusMessage(message);
        pushToast(message, "err");
        setImageBusyAction(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const split = buffer.indexOf("\n\n");
          if (split === -1) {
            break;
          }
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) {
            continue;
          }
          const raw = dataLine.slice(5).trim();
          let envelope: LocalImageStreamEnvelope;
          try {
            envelope = JSON.parse(raw) as LocalImageStreamEnvelope;
          } catch {
            continue;
          }

          if (envelope.type === "status") {
            setImageStatusTrace((current) => `${current}${envelope.message}\n`.slice(-12000));
            continue;
          }

          if (envelope.type === "error") {
            setImageStatusTrace((current) => `${current}[error] ${envelope.message}\n`.slice(-12000));
            setStatusMessage(envelope.message);
            pushToast(envelope.message, "err");
            continue;
          }

          if (envelope.type === "done") {
            const generated: ImageGeneratedResult = {
              imageUrl: envelope.result.imageUrl,
              prompt: envelope.result.prompt,
              provider: envelope.result.provider,
              model: envelope.result.model,
              resolvedModel: envelope.result.resolvedModel,
              width: envelope.result.width,
              height: envelope.result.height,
              steps: envelope.result.steps,
              guidanceScale: envelope.result.guidanceScale,
              seed: envelope.result.seed,
              negativePrompt: envelope.result.negativePrompt,
              relativePath: envelope.result.relativePath,
              createdAt: new Date().toISOString(),
            };
            setImageResult(generated);
            setRecentImages((current) => [generated, ...current].slice(0, 10));
            setStatusMessage(`Local image generated (${envelope.result.model}).`);
            pushToast("Local image generated and saved.", "ok");
            completed = true;
            await refreshActiveWorkspaceTree(envelope.result.workspaceId);
            void loadLocalImageStatus();
          }
        }
      }

      if (!completed && !controller.signal.aborted) {
        setStatusMessage("Local generation stream ended before completion.");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setImageStatusTrace((current) => `${current}Generation canceled by user.\n`.slice(-12000));
        setStatusMessage("Local generation stopped.");
        pushToast("Image generation canceled.", "warn");
      } else {
        const message = String(error);
        setImageStatusTrace((current) => `${current}[error] ${message}\n`.slice(-12000));
        setStatusMessage(message);
        pushToast(message, "err");
      }
    } finally {
      if (imageGenerationAbortRef.current === controller) {
        imageGenerationAbortRef.current = null;
      }
      setImageBusyAction(null);
    }
  }

  function stopImageGeneration() {
    imageGenerationAbortRef.current?.abort();
  }

  async function saveGeneratedImage(target?: ImageGeneratedResult) {
    const imageToSave = target ?? imageResult;
    if (!imageToSave?.imageUrl) {
      return;
    }
    setImageBusyAction("save");
    const response = await fetch("/api/tools/image/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: imageToSave.imageUrl,
        prompt: imageToSave.prompt,
        workspaceId: boot?.activeWorkspaceId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const message = payload.error ?? "Image save failed.";
      setStatusMessage(message);
      pushToast(message, "err");
      setImageBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { relativePath: string; workspaceId: string };
    setImageResult((current) => {
      if (!current || current.imageUrl !== imageToSave.imageUrl) {
        return current;
      }
      return { ...current, relativePath: payload.relativePath };
    });
    setRecentImages((current) => current.map((item) => (
      item.imageUrl === imageToSave.imageUrl
        ? { ...item, relativePath: payload.relativePath }
        : item
    )));
    setStatusMessage(`Saved generated image to ${payload.relativePath}`);
    pushToast("Image saved to Assets/images.", "ok");
    await refreshActiveWorkspaceTree(payload.workspaceId);
    setImageBusyAction(null);
  }

  function applyImageSizePreset(preset: ImageSizePreset) {
    setImageWidth(preset.width);
    setImageHeight(preset.height);
    setStatusMessage(`Applied ${preset.label} preset.`);
  }

  function openRecentImage(image: ImageGeneratedResult) {
    setImagePrompt(image.prompt);
    setImageNegativePrompt(image.negativePrompt ?? "");
    setImageModel(image.model === "dreamshaper-8" ? "dreamshaper-8" : "sd15");
    setImageWidth(image.width);
    setImageHeight(image.height);
    setImageSteps(image.steps ?? 18);
    setImageGuidanceScale(image.guidanceScale ?? 6.5);
    setImageSeed(image.seed ?? -1);
    setImageResult(image);
    setStatusMessage("Loaded recent image into preview.");
  }

  async function loadLocalImageStatus() {
    const response = await fetch("/api/tools/image/local/status");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as LocalImageStatus;
    setLocalImageStatus(payload);
  }

  async function openActiveWorkspaceFolder() {
    const workspaceId = boot?.activeWorkspaceId ?? "default";
    const response = await fetch("/api/workspaces/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const message = payload.error ?? "Failed to open workspace folder.";
      setStatusMessage(message);
      pushToast(message, "err");
      return;
    }

    setStatusMessage("Opened workspace folder in file explorer.");
  }

  // Nexus Router state
  const [nxProviders, setNxProviders] = useState<NxProvider[]>([]);
  const [nxProviderForm, setNxProviderForm] = useState({ preset: "openrouter", id: "openrouter", name: "OpenRouter", type: "openrouter" as NxProvider["type"], baseUrl: "https://openrouter.ai/api/v1", apiKey: "", defaultModel: "openai/gpt-4.1-mini", enabled: true });
  const [nxSaving, setNxSaving] = useState(false);
  const [nxSyncingId, setNxSyncingId] = useState<string | null>(null);
  const [nxFallbackRows, setNxFallbackRows] = useState<NxFallbackRow[]>([]);
  const [nxModelOptionsByProvider, setNxModelOptionsByProvider] = useState<Record<string, string[]>>({});
  const [nxHarnessAssignments, setNxHarnessAssignments] = useState<Record<string, string[]>>({});
  const [nxRetryEditor, setNxRetryEditor] = useState<NxRetryPolicy>({ maxAttempts: 3, backoffMs: 400, retryOnStatus: [429, 500, 502, 503, 504] });
  const [nxTestPrompt, setNxTestPrompt] = useState("Say hello briefly.");
  const [nxTestResult, setNxTestResult] = useState<{ content: string; model: string; providerId: string; elapsedMs: number; attempts: Array<{ providerId: string; model: string; status: string; details: string }> } | null>(null);
  const [nxTestBusy, setNxTestBusy] = useState(false);
  const [nxConsoleLogs, setNxConsoleLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);
  const nxAutoSyncStarted = useRef(false);

  const activeHarness = useMemo(
    () => boot?.harnesses.find((harness) => harness.id === selectedPane.id) ?? null,
    [boot, selectedPane.id],
  );

  function createThread(title = "New chat"): HarnessChatThread {
    const nowIso = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title,
      messages: [],
      meta: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  function upsertThread(
    harnessId: string,
    threadId: string,
    updater: (thread: HarnessChatThread) => HarnessChatThread,
  ) {
    setChatThreadsByHarness((current) => {
      const threads = current[harnessId] ?? [];
      return {
        ...current,
        [harnessId]: threads.map((thread) => (thread.id === threadId ? updater(thread) : thread)),
      };
    });
  }

  function ensureHarnessThread(harnessId: string): string {
    const existing = chatThreadsByHarness[harnessId] ?? [];
    const activeId = activeThreadByHarness[harnessId];
    if (existing.length > 0) {
      const resolved = activeId && existing.some((thread) => thread.id === activeId) ? activeId : existing[0].id;
      if (!activeId || activeId !== resolved) {
        setActiveThreadByHarness((current) => ({ ...current, [harnessId]: resolved }));
      }
      return resolved;
    }

    const thread = createThread();
    setChatThreadsByHarness((current) => ({ ...current, [harnessId]: [thread] }));
    setActiveThreadByHarness((current) => ({ ...current, [harnessId]: thread.id }));
    void saveHarnessThread(harnessId, thread);
    return thread.id;
  }

  const activeThread = useMemo(() => {
    if (selectedPane.type !== "agent") {
      return null;
    }
    const harnessId = selectedPane.id;
    const threads = chatThreadsByHarness[harnessId] ?? [];
    if (threads.length === 0) {
      return null;
    }
    const activeId = activeThreadByHarness[harnessId] ?? threads[0].id;
    return threads.find((thread) => thread.id === activeId) ?? threads[0];
  }, [selectedPane, chatThreadsByHarness, activeThreadByHarness]);

  const messages = activeThread?.messages ?? [];
  const chatMeta = activeThread?.meta ?? null;
  const lastAssistantMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages],
  );

  const harnessDisplayModel = useMemo(() => {
    const modelByHarness: Record<string, string> = {};
    for (const [harnessId, threads] of Object.entries(chatThreadsByHarness)) {
      const newest = [...threads]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .find((thread) => Boolean(thread.meta?.model));
      if (newest?.meta?.model) {
        modelByHarness[harnessId] = newest.meta.model;
      }
    }
    return modelByHarness;
  }, [chatThreadsByHarness]);

  async function loadHarnessThreads(harnessId: string, workspaceId?: string) {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/chats?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { threads: HarnessChatThread[] };
    const threads = (payload.threads ?? []).map((thread) => ({
      ...thread,
      createdAt: thread.createdAt ?? thread.updatedAt ?? new Date().toISOString(),
    }));
    setChatThreadsByHarness((current) => ({ ...current, [harnessId]: threads }));
    if (threads.length > 0) {
      setActiveThreadByHarness((current) => ({
        ...current,
        [harnessId]: current[harnessId] && threads.some((thread) => thread.id === current[harnessId])
          ? current[harnessId]
          : threads[0].id,
      }));
      return;
    }

    const thread = createThread();
    await saveHarnessThread(harnessId, thread, activeWorkspaceId);
    setChatThreadsByHarness((current) => ({ ...current, [harnessId]: [thread] }));
    setActiveThreadByHarness((current) => ({ ...current, [harnessId]: thread.id }));
  }

  async function saveHarnessThread(harnessId: string, thread: HarnessChatThread, workspaceId?: string): Promise<void> {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/chats/${encodeURIComponent(thread.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        title: thread.title,
        messages: thread.messages,
        meta: thread.meta,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      }),
    });
  }

  const fallbackChoiceOptions = useMemo(
    () => nxFallbackRows
      .filter((row) => row.providerId && row.model)
      .map((row) => `${row.providerId}::${row.model}`),
    [nxFallbackRows],
  );

  const fallbackChoiceSet = useMemo(() => new Set(fallbackChoiceOptions), [fallbackChoiceOptions]);

  const cookbookModelOptions = useMemo(() => cookbookSnapshot?.installedModels ?? [], [cookbookSnapshot]);

  const cookbookProviderView = useMemo<NxProviderView | null>(() => {
    if (!cookbookSnapshot && !runtimeStatus) {
      return null;
    }

    return {
      id: "cookbook",
      name: "Cookbook",
      enabled: cookbookModelOptions.length > 0,
      models: cookbookModelOptions,
      lastSyncedAt: cookbookSnapshot?.scannedAt,
      maskedApiKey: "",
      isLocal: true,
    };
  }, [cookbookSnapshot, runtimeStatus, cookbookModelOptions]);

  const nxProviderViews = useMemo<NxProviderView[]>(() => {
    const remoteProviders = nxProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      models: nxModelOptionsByProvider[provider.id] ?? provider.models ?? [],
      baseUrl: provider.baseUrl,
      lastSyncedAt: provider.lastSyncedAt,
      maskedApiKey: provider.maskedApiKey,
    }));

    return cookbookProviderView ? [cookbookProviderView, ...remoteProviders] : remoteProviders;
  }, [cookbookProviderView, nxProviders, nxModelOptionsByProvider]);

  function createFallbackRow(target?: NxFallbackTarget): NxFallbackRow {
    return {
      id: crypto.randomUUID(),
      providerId: target?.providerId ?? "",
      model: target?.model ?? "",
    };
  }

  function fallbackKey(target: NxFallbackTarget): string {
    return `${target.providerId}::${target.model}`;
  }

  function moveFallbackRow(rowId: string, direction: -1 | 1) {
    setNxFallbackRows((rows) => {
      const index = rows.findIndex((entry) => entry.id === rowId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) {
        return rows;
      }

      const next = [...rows];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function getProviderApiKeyUrl(provider: { id: string; name: string; baseUrl?: string }): string | null {
    const id = provider.id.toLowerCase();
    if (PROVIDER_API_KEY_LINKS[id]) {
      return PROVIDER_API_KEY_LINKS[id];
    }

    const providerName = provider.name.toLowerCase();
    if (providerName.includes("deepseek")) {
      return PROVIDER_API_KEY_LINKS.deepseek;
    }
    if (providerName.includes("anthropic") || providerName.includes("claude")) {
      return PROVIDER_API_KEY_LINKS.anthropic;
    }

    if (!provider.baseUrl) {
      return null;
    }

    try {
      const host = new URL(provider.baseUrl).hostname.toLowerCase();
      if (host.includes("openrouter.ai")) return PROVIDER_API_KEY_LINKS.openrouter;
      if (host.includes("openai.com")) return PROVIDER_API_KEY_LINKS.openai;
      if (host.includes("anthropic.com")) return PROVIDER_API_KEY_LINKS.anthropic;
      if (host.includes("deepseek.com")) return PROVIDER_API_KEY_LINKS.deepseek;
      if (host.includes("together.xyz")) return PROVIDER_API_KEY_LINKS.together;
      if (host.includes("groq.com")) return PROVIDER_API_KEY_LINKS.groq;
      if (host.includes("mistral.ai")) return PROVIDER_API_KEY_LINKS.mistral;
      if (host.includes("x.ai")) return PROVIDER_API_KEY_LINKS.xai;
      if (host.includes("fireworks.ai")) return PROVIDER_API_KEY_LINKS.fireworks;
      if (host.includes("googleapis.com") || host.includes("generativelanguage.googleapis.com")) return PROVIDER_API_KEY_LINKS.google;
    } catch {
      return null;
    }

    return null;
  }

  function parseFallbackKey(value: string): NxFallbackTarget | null {
    const [providerId, ...rest] = value.split("::");
    const model = rest.join("::").trim();
    const trimmedProvider = providerId.trim();
    if (!trimmedProvider || !model) {
      return null;
    }
    return { providerId: trimmedProvider, model };
  }

  function recommendationSymbol(recommendation: CookbookRecommendation): string {
    if (recommendation.category === "coding") return "</>";
    if (recommendation.category === "chat") return "[]";
    return "()";
  }

  function recommendationModelName(recommendation: CookbookRecommendation): string | null {
    return RECOMMENDED_OLLAMA_MODELS[recommendation.id] ?? null;
  }

  function findActiveModelPullJob(model: string): RuntimeJob | null {
    return runtimeJobs.find((job) =>
      job.action === "pull-ollama-model"
      && job.model === model
      && (job.status === "queued" || job.status === "running" || job.status === "canceling")
    ) ?? null;
  }

  async function runRecommendationAction(recommendation: CookbookRecommendation) {
    if (recommendation.runtime !== "ollama") {
      setStatusMessage("This recommendation is provisioned by core runtime setup.");
      return;
    }

    const model = recommendationModelName(recommendation);
    if (!model) {
      setStatusMessage("No install target mapped for this recommendation yet.");
      return;
    }

    const activePull = findActiveModelPullJob(model);
    if (activePull) {
      await cancelRuntimeJob(activePull);
      return;
    }

    if (runtimeStatus?.ollamaModels.includes(model)) {
      setStatusMessage(`${model} is already installed.`);
      return;
    }

    await runRuntimeJob(
      `pull-${model}`,
      "pull-ollama-model",
      `${recommendation.name} installed into Ollama.`,
      model,
    );
  }

  function getFallbackRowHealth(row: NxFallbackRow): { label: string; tone: "ok" | "warn" | "bad" | "idle" } {
    if (!row.providerId) {
      return { label: "select provider", tone: "idle" };
    }

    const provider = nxProviderViews.find((entry) => entry.id === row.providerId);
    if (!provider || !provider.enabled) {
      return { label: "provider offline", tone: "bad" };
    }

    if (!row.model) {
      return { label: "select model", tone: "idle" };
    }

    const providerModels = nxModelOptionsByProvider[row.providerId] ?? provider.models ?? [];
    if (providerModels.length === 0) {
      return { label: provider.lastSyncedAt ? "no synced models" : "syncing models", tone: "warn" };
    }

    if (!providerModels.includes(row.model)) {
      return { label: "model unavailable", tone: "bad" };
    }

    return { label: "healthy", tone: "ok" };
  }

  const loadBootstrap = useCallback(async () => {
    const response = await fetch("/api/bootstrap");
    const payload = (await response.json()) as BootstrapPayload;
    setBoot(payload);

    const preferredPane: PaneSelection = payload.onboardingRequired
      ? { type: "tool", id: "nexus-router" }
      : payload.selectedPane;
    setSelectedPane(preferredPane);
    await loadWorkspaceTree(payload.activeWorkspaceId);
    await loadFailedTasks();
    await loadLastStartupCheck();
    await loadNxRouter();
    await loadVoiceAssignments();
    setStatusMessage(payload.onboardingRequired ? "First run: Add a provider in Nexus Router to get started." : "Ready");
  }, []);

  async function loadNxRouter() {
    try {
      const [provRes, cfgRes] = await Promise.all([
        fetch("/api/router/providers"),
        fetch("/api/router/config"),
      ]);
      if (provRes.ok) {
        const data = (await provRes.json()) as { providers: NxProvider[] };
        setNxProviders(data.providers);
        const modelMap: Record<string, string[]> = {};
        for (const provider of data.providers) {
          modelMap[provider.id] = provider.models ?? [];
        }
        setNxModelOptionsByProvider(modelMap);
      }
      if (cfgRes.ok) {
        const data = (await cfgRes.json()) as NxRouterConfig;
        setNxRetryEditor(data.retryPolicy);
        setNxFallbackRows(data.fallbackChain.length > 0
          ? data.fallbackChain.map((target) => createFallbackRow(target))
          : [createFallbackRow()]);
        const assignments: Record<string, string[]> = {};
        for (const [harnessId, targets] of Object.entries(data.harnessAssignments ?? {})) {
          assignments[harnessId] = targets.map(fallbackKey);
        }
        setNxHarnessAssignments(assignments);
        setNxConsoleLogs(data.logs);
      }
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (nxAutoSyncStarted.current || nxProviders.length === 0) {
      return;
    }

    nxAutoSyncStarted.current = true;
    void Promise.all(
      nxProviders
        .filter((provider) => provider.enabled)
        .map((provider) => nxSyncModels(provider.id)),
    );
  }, [nxProviders]);

  async function nxSaveProvider(event: FormEvent) {
    event.preventDefault();
    setNxSaving(true);
    try {
      const res = await fetch("/api/router/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nxProviderForm),
      });
      if (res.ok) {
        await loadNxRouter();
        setStatusMessage(`Provider "${nxProviderForm.name}" saved.`);
      } else {
        const err = (await res.json()) as { error: string };
        setStatusMessage(err.error);
      }
    } finally {
      setNxSaving(false);
    }
  }

  async function nxSyncModels(providerId: string) {
    setNxSyncingId(providerId);
    try {
      if (providerId === "cookbook") {
        await loadCookbookSnapshot();
        setStatusMessage("Cookbook models refreshed.");
        return;
      }

      const res = await fetch(`/api/router/models?providerId=${encodeURIComponent(providerId)}`);
      if (res.ok) {
        const payload = (await res.json()) as { models?: string[] };
        if (Array.isArray(payload.models)) {
          setNxModelOptionsByProvider((current) => ({ ...current, [providerId]: payload.models ?? [] }));
        }
        await loadNxRouter();
        setStatusMessage(`Models synced for ${providerId}.`);
      } else {
        const err = (await res.json()) as { error: string };
        setStatusMessage(err.error);
      }
    } finally {
      setNxSyncingId(null);
    }
  }

  async function nxSaveConfig() {
    setNxConfigSaving(true);
    const fallbackChain = nxFallbackRows
      .map((row) => ({ providerId: row.providerId.trim(), model: row.model.trim() }))
      .filter((row) => row.providerId && row.model);

    const harnessAssignments: Record<string, NxFallbackTarget[]> = {};
    for (const [harnessId, selected] of Object.entries(nxHarnessAssignments)) {
      const parsed = selected
        .filter((entry) => fallbackChoiceSet.has(entry))
        .map(parseFallbackKey)
        .filter((entry): entry is NxFallbackTarget => Boolean(entry));
      if (parsed.length > 0) {
        harnessAssignments[harnessId] = parsed;
      }
    }

    const res = await fetch("/api/router/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fallbackChain, harnessAssignments, retryPolicy: nxRetryEditor }),
    });
    if (res.ok) {
      await loadNxRouter();
      setStatusMessage("Router config saved.");
      pushToast("Router config saved.", "ok");
    } else {
      pushToast("Failed to save router config.", "err");
    }
    setNxConfigSaving(false);
  }

  async function nxTestChat() {
    setNxTestBusy(true);
    setNxTestResult(null);
    try {
      const res = await fetch("/api/router/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: nxTestPrompt }] }),
      });
      const data = await res.json();
      if (res.ok) {
        setNxTestResult(data as typeof nxTestResult);
        setStatusMessage(`Test routed via ${(data as { providerId: string }).providerId}`);
      } else {
        setStatusMessage((data as { error: string }).error ?? "Router chat failed");
      }
    } finally {
      setNxTestBusy(false);
      await loadNxRouter();
    }
  }

  async function loadLastStartupCheck() {
    const response = await fetch("/api/startup/check/last");
    const payload = (await response.json()) as { last: { readiness: StartupReadiness; timestamp: string } | null };
    setLastStartupCheck(payload.last);
  }

  async function loadFailedTasks() {
    const response = await fetch("/api/chat/tasks/resumable");
    const payload = (await response.json()) as { tasks: FailedTask[] };
    setFailedTasks(payload.tasks);
  }

  useEffect(() => {
    // Initial app hydration intentionally seeds UI state from backend bootstrap.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeId);
    window.localStorage.setItem("nexus-theme", themeId);
  }, [themeId]);

  function pushToast(message: string, tone: "ok" | "warn" | "err" = "ok") {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 3500);
  }

  useEffect(() => {
    window.localStorage.setItem("nexus-github-client-id", githubClientId);
  }, [githubClientId]);

  useEffect(() => {
    if (selectedPane.type === "agent") {
      void loadHarnessThreads(selectedPane.id);
      void loadHarnessSchedules(selectedPane.id);
      void loadHarnessRuns(selectedPane.id);
    }
    if (selectedPane.type === "tool" && selectedPane.id === "cookbook") {
      void loadCookbookSnapshot();
      void loadRuntimeJobs();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "voice-studio") {
      void loadVoiceStatus();
      void loadRuntimeJobs();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "music-generator") {
      void loadStableAudioStatus();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "image-generator") {
      void loadLocalImageStatus();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "settings") {
      void loadGitStatus();
      void loadGitHubConnectorStatus();
    }
  }, [selectedPane, boot?.activeWorkspaceId]);

  useEffect(() => {
    const hasActive = runtimeJobs.some((job) => job.status === "queued" || job.status === "running" || job.status === "canceling");
    if (!hasActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadRuntimeJobs();
      void loadRuntimeStatus();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [runtimeJobs]);

  function getHarnessSubTab(harnessId: string): HarnessSubTab {
    return harnessSubTabByHarness[harnessId] ?? "chats";
  }

  function getScheduleDraft(harnessId: string): { title: string; prompt: string; intervalMinutes: number } {
    return scheduleDraftByHarness[harnessId] ?? {
      title: "",
      prompt: "",
      intervalMinutes: 30,
    };
  }

  function getEditingScheduleId(harnessId: string): string | null {
    return editingScheduleIdByHarness[harnessId] ?? null;
  }

  async function loadHarnessSchedules(harnessId: string, workspaceId?: string) {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { schedules: HarnessSchedule[] };
    setHarnessSchedulesByHarness((current) => ({ ...current, [harnessId]: payload.schedules ?? [] }));
  }

  async function loadHarnessRuns(harnessId: string, workspaceId?: string) {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { runs: HarnessRunRecord[] };
    setHarnessRunsByHarness((current) => ({ ...current, [harnessId]: payload.runs ?? [] }));
  }

  async function onCreateSchedule(harnessId: string) {
    const draft = getScheduleDraft(harnessId);
    const editingId = getEditingScheduleId(harnessId);
    if (!draft.prompt.trim()) {
      setStatusMessage("Schedule prompt is required.");
      return;
    }

    setScheduleBusyHarnessId(harnessId);
    const response = editingId
      ? await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: boot?.activeWorkspaceId ?? "default",
          title: draft.title,
          prompt: draft.prompt,
          intervalMinutes: draft.intervalMinutes,
        }),
      })
      : await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: boot?.activeWorkspaceId ?? "default",
          title: draft.title,
          prompt: draft.prompt,
          intervalMinutes: draft.intervalMinutes,
          enabled: true,
        }),
      });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to create schedule");
      setScheduleBusyHarnessId(null);
      return;
    }

    setScheduleDraftByHarness((current) => ({
      ...current,
      [harnessId]: { title: "", prompt: "", intervalMinutes: draft.intervalMinutes },
    }));
    setEditingScheduleIdByHarness((current) => ({ ...current, [harnessId]: null }));
    await loadHarnessSchedules(harnessId);
    setStatusMessage(editingId ? "Schedule updated." : "Schedule saved.");
    setScheduleBusyHarnessId(null);
  }

  async function onToggleSchedule(harnessId: string, scheduleId: string, enabled: boolean) {
    setScheduleBusyHarnessId(harnessId);
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: boot?.activeWorkspaceId ?? "default",
        enabled,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to update schedule");
      setScheduleBusyHarnessId(null);
      return;
    }

    await loadHarnessSchedules(harnessId);
    setStatusMessage(enabled ? "Schedule enabled." : "Schedule paused.");
    setScheduleBusyHarnessId(null);
  }

  async function onDeleteSchedule(harnessId: string, scheduleId: string) {
    setScheduleBusyHarnessId(harnessId);
    const workspaceId = boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules/${encodeURIComponent(scheduleId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to delete schedule");
      setScheduleBusyHarnessId(null);
      return;
    }

    await loadHarnessSchedules(harnessId);
    setStatusMessage("Schedule deleted.");
    setScheduleBusyHarnessId(null);
  }

  async function onManualRun(harnessId: string) {
    const draft = getScheduleDraft(harnessId);
    if (!draft.prompt.trim()) {
      setStatusMessage("Manual run prompt is required.");
      return;
    }

    setManualRunBusyHarnessId(harnessId);
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/runs/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: boot?.activeWorkspaceId ?? "default",
        prompt: draft.prompt,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Manual run failed");
      setManualRunBusyHarnessId(null);
      return;
    }

    await loadHarnessRuns(harnessId);
    setStatusMessage("Manual run completed.");
    setManualRunBusyHarnessId(null);
  }

  async function loadWorkspaceTree(workspaceId: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/tree`);
    const payload = (await response.json()) as { tree: WorkspaceTreeNode };
    setWorkspaceTree(payload.tree);
  }

  async function refreshActiveWorkspaceTree(workspaceId?: string) {
    const resolvedWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    try {
      await loadWorkspaceTree(resolvedWorkspaceId);
    } catch {
      // Keep chat flow resilient even if tree refresh fails.
    }
  }

  async function loadGitStatus() {
    setGitBusyAction("refresh");
    const response = await fetch("/api/tools/git/status");
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to load Git status.");
      setGitBusyAction(null);
      return;
    }

    const payload = (await response.json()) as GitStatusPayload;
    setGitStatus(payload);
    setGitBusyAction(null);
  }

  async function loadGitHubConnectorStatus() {
    setGithubBusy("refresh");
    const response = await fetch("/api/tools/connectors/github/status");
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to load GitHub connector status.");
      setGithubBusy(null);
      return;
    }
    const payload = (await response.json()) as GitHubConnectorStatus;
    setGithubConnector(payload);
    setGithubBusy(null);
  }

  async function startGitHubDeviceFlow() {
    const clientId = githubClientId.trim();
    if (!clientId) {
      setGithubInlineError("Enter a GitHub OAuth app client ID before connecting.");
      pushToast("GitHub OAuth client ID is required.", "warn");
      return;
    }
    setGithubInlineError(null);

    setGithubBusy("device-start");
    const response = await fetch("/api/tools/connectors/github/device/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, scopes: ["repo"] }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const errMsg = payload.error ?? "GitHub device flow could not start.";
      setStatusMessage(errMsg);
      setGithubInlineError(errMsg);
      pushToast(errMsg, "err");
      setGithubBusy(null);
      return;
    }

    const payload = (await response.json()) as {
      device: {
        device_code: string;
        user_code: string;
        verification_uri: string;
        verification_uri_complete?: string;
        interval: number;
        expires_in: number;
      };
      clientId: string;
      scopes: string[];
    };

    const expiresAt = Date.now() + (payload.device.expires_in * 1000);
    setGithubDeviceFlow({
      clientId: payload.clientId,
      deviceCode: payload.device.device_code,
      userCode: payload.device.user_code,
      verificationUri: payload.device.verification_uri,
      verificationUriComplete: payload.device.verification_uri_complete,
      interval: payload.device.interval || 5,
      expiresAt,
      scopes: payload.scopes,
    });
    setGithubInlineError(null);
    setStatusMessage(`GitHub device code ready. Open the verification page and enter ${payload.device.user_code}.`);
    pushToast(`Enter code ${payload.device.user_code} at ${payload.device.verification_uri}`, "ok");
    if (payload.device.verification_uri_complete) {
      window.open(payload.device.verification_uri_complete, "_blank", "noopener,noreferrer");
    } else {
      window.open(payload.device.verification_uri, "_blank", "noopener,noreferrer");
    }
    setGithubBusy(null);

    const pollUntilConnected = async () => {
      const flow = {
        clientId: payload.clientId,
        deviceCode: payload.device.device_code,
        userCode: payload.device.user_code,
        verificationUri: payload.device.verification_uri,
        verificationUriComplete: payload.device.verification_uri_complete,
        interval: payload.device.interval || 5,
        expiresAt,
        scopes: payload.scopes,
      };
      let pollInterval = Math.max(3, flow.interval) * 1000;

      while (Date.now() < flow.expiresAt) {
        setGithubBusy("device-poll");
        const pollResponse = await fetch("/api/tools/connectors/github/device/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: flow.clientId, deviceCode: flow.deviceCode }),
        });

        if (pollResponse.ok) {
          const pollPayload = (await pollResponse.json()) as { connector: GitHubConnectorStatus };
          setGithubConnector(pollPayload.connector);
          setGithubDeviceFlow(null);
          setGithubBusy(null);
          setGithubInlineError(null);
          const loginMsg = `GitHub connected as ${pollPayload.connector.login ?? "unknown"}.`;
          setStatusMessage(loginMsg);
          pushToast(loginMsg, "ok");
          return;
        }

        if (pollResponse.status === 202) {
          const pollPayload = (await pollResponse.json()) as { interval?: number };
          pollInterval = Math.max(3, pollPayload.interval ?? flow.interval) * 1000;
          await new Promise((resolve) => window.setTimeout(resolve, pollInterval));
          continue;
        }

        const pollPayload = (await pollResponse.json()) as { error?: string };
        if (pollResponse.status === 410) {
          setStatusMessage(pollPayload.error ?? "GitHub device flow expired.");
          break;
        }

        setStatusMessage(pollPayload.error ?? "GitHub device flow failed.");
        break;
      }

      setGithubBusy(null);
      if (Date.now() >= expiresAt) {
        setStatusMessage("GitHub device flow expired before approval.");
      }
    };

    void pollUntilConnected();
  }

  async function connectGitHubConnector() {
    const token = githubTokenDraft.trim();
    if (!token) {
      setStatusMessage("Paste a GitHub token to connect.");
      return;
    }

    setGithubBusy("connect");
    const response = await fetch("/api/tools/connectors/github/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "GitHub connector login failed.");
      setGithubBusy(null);
      return;
    }

    const payload = (await response.json()) as { connector: GitHubConnectorStatus };
    setGithubConnector(payload.connector);
    setGithubTokenDraft("");
    setGithubInlineError(null);
    setStatusMessage("GitHub connected.");
    pushToast("GitHub connected.", "ok");
    setGithubBusy(null);
  }

  async function disconnectGitHubConnector() {
    setGithubBusy("disconnect");
    const response = await fetch("/api/tools/connectors/github/disconnect", {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to disconnect GitHub.");
      setGithubBusy(null);
      return;
    }

    const payload = (await response.json()) as { connector: GitHubConnectorStatus };
    setGithubConnector(payload.connector);
    setStatusMessage("GitHub disconnected.");
    pushToast("GitHub disconnected.", "warn");
    setGithubBusy(null);
  }

  async function runGitCommit() {
    const message = gitCommitMessage.trim();
    if (message.length < 3) {
      setStatusMessage("Commit message must be at least 3 characters.");
      return;
    }

    setGitBusyAction("commit");
    const response = await fetch("/api/tools/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Git commit failed.");
      setGitBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { status: GitStatusPayload };
    setGitStatus(payload.status);
    setStatusMessage("Committed workspace changes.");
    setGitBusyAction(null);
  }

  async function runGitPush() {
    setGitBusyAction("push");
    const response = await fetch("/api/tools/git/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Git push failed.");
      setGitBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { status: GitStatusPayload; usedGithubConnector?: boolean };
    setGitStatus(payload.status);
    setStatusMessage(payload.usedGithubConnector ? "Pushed via GitHub connector." : "Pushed current branch to origin.");
    setGitBusyAction(null);
  }

  async function onRunStartupCheck() {
    setStartupChecking(true);
    setStatusMessage("Running startup check...");
    const response = await fetch("/api/startup/check");
    const payload = (await response.json()) as { startup: StartupReadiness };

    setBoot((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        startup: payload.startup,
      };
    });

    setStatusMessage(payload.startup.ready ? "Startup checks passed" : "Startup checks found blockers");
    setStartupChecking(false);
    await loadLastStartupCheck();
  }

  async function onSendMessage(resendText?: string) {
    const textToSend = (resendText ?? composer).trim();
    if (!activeHarness || !textToSend || chatBusy) {
      return;
    }

    const harnessId = activeHarness.id;
    const workspaceIdForRequest = boot?.activeWorkspaceId ?? "default";
    const threadId = ensureHarnessThread(harnessId);
    const threadMessages = (chatThreadsByHarness[harnessId] ?? []).find((thread) => thread.id === threadId)?.messages ?? [];

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: textToSend,
      createdAt: new Date().toISOString(),
    };

    const assistantPlaceholder: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...threadMessages, userMessage];
    let threadSnapshot: HarnessChatThread = {
      id: threadId,
      title: threadMessages.length === 0 ? textToSend.slice(0, 42) : ((chatThreadsByHarness[harnessId] ?? []).find((t) => t.id === threadId)?.title ?? "New chat"),
      messages: [...nextHistory, assistantPlaceholder],
      meta: null,
      createdAt: (chatThreadsByHarness[harnessId] ?? []).find((t) => t.id === threadId)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertThread(harnessId, threadId, () => threadSnapshot);
    await saveHarnessThread(harnessId, threadSnapshot);
    setComposer("");
    setStreamTrace("");
    setStreamTraceOpen(false);
    setChatBusy(true);
    setStatusMessage(`Routing ${activeHarness.name} via Nexus Router...`);
    const requestId = crypto.randomUUID();
    setActiveRequestId(requestId);

    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        harnessId: activeHarness.id,
        message: userMessage.content,
        history: nextHistory,
        requestId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Chat request failed");
      setChatBusy(false);
      setActiveRequestId(null);
      await saveHarnessThread(harnessId, threadSnapshot);
      await refreshActiveWorkspaceTree(workspaceIdForRequest);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setStatusMessage("Unable to stream response");
      setChatBusy(false);
      setActiveRequestId(null);
      await saveHarnessThread(harnessId, threadSnapshot);
      await refreshActiveWorkspaceTree(workspaceIdForRequest);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const split = buffer.indexOf("\n\n");
        if (split === -1) {
          break;
        }

        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));

        if (!dataLine) {
          continue;
        }

        const raw = dataLine.slice(5).trim();
        let envelope: StreamEnvelope;

        try {
          envelope = JSON.parse(raw) as StreamEnvelope;
        } catch {
          continue;
        }

        if (envelope.type === "meta") {
          threadSnapshot = {
            ...threadSnapshot,
            meta: envelope.meta,
            updatedAt: new Date().toISOString(),
          };
          upsertThread(harnessId, threadId, () => threadSnapshot);
          continue;
        }

        if (envelope.type === "delta") {
          setStreamTrace((current) => `${current}${envelope.text}`.slice(-8000));
          threadSnapshot = {
            ...threadSnapshot,
            messages: threadSnapshot.messages.map((entry) =>
              entry.id === assistantPlaceholder.id
                ? { ...entry, content: `${entry.content}${envelope.text}` }
                : entry,
            ),
            updatedAt: new Date().toISOString(),
          };
          upsertThread(harnessId, threadId, () => threadSnapshot);
          continue;
        }

        if (envelope.type === "error") {
          setStatusMessage(envelope.message);
          setStreamTrace((current) => `${current}\n[error] ${envelope.message}`.slice(-8000));
          continue;
        }

        if (envelope.type === "done") {
          await saveHarnessThread(harnessId, threadSnapshot);
          setChatBusy(false);
          setActiveRequestId(null);
          setStatusMessage("Ready");
          await refreshActiveWorkspaceTree(workspaceIdForRequest);
        }
      }
    }

    await saveHarnessThread(harnessId, threadSnapshot);
    setChatBusy(false);
    setActiveRequestId(null);
    const finalAssistant = threadSnapshot.messages.find((entry) => entry.id === assistantPlaceholder.id)?.content ?? "";
    if (finalAssistant.trim()) {
      void speakHarnessReplyIfAssigned(harnessId, finalAssistant);
    }
    await refreshActiveWorkspaceTree(workspaceIdForRequest);
    setStatusMessage("Ready");
  }

  async function onStopStream() {
    if (!activeRequestId) {
      return;
    }

    await fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: activeRequestId }),
    });

    setChatBusy(false);
    setActiveRequestId(null);
    setStatusMessage("Streaming stopped");
  }

  async function onCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setStatusMessage("Message copied.");
    } catch {
      setStatusMessage("Copy failed.");
    }
  }

  async function loadWorkspaceRoots() {
    setWorkspaceBrowseBusy(true);
    const response = await fetch("/api/workspaces/browse/roots");
    if (!response.ok) {
      setWorkspaceBrowseBusy(false);
      return;
    }
    const payload = (await response.json()) as { roots: string[] };
    const roots = payload.roots ?? [];
    setWorkspaceRoots(roots);
    setWorkspaceBrowseBusy(false);
  }

  async function browseWorkspacePath(targetPath: string) {
    if (!targetPath) {
      return;
    }
    setWorkspaceBrowseBusy(true);
    const response = await fetch(`/api/workspaces/browse?path=${encodeURIComponent(targetPath)}`);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to browse folder");
      setWorkspaceBrowseBusy(false);
      return;
    }

    const payload = (await response.json()) as {
      path: string;
      parentPath: string | null;
      folders: WorkspaceFolderEntry[];
    };
    setWorkspaceBrowsePath(payload.path);
    setWorkspaceBrowseParentPath(payload.parentPath);
    setWorkspaceBrowseFolders(payload.folders ?? []);
    setWorkspaceBrowseBusy(false);
  }

  async function openWorkspaceBrowser() {
    setWorkspaceBrowserOpen(true);
    await loadWorkspaceRoots();
    if (workspacePathDraft) {
      await browseWorkspacePath(workspacePathDraft);
    }
  }

  function closeWorkspaceBrowser() {
    setWorkspaceBrowserOpen(false);
  }

  async function onCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (createWorkspaceName.trim().length < 2) {
      return;
    }
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: createWorkspaceName.trim(),
        workspacePath: workspacePathDraft.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to create workspace");
      return;
    }

    setCreateWorkspaceName("");
    setWorkspacePathDraft("");
    setWorkspaceBrowserOpen(false);
    await loadBootstrap();
  }

  async function onSwitchWorkspace(workspaceId: string) {
    await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: workspaceId }),
    });
    await loadBootstrap();
    await loadWorkspaceTree(workspaceId);
    if (selectedPane.type === "agent") {
      await Promise.all([
        loadHarnessThreads(selectedPane.id, workspaceId),
        loadHarnessSchedules(selectedPane.id, workspaceId),
        loadHarnessRuns(selectedPane.id, workspaceId),
      ]);
    }
  }

  async function onDeleteWorkspace(workspaceId: string) {
    if (workspaceId === "default") {
      return;
    }
    await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
    await loadBootstrap();
  }

  async function onResumeTask(task: FailedTask) {
    if (resumeBusyId) {
      return;
    }

    setResumeBusyId(task.requestId);
    setStatusMessage(`Resuming failed task ${task.requestId.slice(0, 8)}...`);

    const response = await fetch(`/api/chat/tasks/${task.requestId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to resume task");
      setResumeBusyId(null);
      return;
    }

    const payload = (await response.json()) as {
      content: string;
      meta: ChatMeta;
      requestId: string;
    };

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: task.message,
      createdAt: task.startedAt,
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: `${task.partialOutput}${payload.content}`,
      createdAt: new Date().toISOString(),
    };

    const resumedThread: HarnessChatThread = {
      id: crypto.randomUUID(),
      title: task.message.slice(0, 42),
      messages: [userMessage, assistantMessage],
      meta: payload.meta,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setChatThreadsByHarness((current) => ({
      ...current,
      [task.harnessId]: [resumedThread, ...(current[task.harnessId] ?? [])],
    }));
    setActiveThreadByHarness((current) => ({ ...current, [task.harnessId]: resumedThread.id }));
    await saveHarnessThread(task.harnessId, resumedThread, task.workspaceId);
    setSelectedPane({ type: "agent", id: task.harnessId });
    setStatusMessage("Task resumed and merged into chat view.");
    setResumeBusyId(null);
    await loadFailedTasks();
  }

  function formatCheckAge(timestamp: string): { label: string; ageClass: string } {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageMins = Math.floor(ageMs / 60_000);
    if (ageMins < 1) return { label: "just now", ageClass: "age-fresh" };
    if (ageMins < 10) return { label: `${ageMins}m ago`, ageClass: "age-fresh" };
    if (ageMins < 60) return { label: `${ageMins}m ago`, ageClass: "age-stale" };
    const ageHrs = Math.floor(ageMins / 60);
    return { label: `${ageHrs}h ago`, ageClass: "age-old" };
  }

  function renderTree(node: WorkspaceTreeNode): ReactElement {
    return (
      <li key={node.path} className={`tree-node ${node.type}`}>
        <span>{node.name}</span>
        {node.children && node.children.length > 0 ? <ul>{node.children.map(renderTree)}</ul> : null}
      </li>
    );
  }

  const onboardingRequired = boot?.onboardingRequired ?? true;
  const startupReady = boot?.startup.ready ?? false;
  const startupBlockers = boot?.startup.blockers ?? [];
  const connectorCards: ConnectorCard[] = [
    { id: "github", name: "GitHub", connected: Boolean(githubConnector?.connected), kind: "oauth" },
    { id: "gmail", name: "Gmail", connected: false, kind: "oauth" },
    { id: "slack", name: "Slack", connected: false, kind: "token" },
    { id: "discord", name: "Discord", connected: false, kind: "token" },
    { id: "notion", name: "Notion", connected: false, kind: "token" },
    { id: "dropbox", name: "Dropbox", connected: false, kind: "oauth" },
  ];
  const diagnosticsAlertCount = failedTasks.length + (startupReady ? 0 : Math.max(1, startupBlockers.length));
  const harnessThreads = selectedPane.type === "agent" ? (chatThreadsByHarness[selectedPane.id] ?? []) : [];
  const activeHarnessThreadId = selectedPane.type === "agent" ? activeThreadByHarness[selectedPane.id] ?? harnessThreads[0]?.id : undefined;
  const activeHarnessSubTab = selectedPane.type === "agent" ? getHarnessSubTab(selectedPane.id) : "chats";
  const activeHarnessSchedules = selectedPane.type === "agent" ? (harnessSchedulesByHarness[selectedPane.id] ?? []) : [];
  const activeHarnessRuns = selectedPane.type === "agent" ? (harnessRunsByHarness[selectedPane.id] ?? []) : [];
  const activeHarnessDraft = selectedPane.type === "agent"
    ? getScheduleDraft(selectedPane.id)
    : { title: "", prompt: "", intervalMinutes: 30 };

  return (
    <main className="app-shell">
      <div className="orb orb-left" />
      <div className="orb orb-right" />

      {toasts.length > 0 ? (
        <div className="toast-rack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              {t.tone === "ok" ? "✓" : t.tone === "err" ? "✗" : "!"}{" "}{t.message}
            </div>
          ))}
        </div>
      ) : null}

      {onboardingRequired ? (
        <section className="first-run-banner">
          <strong>First launch checkpoint:</strong> Configure Nexus Router providers to unlock all harness routing.
        </section>
      ) : null}

      {!onboardingRequired && !startupReady ? (
        <section className="first-run-banner">
          <strong>Startup blockers:</strong> {startupBlockers.join(" ")}
        </section>
      ) : null}

      <section className="pane-grid">
        <aside className="pane pane-left">
          <section className="side-brand">
            <img className="dashboard-logo" src={dashboardLogo} alt="NEXUS OS" />
            <small className="side-status">{statusMessage}</small>
          </section>

          <div className="pane-title-row">
            <h2>Agents</h2>
          </div>

          <ul className="nav-list">
            {boot?.harnesses.map((harness) => {
              const isLocked = onboardingRequired;
              const isActive = selectedPane.type === "agent" && selectedPane.id === harness.id;
              return (
                <li key={harness.id}>
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`nav-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setSelectedPane({ type: "agent", id: harness.id });
                    }}
                  >
                    <span className={`health ${harness.health}`} />
                    <span className="meta-block">
                      <strong>{harness.name}</strong>
                      <small>{harness.status} | {harnessDisplayModel[harness.id] ?? harness.defaultModel}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="pane-title-row split">
            <h2>Tools</h2>
            <button type="button" className="ghost" onClick={() => setToolsOpen((current) => !current)}>
              {toolsOpen ? "Collapse" : "Expand"}
            </button>
          </div>

          {toolsOpen ? (
            <ul className="nav-list">
              {boot?.tools.filter((tool) => tool.id !== "9router" && tool.id !== "settings").map((tool) => {
                const isActive = selectedPane.type === "tool" && selectedPane.id === tool.id;
                return (
                  <li key={tool.id}>
                    <button
                      type="button"
                      className={`nav-item ${isActive ? "active" : ""}`}
                      onClick={() => setSelectedPane({ type: "tool", id: tool.id })}
                    >
                      <span className={`health ${tool.status === "online" ? "healthy" : "degraded"}`} />
                      <span className="meta-block">
                        <strong>{tool.name}</strong>
                        <small>{tool.status}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className={`nav-item ${selectedPane.type === "tool" && selectedPane.id === "settings" ? "active" : ""}`}
                  onClick={() => setSelectedPane({ type: "tool", id: "settings" })}
                >
                  <span className="health healthy" />
                  <span className="meta-block">
                    <strong>⚙ Settings</strong>
                    <small>theme + git</small>
                  </span>
                </button>
              </li>
            </ul>
          ) : null}
        </aside>

        <section className="pane pane-middle">
          {selectedPane.type === "tool" && selectedPane.id === "nexus-router" ? (
            <div className="tool-view nxr-console">
              <h2>Nexus Router</h2>
              <p className="subtitle">Your own provider router — add API keys, sync models, build fallback chains.</p>

              {/* ── Provider Form ── */}
              <section className="nxr-section">
                <h3>Add / Update Provider</h3>
                <form className="nxr-provider-form" onSubmit={(event) => void nxSaveProvider(event)}>
                  <label>
                    Preset
                    <div className="tool-action-row tool-wrap-row">
                      <select
                        value={nxProviderForm.preset}
                        onChange={(event) => {
                          const preset = PRESET_PROVIDERS.find((p) => p.id === event.target.value) ?? PRESET_PROVIDERS[0];
                          setNxProviderForm((c) => ({ ...c, preset: preset.id, id: preset.id, name: preset.name, type: preset.type, baseUrl: preset.baseUrl, defaultModel: preset.defaultModel }));
                        }}
                      >
                        {PRESET_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {getProviderApiKeyUrl({ id: nxProviderForm.id, name: nxProviderForm.name, baseUrl: nxProviderForm.baseUrl }) ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => window.open(
                            getProviderApiKeyUrl({ id: nxProviderForm.id, name: nxProviderForm.name, baseUrl: nxProviderForm.baseUrl }) ?? "",
                            "_blank",
                            "noopener,noreferrer",
                          )}
                        >
                          Get API Key
                        </button>
                      ) : null}
                    </div>
                  </label>
                  <label>
                    Display Name
                    <input type="text" required value={nxProviderForm.name} onChange={(event) => setNxProviderForm((c) => ({ ...c, name: event.target.value }))} />
                  </label>
                  <label>
                    API Key (optional)
                    <input type="password" value={nxProviderForm.apiKey} placeholder="sk-..." onChange={(event) => setNxProviderForm((c) => ({ ...c, apiKey: event.target.value }))} />
                  </label>
                  <label>
                    Base URL
                    <input type="text" required value={nxProviderForm.baseUrl} onChange={(event) => setNxProviderForm((c) => ({ ...c, baseUrl: event.target.value }))} />
                  </label>
                  <label>
                    Default Model
                    <input type="text" value={nxProviderForm.defaultModel} onChange={(event) => setNxProviderForm((c) => ({ ...c, defaultModel: event.target.value }))} />
                  </label>
                  <button type="submit" disabled={nxSaving}>{nxSaving ? "Saving..." : "Save Provider"}</button>
                </form>
              </section>

              {/* ── Connected Providers ── */}
              {nxProviderViews.length > 0 ? (
                <section className="nxr-section">
                  <h3>Connected Providers</h3>
                  <ul className="nxr-provider-list">
                    {nxProviderViews.map((provider) => (
                      <li key={provider.id}>
                        <div className="nxr-provider-row">
                          <span className={`health ${provider.enabled ? "healthy" : "offline"}`} />
                          <div>
                            <strong>{provider.name}</strong>
                            <small>{provider.id} · {provider.isLocal ? "local" : (provider.maskedApiKey || "(no key)")} · {provider.models.length} models{provider.lastSyncedAt ? ` · synced ${new Date(provider.lastSyncedAt).toLocaleTimeString()}` : ""}</small>
                          </div>
                          <button
                            type="button"
                            className="ghost nxr-sync-btn"
                            onClick={() => void nxSyncModels(provider.id)}
                            disabled={nxSyncingId === provider.id}
                          >
                            {nxSyncingId === provider.id ? "Syncing..." : "Sync Models"}
                          </button>
                        </div>
                        {provider.models.length > 0 ? (
                          <details className="nxr-model-list">
                            <summary>{provider.models.length} models</summary>
                            <ul>{provider.models.slice(0, 30).map((m) => <li key={m}>{m}</li>)}</ul>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* ── Fallback Chain ── */}
              <section className="nxr-section">
                <div className="nxr-section-header">
                  <h3>Fallback Chain</h3>
                  <button type="button" className="ghost" onClick={() => setNxFallbackRows((rows) => [...rows, createFallbackRow()])}>Add Row</button>
                </div>
                <p className="nxr-hint">Pick provider + model per row. Model dropdown uses synced active models.</p>
                <div className="nxr-fallback-rows">
                  {nxFallbackRows.map((row, rowIndex) => {
                    const modelOptions = row.providerId === "cookbook"
                      ? cookbookModelOptions
                      : (nxModelOptionsByProvider[row.providerId] ?? nxProviderViews.find((provider) => provider.id === row.providerId)?.models ?? []);
                    const health = getFallbackRowHealth(row);
                    return (
                      <div key={row.id} className="nxr-fallback-row">
                        <select
                          value={row.providerId}
                          onChange={(event) => {
                            const providerId = event.target.value;
                            setNxFallbackRows((rows) => rows.map((entry) => entry.id === row.id ? { ...entry, providerId, model: "" } : entry));
                            if (providerId && providerId !== "cookbook" && (nxModelOptionsByProvider[providerId]?.length ?? 0) === 0) {
                              void nxSyncModels(providerId);
                            }
                          }}
                        >
                          <option value="">Select provider</option>
                          {nxProviderViews.filter((provider) => provider.enabled).map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name}</option>
                          ))}
                        </select>
                        <select
                          value={row.model}
                          disabled={!row.providerId}
                          onChange={(event) => setNxFallbackRows((rows) => rows.map((entry) => entry.id === row.id ? { ...entry, model: event.target.value } : entry))}
                        >
                          <option value="">{row.providerId ? "Select model" : "Select provider first"}</option>
                          {modelOptions.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => row.providerId ? void nxSyncModels(row.providerId) : undefined}
                          disabled={!row.providerId || nxSyncingId === row.providerId}
                        >
                          {nxSyncingId === row.providerId ? "Syncing..." : "Refresh"}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => moveFallbackRow(row.id, -1)}
                          disabled={rowIndex === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => moveFallbackRow(row.id, 1)}
                          disabled={rowIndex === nxFallbackRows.length - 1}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setNxFallbackRows((rows) => rows.filter((entry) => entry.id !== row.id))}
                          disabled={nxFallbackRows.length <= 1}
                        >
                          Remove
                        </button>
                        <span className={`nxr-row-status ${health.tone}`}>{health.label}</span>
                      </div>
                    );
                  })}
                </div>

                <h3 className="nxr-subheading">Harness Model Assignment</h3>
                <p className="nxr-hint">Assign one or more fallback targets per harness. Only fallback rows appear here.</p>
                {fallbackChoiceOptions.length === 0 ? (
                  <p className="nxr-hint">Add at least one fallback row before assigning harness models.</p>
                ) : (
                  <div className="nxr-harness-grid">
                    {boot?.harnesses.map((harness) => {
                      const selected = nxHarnessAssignments[harness.id] ?? [];
                      return (
                        <div key={harness.id} className="nxr-harness-card">
                          <strong>{harness.name}</strong>
                          <small>{harness.id}</small>
                          <ul>
                            {fallbackChoiceOptions.map((option) => (
                              <li key={`${harness.id}-${option}`}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(option)}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      setNxHarnessAssignments((current) => {
                                        const existing = current[harness.id] ?? [];
                                        const next = checked
                                          ? Array.from(new Set([...existing, option]))
                                          : existing.filter((entry) => entry !== option);
                                        return { ...current, [harness.id]: next };
                                      });
                                    }}
                                  />
                                  <span>{option}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="nxr-retry">
                  <label>
                    Max Attempts
                    <input type="number" min={1} max={8} value={nxRetryEditor.maxAttempts} onChange={(event) => setNxRetryEditor((c) => ({ ...c, maxAttempts: Number(event.target.value) }))} />
                  </label>
                  <label>
                    Backoff ms
                    <input type="number" min={0} max={5000} step={100} value={nxRetryEditor.backoffMs} onChange={(event) => setNxRetryEditor((c) => ({ ...c, backoffMs: Number(event.target.value) }))} />
                  </label>
                </div>
                <button type="button" onClick={() => void nxSaveConfig()} disabled={nxConfigSaving}>
                  {nxConfigSaving ? "Saving..." : "Save Fallback Config"}
                </button>
              </section>

              {/* ── Test Chat ── */}
              <section className="nxr-section">
                <h3>Test Route</h3>
                <div className="nxr-test-row">
                  <input type="text" value={nxTestPrompt} onChange={(event) => setNxTestPrompt(event.target.value)} placeholder="Test prompt..." />
                  <button type="button" onClick={() => void nxTestChat()} disabled={nxTestBusy}>{nxTestBusy ? "Routing..." : "Send"}</button>
                </div>
                {nxTestResult ? (
                  <div className="nxr-test-result">
                    <small>{nxTestResult.providerId} · {nxTestResult.model} · {nxTestResult.elapsedMs}ms</small>
                    <p>{nxTestResult.content}</p>
                    <details>
                      <summary>Attempts ({nxTestResult.attempts.length})</summary>
                      <ul>{nxTestResult.attempts.map((a, i) => <li key={i}>{a.status === "success" ? "✓" : "✗"} {a.providerId}/{a.model} — {a.details}</li>)}</ul>
                    </details>
                  </div>
                ) : null}
              </section>

              {/* ── Router Logs ── */}
              {nxConsoleLogs.length > 0 ? (
                <section className="nxr-section">
                  <h3>Router Logs</h3>
                  <ul className="nxr-logs">
                    {nxConsoleLogs.slice(0, 10).map((log, i) => (
                      <li key={i} className={`nxr-log-${log.level}`}>
                        <small>{new Date(log.timestamp).toLocaleTimeString()}</small> {log.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "cookbook" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Cookbook</h2>
                  <p className="subtitle">Scan this machine and recommend the best local fallback models when free cloud tokens run out.</p>
                </div>
                <button type="button" onClick={() => void loadCookbookSnapshot()} disabled={cookbookBusy}>
                  {cookbookBusy ? "Scanning..." : "Scan Machine"}
                </button>
              </div>

              <div className="tool-tabs" role="tablist" aria-label="Cookbook panels">
                <button
                  type="button"
                  className={`tool-tab ${cookbookTab === "overview" ? "active" : ""}`}
                  onClick={() => setCookbookTab("overview")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  className={`tool-tab ${cookbookTab === "jobs" ? "active" : ""}`}
                  onClick={() => {
                    setCookbookTab("jobs");
                    void loadRuntimeJobs();
                  }}
                >
                  Runtime Jobs
                </button>
              </div>

              {cookbookTab === "jobs" ? (
                <section className="tool-section">
                  <h3>Runtime Jobs</h3>
                  {runtimeJobs.length === 0 ? (
                    <p>No runtime tasks yet.</p>
                  ) : (
                    <ul className="runtime-jobs-list">
                      {runtimeJobs.map((job) => (
                        <li key={job.id} className="runtime-job-card">
                          <div className="runtime-job-header">
                            <div>
                              <strong>{job.action}{job.model ? ` (${job.model})` : ""}</strong>
                              <small className={`runtime-job-status status-${job.status}`}>{job.status}</small>
                            </div>
                            <small>{new Date(job.updatedAt).toLocaleString()}</small>
                          </div>

                          {job.error ? <p className="runtime-job-error">{job.error}</p> : null}

                          <div className="runtime-job-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => toggleRuntimeJobExpanded(job.id)}
                            >
                              {expandedRuntimeJobIds[job.id] ? "Hide Logs" : "Show Logs"}
                            </button>

                            <button
                              type="button"
                              className="ghost"
                              onClick={() => void cancelRuntimeJob(job)}
                              disabled={job.status !== "queued" && job.status !== "running" && job.status !== "canceling"}
                            >
                              {job.status === "canceling" ? "Canceling..." : "Cancel"}
                            </button>

                            <button
                              type="button"
                              onClick={() => void retryRuntimeJob(job)}
                              disabled={job.status !== "failed" && job.status !== "canceled"}
                            >
                              Retry
                            </button>
                          </div>

                          {expandedRuntimeJobIds[job.id] ? (
                            <pre className="runtime-job-log">{job.logs.join("\n") || "No logs yet."}</pre>
                          ) : (
                            <small>{job.logs[job.logs.length - 1] ?? "No logs yet."}</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : cookbookSnapshot ? (
                <>
                  <section className="tool-section">
                    <h3>System Snapshot</h3>
                    <div className="cookbook-spec-row">
                      <span>CPU {cookbookSnapshot.machine.logicalCores}c</span>
                      <span>RAM {cookbookSnapshot.machine.totalRamGb}G ({cookbookSnapshot.machine.freeRamGb}G free)</span>
                      <span>Disk {cookbookSnapshot.machine.freeDiskGb ?? "?"}G free</span>
                      <span>GPU {(cookbookSnapshot.machine.gpuNames[0] ?? "none").replace(/NVIDIA|AMD|Intel/gi, "").trim() || (cookbookSnapshot.machine.gpuNames[0] ?? "none")}</span>
                      <span>Ollama {runtimeStatus?.ollamaInstalled ? (runtimeStatus?.ollamaRunning ? "up" : "booting") : "provisioning"}</span>
                      <span>Piper {runtimeStatus?.piperInstalled ? "up" : "provisioning"}</span>
                    </div>
                    <small>Models installed: {runtimeStatus?.ollamaModels.join(", ") || "none yet"}</small>
                  </section>

                  <section className="tool-section">
                    <h3>Recommended local models</h3>
                    <ul className="cookbook-recommendation-lines">
                      {cookbookSnapshot.recommendations.map((item) => (
                        <li key={item.id} className="cookbook-recommendation-line">
                          <div className="cookbook-recommendation-main">
                            <span className="cookbook-recommendation-symbol">{recommendationSymbol(item)}</span>
                            <strong>{item.name}</strong>
                            <small>{item.size} · {item.runtime}</small>
                          </div>

                          <div className="tool-action-row cookbook-recommendation-actions">
                            {item.runtime === "ollama" ? (
                              <button
                                type="button"
                                onClick={() => void runRecommendationAction(item)}
                                disabled={runtimeBusyAction !== null || !runtimeStatus?.ollamaInstalled}
                              >
                                {(() => {
                                  const model = recommendationModelName(item);
                                  if (!model) return "Install";
                                  const activePull = findActiveModelPullJob(model);
                                  if (activePull) return activePull.status === "canceling" ? "Canceling..." : "Pause";
                                  if (runtimeStatus?.ollamaModels.includes(model)) return "Installed";
                                  return "Install";
                                })()}
                              </button>
                            ) : (
                              <button type="button" className="ghost" disabled>Managed</button>
                            )}
                            <button type="button" className="ghost" onClick={() => setCookbookTab("jobs")}>Jobs</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              ) : (
                <div className="placeholder-view">
                  <h2>Cookbook</h2>
                  <p>Run a machine scan to generate local model recommendations.</p>
                </div>
              )}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "voice-studio" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Voice Studio</h2>
                  <p className="subtitle">Immediate text-to-speech playback in NexusOS, with Piper readiness for better offline voices later.</p>
                </div>
                <button type="button" onClick={() => void loadVoiceStatus()} disabled={voiceBusy}>
                  {voiceBusy ? "Checking..." : "Refresh Voice Status"}
                </button>
              </div>

              <section className="tool-section">
                <textarea
                  value={voiceText}
                  onChange={(event) => setVoiceText(event.target.value)}
                  rows={6}
                  placeholder="Type text to speak..."
                />
                <div className="tool-action-row">
                  <button type="button" onClick={playVoicePreview} disabled={!voiceText.trim() || voicePlaying}>
                    {voicePlaying ? "Playing..." : "Play Voice"}
                  </button>
                  <button type="button" onClick={() => void saveVoiceGeneration()} disabled={!voiceText.trim() || voiceSaveBusy}>
                    {voiceSaveBusy ? "Saving..." : "Save To Assets"}
                  </button>
                  <button type="button" className="ghost" onClick={stopVoicePlayback} disabled={!voicePlaying}>
                    Stop
                  </button>
                </div>
              </section>

              {runtimeStatus?.piperInstalled ? (
                <section className="tool-section">
                  <h3>Piper Voice Preview</h3>
                  <label>
                    Voice
                    <select
                      value={voicePreviewVoiceId}
                      onChange={(event) => setVoicePreviewVoiceId(event.target.value)}
                      disabled={voiceAvailableVoices.length === 0}
                    >
                      {voiceAvailableVoices.length === 0 ? <option value="">No voices installed</option> : null}
                      {voiceAvailableVoices.map((voiceId) => <option key={voiceId} value={voiceId}>{voiceId}</option>)}
                    </select>
                  </label>
                  <small>Installed Piper voices: {runtimeStatus?.piperVoices.join(", ") || "none yet"}</small>
                  <small>Select a Piper voice, then click Play Voice to audition it.</small>
                </section>
              ) : null}

              {runtimeStatus?.piperInstalled ? (
                <section className="tool-section">
                  <h3>Harness Voice Assignments</h3>
                  <ul className="tool-list">
                    {(boot?.harnesses ?? []).map((harness) => (
                      <li key={harness.id} className="harness-voice-row">
                        <strong>{harness.name}</strong>
                        <select
                          value={voiceAssignments[harness.id] ?? ""}
                          onChange={(event) => {
                            const next = { ...voiceAssignments, [harness.id]: event.target.value };
                            if (!event.target.value) {
                              delete next[harness.id];
                            }
                            void saveVoiceAssignments(next);
                          }}
                          disabled={voiceAssignmentsBusy || voiceAvailableVoices.length === 0}
                        >
                          <option value="">Default voice</option>
                          {voiceAvailableVoices.map((voiceId) => <option key={voiceId} value={voiceId}>{voiceId}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                  <small>Assignments are saved and can be applied automatically for harness-specific speech output.</small>
                </section>
              ) : null}

              {voiceStatus ? (
                <section className="tool-card-grid">
                  <article className="tool-card">
                    <h3>Browser speech</h3>
                    <p>{voiceStatus.browserSpeechRecommended ? "active fallback" : "available"}</p>
                    <small>Runs immediately in the app UI when Piper is not ready or not preferred.</small>
                  </article>
                  <article className="tool-card">
                    <h3>Piper</h3>
                    <p>{voiceStatus.piperInstalled ? "installed" : "not detected"}</p>
                    <small>{voiceStatus.piperPath ?? "Install Piper for offline voices and exportable audio files."}</small>
                  </article>
                </section>
              ) : null}

              {voiceStatus ? (
                <section className="tool-section">
                  <h3>Notes</h3>
                  <ul className="tool-list">
                    {voiceStatus.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "music-generator" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Music Generator</h2>
                  <p className="subtitle">Nexus-native Stable Audio generation using local Stable Audio 3 runtime.</p>
                </div>
                <button type="button" onClick={() => void loadStableAudioStatus()} disabled={stableAudioBusyAction !== null}>
                  {stableAudioBusyAction === "refresh" ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <section className="tool-section">
                <h3>Generate Audio</h3>
                <div className="stable-audio-form">
                  <label>
                    <span>Mode</span>
                    <select value={stableAudioMode} onChange={(event) => setStableAudioMode(event.target.value as "small-music" | "small-sfx" | "medium")}>
                      {(stableAudioStatus?.modes ?? []).map((mode) => (
                        <option key={mode.id} value={mode.id} disabled={!mode.available}>{mode.label}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Duration (seconds)</span>
                    <input
                      type="number"
                      min={1}
                      max={stableAudioMode === "medium" ? 380 : 120}
                      value={stableAudioDuration}
                      onChange={(event) => setStableAudioDuration(Number(event.target.value || 30))}
                    />
                  </label>

                  <label>
                    <span>Prompt</span>
                    <textarea
                      rows={4}
                      value={stableAudioPrompt}
                      onChange={(event) => setStableAudioPrompt(event.target.value)}
                      placeholder="Describe the song or sound effect you want..."
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void generateStableAudio()}
                    disabled={stableAudioBusyAction !== null || !stableAudioPrompt.trim()}
                  >
                    {stableAudioBusyAction === "generate" ? "Generating..." : "Generate Song"}
                  </button>
                </div>

                <small>Status: {stableAudioStatus?.installed ? "runtime ready" : "runtime needs install"} · mode max {stableAudioMode === "medium" ? "380s" : "120s"}</small>
                <small>Medium requires a compatible NVIDIA setup. If medium fails, use Small Music or check Cookbook recommendations.</small>
              </section>

              <section className="tool-section">
                <h3>Recent Outputs</h3>
                {stableAudioGenerated.length === 0 ? (
                  <small>No generated clips yet. Your first successful run will be saved into Assets/music.</small>
                ) : (
                  <ul className="tool-list">
                    {stableAudioGenerated.map((clip) => (
                      <li key={`${clip.relativePath}-${clip.mode}`}>
                        {clip.mode} · {clip.duration}s · {clip.relativePath}
                        <audio controls preload="none" src={clip.playbackUrl} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "image-generator" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Image Generator</h2>
                  <p className="subtitle">Local-only generation tuned for 6-8GB VRAM devices with first-run model install and live status stream.</p>
                </div>
              </div>

              <section className="tool-section">
                <h3>Generate Image</h3>
                <div className="stable-audio-form">
                  {!localImageStatus?.ready ? (
                    <small>Local image runtime is not ready. Install uv first, then refresh this pane.</small>
                  ) : null}
                  <div>
                    <span>Size Presets</span>
                    <div className="image-preset-row">
                      {IMAGE_SIZE_PRESETS.map((preset) => (
                        <button key={preset.id} type="button" className="ghost" onClick={() => applyImageSizePreset(preset)} disabled={imageBusyAction !== null}>
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span>Model</span>
                    <select value={imageModel} onChange={(event) => setImageModel(event.target.value as "sd15" | "dreamshaper-8")}> 
                      <option value="sd15">Stable Diffusion 1.5</option>
                      <option value="dreamshaper-8">DreamShaper 8</option>
                    </select>
                  </label>
                  {localImageStatus?.models?.length ? (
                    <small>
                      {localImageStatus.models.find((entry) => entry.id === imageModel)?.installed
                        ? "Model is installed locally."
                        : "Model will auto-install on first run."}
                    </small>
                  ) : null}
                  <div className="image-size-grid">
                    <label>
                      <span>Width</span>
                      <input type="number" min={256} max={768} step={64} value={imageWidth} onChange={(event) => setImageWidth(Number(event.target.value || 512))} />
                    </label>
                    <label>
                      <span>Height</span>
                      <input type="number" min={256} max={768} step={64} value={imageHeight} onChange={(event) => setImageHeight(Number(event.target.value || 512))} />
                    </label>
                  </div>
                  <div className="image-size-grid">
                    <label>
                      <span>Steps</span>
                      <input type="number" min={4} max={50} value={imageSteps} onChange={(event) => setImageSteps(Number(event.target.value || 18))} />
                    </label>
                    <label>
                      <span>Guidance</span>
                      <input type="number" min={0} max={20} step={0.5} value={imageGuidanceScale} onChange={(event) => setImageGuidanceScale(Number(event.target.value || 6.5))} />
                    </label>
                  </div>
                  <label>
                    <span>Seed (-1 = random)</span>
                    <input type="number" value={imageSeed} onChange={(event) => setImageSeed(Number(event.target.value || -1))} />
                  </label>
                  <label>
                    <span>Prompt</span>
                    <textarea rows={4} value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="Describe the image you want to generate..." />
                  </label>
                  <label>
                    <span>Negative Prompt</span>
                    <textarea rows={2} value={imageNegativePrompt} onChange={(event) => setImageNegativePrompt(event.target.value)} placeholder="blurry, low quality, artifacts..." />
                  </label>
                  <div className="tool-action-row">
                    <button type="button" onClick={() => void generateImage()} disabled={imageBusyAction !== null || !imagePrompt.trim() || !localImageStatus?.ready}>
                      {imageBusyAction === "generate" ? "Generating..." : "Generate"}
                    </button>
                    <button type="button" className="ghost" onClick={stopImageGeneration} disabled={imageBusyAction !== "generate"}>
                      Stop
                    </button>
                    <button type="button" className="ghost" onClick={() => void saveGeneratedImage()} disabled={imageBusyAction !== null || !imageResult?.imageUrl}>
                      {imageBusyAction === "save" ? "Saving..." : "Save To Workspace"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="tool-section">
                <h3>Preview</h3>
                {imageResult?.imageUrl ? (
                  <div className="image-preview-panel">
                    <img src={imageResult.imageUrl} alt="Generated output preview" />
                    <small>{imageResult.provider} · {imageResult.model} · {imageResult.width}x{imageResult.height} · steps {imageResult.steps ?? "-"} · cfg {imageResult.guidanceScale ?? "-"} · seed {imageResult.seed ?? "-"}</small>
                    {imageResult.relativePath ? <small>Saved: {imageResult.relativePath}</small> : null}
                  </div>
                ) : (
                  <small>Generate an image to preview it here.</small>
                )}
              </section>

              <section className="tool-section">
                <h3>Status Stream</h3>
                <pre className="image-status-stream">{imageStatusTrace || "No status yet."}</pre>
              </section>

              <section className="tool-section">
                <h3>Recent Images</h3>
                {recentImages.length === 0 ? (
                  <small>No recent generations yet.</small>
                ) : (
                  <ul className="tool-list">
                    {recentImages.map((image) => (
                      <li key={`${image.imageUrl}-${image.createdAt}`}>
                        {image.model} · {image.width}x{image.height} · {new Date(image.createdAt).toLocaleTimeString()}
                        <small>{image.prompt}</small>
                        {image.relativePath ? <small>Saved: {image.relativePath}</small> : null}
                        <div className="tool-action-row">
                          <button type="button" className="ghost" onClick={() => openRecentImage(image)}>
                            Open
                          </button>
                          <button type="button" className="ghost" onClick={() => void saveGeneratedImage(image)} disabled={imageBusyAction !== null}>
                            Re-save
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "video-generator" ? (
            <div className="tool-view tool-console">
              <section className="coming-soon-panel">
                <h2>Video Generator</h2>
                <p>Coming Soon</p>
                <small>This pane is reserved for a future repo-backed local video generator.</small>
              </section>
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "settings" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Settings</h2>
                  <p className="subtitle">Connect services, tune appearance, and control repository automation.</p>
                </div>
              </div>

              <div className="settings-tabs" role="tablist" aria-label="Settings sections">
                <button
                  type="button"
                  className={`tool-tab ${settingsTab === "connectors" ? "active" : ""}`}
                  onClick={() => setSettingsTab("connectors")}
                >
                  Connectors
                </button>
                <button
                  type="button"
                  className={`tool-tab ${settingsTab === "appearance" ? "active" : ""}`}
                  onClick={() => setSettingsTab("appearance")}
                >
                  Appearance
                </button>
                <button
                  type="button"
                  className={`tool-tab ${settingsTab === "automation" ? "active" : ""}`}
                  onClick={() => setSettingsTab("automation")}
                >
                  Automation
                </button>
              </div>

              {settingsTab === "connectors" ? (
                <>
                  <section className="tool-section">
                    <div className="connector-placeholder-grid">
                      {connectorCards.map((connector) => (
                        <button
                          key={connector.id}
                          type="button"
                          className="connector-placeholder-card connector-card-button"
                          onClick={() => setActiveConnectorId(connector.id)}
                        >
                          <strong>{connector.name}</strong>
                          <small>{connector.connected ? "connected" : "not connected"}</small>
                        </button>
                      ))}
                    </div>
                  </section>

                  {activeConnectorId ? (
                    <div className="connector-modal-backdrop" onClick={() => setActiveConnectorId(null)}>
                      <div className="connector-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="tool-header-row">
                          <h3>{connectorCards.find((connector) => connector.id === activeConnectorId)?.name ?? "Connector"}</h3>
                          <button type="button" className="ghost" onClick={() => setActiveConnectorId(null)}>Close</button>
                        </div>

                        {activeConnectorId === "github" ? (
                          <>
                            {githubInlineError ? <p className="connector-inline-error">{githubInlineError}</p> : null}
                            {githubConnector?.connected ? (
                              <small>Connected as {githubConnector.login ?? "unknown"} ({githubConnector.maskedToken ?? "token"})</small>
                            ) : (
                              <small>Start GitHub device flow to connect without pasting a token.</small>
                            )}
                            <label>
                              GitHub OAuth Client ID
                              <input
                                type="text"
                                value={githubClientId}
                                placeholder="GitHub OAuth app client ID"
                                onChange={(event) => setGithubClientId(event.target.value)}
                              />
                            </label>
                            <div className="tool-action-row">
                              <button type="button" onClick={() => void startGitHubDeviceFlow()} disabled={githubBusy !== null}>
                                {githubBusy === "device-start" || githubBusy === "device-poll" ? "Connecting..." : "Connect GitHub"}
                              </button>
                              <button type="button" className="ghost" onClick={() => void disconnectGitHubConnector()} disabled={githubBusy !== null || !githubConnector?.connected}>
                                {githubBusy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                              </button>
                            </div>
                            {githubDeviceFlow ? (
                              <div className="github-device-card">
                                <strong>Device Code: {githubDeviceFlow.userCode}</strong>
                                <small>Go to {githubDeviceFlow.verificationUri} and enter the code above.</small>
                                <small>Scopes: {githubDeviceFlow.scopes.join(", ")}</small>
                                <small>Expires: {new Date(githubDeviceFlow.expiresAt).toLocaleTimeString()}</small>
                              </div>
                            ) : null}
                            <details className="github-advanced-details">
                              <summary>Advanced token fallback</summary>
                              <label>
                                GitHub Token
                                <input
                                  type="password"
                                  value={githubTokenDraft}
                                  placeholder="github_pat_..."
                                  onChange={(event) => setGithubTokenDraft(event.target.value)}
                                />
                              </label>
                              <div className="tool-action-row">
                                <button type="button" onClick={() => void connectGitHubConnector()} disabled={githubBusy !== null || !githubTokenDraft.trim()}>
                                  {githubBusy === "connect" ? "Connecting..." : "Use Token Instead"}
                                </button>
                              </div>
                            </details>
                          </>
                        ) : activeConnectorId === "gmail" ? (
                          <>
                            <small>Gmail will use a browser-based connect flow when implemented.</small>
                            <div className="tool-action-row">
                              <button type="button" onClick={() => pushToast("Gmail connector coming soon.", "warn")}>Connect Gmail</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <small>This connector is reserved and not wired yet.</small>
                            <div className="tool-action-row">
                              <button type="button" onClick={() => pushToast(`${connectorCards.find((connector) => connector.id === activeConnectorId)?.name ?? "Connector"} is coming soon.`, "warn")}>Okay</button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {settingsTab === "appearance" ? (
                <section className="tool-section">
                  <h3>Theme Colors</h3>
                  <div className="theme-grid" role="radiogroup" aria-label="Theme presets">
                    {THEME_PRESETS.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`theme-card ${themeId === theme.id ? "active" : ""}`}
                        onClick={() => setThemeId(theme.id)}
                      >
                        <strong>{theme.name}</strong>
                        <small>{theme.hint}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {settingsTab === "automation" ? (
                <section className="tool-section">
                  <div className="tool-header-row">
                    <h3>Git Workspace</h3>
                    <button type="button" className="ghost" onClick={() => void loadGitStatus()} disabled={gitBusyAction !== null}>
                      {gitBusyAction === "refresh" ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  {gitStatus ? (
                    <div className="git-status-grid">
                      <span>branch: {gitStatus.branch}</span>
                      <span>ahead: {gitStatus.ahead}</span>
                      <span>behind: {gitStatus.behind}</span>
                      <span>staged: {gitStatus.counts.staged}</span>
                      <span>unstaged: {gitStatus.counts.unstaged}</span>
                      <span>untracked: {gitStatus.counts.untracked}</span>
                    </div>
                  ) : (
                    <small>Git status not loaded yet.</small>
                  )}

                  <label>
                    Commit Message
                    <input
                      type="text"
                      value={gitCommitMessage}
                      onChange={(event) => setGitCommitMessage(event.target.value)}
                      placeholder="Describe this change"
                    />
                  </label>

                  <div className="tool-action-row">
                    <button type="button" onClick={() => void runGitCommit()} disabled={gitBusyAction !== null}>
                      {gitBusyAction === "commit" ? "Committing..." : "Commit All Changes"}
                    </button>
                    <button type="button" className="ghost" onClick={() => void runGitPush()} disabled={gitBusyAction !== null}>
                      {gitBusyAction === "push" ? "Pushing..." : "Push Branch"}
                    </button>
                  </div>

                  {gitStatus?.entries.length ? (
                    <details className="git-entry-list">
                      <summary>Changed files ({gitStatus.entries.length})</summary>
                      <ul>
                        {gitStatus.entries.slice(0, 40).map((entry) => (
                          <li key={`${entry.x}${entry.y}-${entry.path}`}>
                            <span>{entry.x}{entry.y}</span>
                            <span>{entry.path}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedPane.type === "tool" && !["nexus-router", "cookbook", "voice-studio", "music-generator", "image-generator", "settings"].includes(selectedPane.id) ? (
            <div className="placeholder-view">
              <h2>{boot?.tools.find((tool) => tool.id === selectedPane.id)?.name ?? "Tool"}</h2>
              <p>Tool plugin slot ready. Hook this panel to a future backend module.</p>
            </div>
          ) : null}

          {selectedPane.type === "agent" ? (
            <div className="chat-view">
              <div className="chat-layout">
                <aside className="chat-thread-pane">
                  <div className="chat-thread-header">
                    <h3>{activeHarness?.name ?? "Harness"}</h3>
                    <small>Workspace: {boot?.activeWorkspaceId ?? "default"}</small>
                  </div>
                  <div className="harness-tabs">
                    {(["chats", "scheduled", "runs"] as HarnessSubTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        className={`harness-tab ${activeHarnessSubTab === tab ? "active" : ""}`}
                        onClick={() => {
                          if (!activeHarness) {
                            return;
                          }
                          setHarnessSubTabByHarness((current) => ({ ...current, [activeHarness.id]: tab }));
                          if (tab === "scheduled") {
                            void loadHarnessSchedules(activeHarness.id);
                          }
                          if (tab === "runs") {
                            void loadHarnessRuns(activeHarness.id);
                          }
                        }}
                      >
                        {tab === "chats" ? "Chats" : tab === "scheduled" ? "Scheduled" : "Runs"}
                      </button>
                    ))}
                  </div>

                  {activeHarnessSubTab === "chats" ? (
                    <>
                      <button
                        type="button"
                        className="ghost thread-create"
                        onClick={() => {
                          if (!activeHarness) return;
                          const thread = createThread();
                          setChatThreadsByHarness((current) => ({
                            ...current,
                            [activeHarness.id]: [thread, ...(current[activeHarness.id] ?? [])],
                          }));
                          setActiveThreadByHarness((current) => ({ ...current, [activeHarness.id]: thread.id }));
                          void saveHarnessThread(activeHarness.id, thread);
                          setComposer("");
                        }}
                      >
                        New Chat
                      </button>
                      <ul className="chat-thread-list">
                        {harnessThreads.map((thread) => (
                          <li key={thread.id}>
                            <button
                              type="button"
                              className={`chat-thread-item ${activeHarnessThreadId === thread.id ? "active" : ""}`}
                              onClick={() => {
                                if (!activeHarness) return;
                                setActiveThreadByHarness((current) => ({ ...current, [activeHarness.id]: thread.id }));
                              }}
                            >
                              <strong>{thread.title || "New chat"}</strong>
                              <small>{new Date(thread.updatedAt).toLocaleString()}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {activeHarnessSubTab === "scheduled" ? (
                    <div className="automation-panel">
                      <label>
                        Title
                        <input
                          type="text"
                          value={activeHarnessDraft.title}
                          onChange={(event) => {
                            if (!activeHarness) return;
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: {
                                ...getScheduleDraft(activeHarness.id),
                                title: event.target.value,
                              },
                            }));
                          }}
                          placeholder="Daily summary"
                        />
                      </label>
                      <label>
                        Prompt
                        <textarea
                          rows={4}
                          value={activeHarnessDraft.prompt}
                          onChange={(event) => {
                            if (!activeHarness) return;
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: {
                                ...getScheduleDraft(activeHarness.id),
                                prompt: event.target.value,
                              },
                            }));
                          }}
                          placeholder="Run this job..."
                        />
                      </label>
                      <label>
                        Every (minutes)
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={activeHarnessDraft.intervalMinutes}
                          onChange={(event) => {
                            if (!activeHarness) return;
                            const next = Number(event.target.value) || 30;
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: {
                                ...getScheduleDraft(activeHarness.id),
                                intervalMinutes: Math.max(1, Math.min(1440, next)),
                              },
                            }));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => activeHarness && void onCreateSchedule(activeHarness.id)}
                        disabled={!activeHarness || scheduleBusyHarnessId === activeHarness.id}
                      >
                        {scheduleBusyHarnessId === activeHarness?.id
                          ? "Saving..."
                          : getEditingScheduleId(activeHarness?.id ?? "")
                            ? "Update Schedule"
                            : "Save Schedule"}
                      </button>
                      {activeHarness && getEditingScheduleId(activeHarness.id) ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setEditingScheduleIdByHarness((current) => ({ ...current, [activeHarness.id]: null }));
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: { title: "", prompt: "", intervalMinutes: 30 },
                            }));
                          }}
                        >
                          Cancel Edit
                        </button>
                      ) : null}

                      <ul className="automation-list">
                        {activeHarnessSchedules.map((schedule) => (
                          <li key={schedule.id}>
                            <strong>{schedule.title}</strong>
                            <small>next: {new Date(schedule.nextRunAt).toLocaleString()}</small>
                            <p>{schedule.prompt}</p>
                            <div className="automation-actions">
                              <span>{schedule.enabled ? "enabled" : "paused"} · every {schedule.intervalMinutes}m</span>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  if (!activeHarness) {
                                    return;
                                  }
                                  setEditingScheduleIdByHarness((current) => ({ ...current, [activeHarness.id]: schedule.id }));
                                  setScheduleDraftByHarness((current) => ({
                                    ...current,
                                    [activeHarness.id]: {
                                      title: schedule.title,
                                      prompt: schedule.prompt,
                                      intervalMinutes: schedule.intervalMinutes,
                                    },
                                  }));
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => activeHarness && void onToggleSchedule(activeHarness.id, schedule.id, !schedule.enabled)}
                              >
                                {schedule.enabled ? "Pause" : "Resume"}
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => activeHarness && void onDeleteSchedule(activeHarness.id, schedule.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                        {activeHarnessSchedules.length === 0 ? <li><small>No schedules yet.</small></li> : null}
                      </ul>
                    </div>
                  ) : null}

                  {activeHarnessSubTab === "runs" ? (
                    <div className="automation-panel">
                      <button
                        type="button"
                        onClick={() => activeHarness && void onManualRun(activeHarness.id)}
                        disabled={!activeHarness || manualRunBusyHarnessId === activeHarness.id}
                      >
                        {manualRunBusyHarnessId === activeHarness?.id ? "Running..." : "Run Now (uses Prompt)"}
                      </button>
                      <small>Manual run uses the prompt from the Scheduled tab draft.</small>

                      <ul className="automation-list">
                        {activeHarnessRuns.map((run) => (
                          <li key={run.id}>
                            <strong>{run.trigger} · {run.status}</strong>
                            <small>{new Date(run.createdAt).toLocaleString()}</small>
                            <p>{run.prompt}</p>
                            {run.output ? <details><summary>Output</summary><p>{run.output}</p></details> : null}
                            {run.error ? <p className="run-error">{run.error}</p> : null}
                          </li>
                        ))}
                        {activeHarnessRuns.length === 0 ? <li><small>No runs yet.</small></li> : null}
                      </ul>
                    </div>
                  ) : null}
                </aside>

                <div className="chat-main">
                  {activeHarnessSubTab !== "chats" ? (
                    <section className="chat-log" aria-live="polite">
                      <article className="message assistant">
                        <p>
                          {activeHarnessSubTab === "scheduled"
                            ? "Manage repeating jobs for this harness in the current workspace."
                            : "Inspect run history and execute manual runs."}
                        </p>
                      </article>
                    </section>
                  ) : (
                    <>
                  <header className="chat-status">
                    <div>
                      <strong>{activeHarness?.name ?? "Harness"}</strong>
                    </div>
                    <div className="status-chip-row">
                      <span className="chip">{chatBusy ? "thinking..." : "ready"}</span>
                      <span className="chip">fallback: {chatMeta?.fallbackUsed ? "yes" : "no"}</span>
                      <button
                        type="button"
                        className="ghost chip-button"
                        onClick={() => {
                          if (autoSpeakHarnessReplies) {
                            stopHarnessSpeech();
                          }
                          setAutoSpeakHarnessReplies((current) => !current);
                        }}
                      >
                        voice: {autoSpeakHarnessReplies ? "on" : "off"}
                      </button>
                      <button
                        type="button"
                        className="ghost chip-button"
                        onClick={stopHarnessSpeech}
                        disabled={!harnessSpeaking}
                      >
                        stop voice
                      </button>
                      <button
                        type="button"
                        className="ghost chip-button"
                        onClick={() => {
                          setRightTab("diagnostics");
                          const card = document.getElementById("failed-tasks-card");
                          setTimeout(() => card?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
                        }}
                      >
                        failed tasks: {failedTasks.length}
                      </button>
                    </div>
                  </header>

                  <details className="stream-trace" open={streamTraceOpen} onToggle={(event) => setStreamTraceOpen((event.target as HTMLDetailsElement).open)}>
                    <summary>{chatBusy ? "Live stream" : "Last stream"}</summary>
                    <pre>{streamTrace || (chatBusy ? "Waiting for first token..." : "No recent stream content.")}</pre>
                  </details>

                  <section className="chat-log" aria-live="polite">
                    {messages.length === 0 ? (
                      <article className="message assistant">
                        <p>Send a prompt to start your unified harness session.</p>
                      </article>
                    ) : null}

                    {messages.map((message) => (
                      <article key={message.id} className={`message ${message.role}`}>
                        <header>{message.role}</header>
                        {message.role === "assistant" && chatBusy && !message.content ? (
                          <p className="typing-indicator">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                          </p>
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        )}
                        {message.role === "assistant" && message.id === lastAssistantMessageId && chatMeta ? (
                          <small className="message-meta">
                            {chatMeta.provider} | {chatMeta.model} | {chatMeta.elapsedMs} ms | tokens {(chatMeta.tokenUsage.input ?? 0) + (chatMeta.tokenUsage.output ?? 0)}
                          </small>
                        ) : null}
                        {message.role === "user" ? (
                          <div className="message-actions">
                            <button
                              type="button"
                              className="ghost icon-btn"
                              onClick={() => void onSendMessage(message.content)}
                              disabled={chatBusy}
                              title="Retry this prompt"
                              aria-label="Retry this prompt"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M12 5a7 7 0 1 1-6.95 7.88h2.04A5 5 0 1 0 12 7h-2.2l2.7 2.7-1.4 1.4L6 6l5.1-5.1 1.4 1.4L9.8 5H12z" fill="currentColor" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="ghost icon-btn"
                              onClick={() => void onCopyMessage(message.content)}
                              title="Copy message"
                              aria-label="Copy message"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16h-9V7h9v14z" fill="currentColor" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                        {message.role === "assistant" ? (
                          <div className="message-actions">
                            <button
                              type="button"
                              className="ghost icon-btn"
                              onClick={stopHarnessSpeech}
                              title="Stop voice playback"
                              aria-label="Stop voice playback"
                              disabled={!harnessSpeaking}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M5 9v6h4l5 5V4L9 9H5zm12.5 3a4.5 4.5 0 0 0-2.2-3.85v7.7A4.5 4.5 0 0 0 17.5 12z" fill="currentColor" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </section>

                  <footer className="chat-composer">
                    <textarea
                      value={composer}
                      onChange={(event) => setComposer(event.target.value)}
                      placeholder="Ask your selected harness..."
                      rows={4}
                    />
                    <div className="composer-actions">
                      <button type="button" className="ghost" disabled>
                        Mic (STT)
                      </button>
                      <button type="button" className="ghost" disabled>
                        Upload
                      </button>
                      {chatBusy ? (
                        <button type="button" className="stop-btn" onClick={() => void onStopStream()}>
                          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                            <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
                          </svg>
                          Stop
                        </button>
                      ) : (
                        <button type="button" onClick={() => void onSendMessage()} disabled={!composer.trim()}>
                          Send
                        </button>
                      )}
                    </div>
                  </footer>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="pane pane-right">
          <div className="pane-right-header">
            <button
              type="button"
              className={`tab-btn ${rightTab === "workspace" ? "active" : ""}`}
              onClick={() => setRightTab("workspace")}
            >
              Workspace
            </button>
            <button
              type="button"
              className={`tab-btn ${rightTab === "diagnostics" ? "active" : ""}`}
              onClick={() => setRightTab("diagnostics")}
            >
              Diagnostics
              {diagnosticsAlertCount > 0 ? <span className="tab-alert" aria-label="Diagnostics alerts">!</span> : null}
            </button>
          </div>

          {rightTab === "workspace" ? (
            <>
              <label className="workspace-switcher">
                Active Workspace
                <select
                  value={boot?.activeWorkspaceId ?? "default"}
                  onChange={(event) => void onSwitchWorkspace(event.target.value)}
                >
                  {boot?.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>

              <form className="workspace-create" onSubmit={(event) => void onCreateWorkspace(event)}>
                <input
                  type="text"
                  value={createWorkspaceName}
                  placeholder="new workspace name"
                  onChange={(event) => setCreateWorkspaceName(event.target.value)}
                />
                <button type="button" className="ghost" onClick={() => void openWorkspaceBrowser()}>
                  Browse Folder
                </button>
                <button type="submit">Create</button>
              </form>

              {workspacePathDraft ? (
                <small className="workspace-path-draft">Using folder: {workspacePathDraft}</small>
              ) : (
                <small className="workspace-path-draft">No folder selected: workspace will be created in default Nexus workspace storage.</small>
              )}

              {workspaceBrowserOpen ? (
                <section className="workspace-browser" aria-live="polite">
                  <div className="workspace-browser-header">
                    <strong>Select Workspace Folder</strong>
                    <button type="button" className="ghost" onClick={closeWorkspaceBrowser}>Close</button>
                  </div>

                  {workspaceBrowsePath ? (
                    <>
                      <small>Current: {workspaceBrowsePath}</small>
                      <div className="workspace-browser-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => workspaceBrowseParentPath && void browseWorkspacePath(workspaceBrowseParentPath)}
                          disabled={!workspaceBrowseParentPath || workspaceBrowseBusy}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWorkspacePathDraft(workspaceBrowsePath);
                            closeWorkspaceBrowser();
                          }}
                          disabled={workspaceBrowseBusy}
                        >
                          Use This Folder
                        </button>
                      </div>
                    </>
                  ) : null}

                  {!workspaceBrowsePath ? (
                    <ul className="workspace-root-list">
                      {workspaceRoots.map((root) => (
                        <li key={root}>
                          <button type="button" className="ghost" onClick={() => void browseWorkspacePath(root)}>{root}</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="workspace-folder-list">
                      {workspaceBrowseFolders.map((folder) => (
                        <li key={folder.path}>
                          <button type="button" className="ghost" onClick={() => void browseWorkspacePath(folder.path)}>
                            {folder.name}
                          </button>
                        </li>
                      ))}
                      {workspaceBrowseFolders.length === 0 ? <li><small>No subfolders found.</small></li> : null}
                    </ul>
                  )}
                </section>
              ) : null}

              <ul className="workspace-list">
                {boot?.workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <div>
                      <strong>{workspace.name}</strong>
                      <small>{formatBytes(workspace.sizeBytes)} | active agents: {workspace.activeHarnesses.length}</small>
                      <small>{workspace.path}</small>
                    </div>
                    <button type="button" className="ghost" onClick={() => void onDeleteWorkspace(workspace.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>

              <section className="tree-panel">
                <div className="tree-panel-head">
                  <h3>File Tree</h3>
                  <button type="button" className="ghost" onClick={() => void openActiveWorkspaceFolder()}>
                    Open Folder
                  </button>
                </div>
                {workspaceTree ? <ul className="tree-root">{renderTree(workspaceTree)}</ul> : <p>Loading workspace tree...</p>}
              </section>
            </>
          ) : null}

          {rightTab === "diagnostics" ? (
            <>
              <section className="startup-panel">
                <h3>Startup Readiness</h3>
                <small>
                  live harnesses: {boot?.startup.liveHarnesses ?? 0}/{boot?.startup.totalHarnesses ?? 0}
                </small>
                {lastStartupCheck ? (() => {
                  const { label, ageClass } = formatCheckAge(lastStartupCheck.timestamp);
                  return (
                    <small className="startup-history">
                      <span className={ageClass}>last check: {label}</span>
                      {lastStartupCheck.readiness.ready ? (
                        <span className="badge-ok"> ✓ READY</span>
                      ) : (
                        <span className="badge-blocked"> ! BLOCKED</span>
                      )}
                    </small>
                  );
                })() : null}
                <button type="button" className="ghost" onClick={() => void onRunStartupCheck()} disabled={startupChecking}>
                  {startupChecking ? "Checking..." : "Run Startup Check"}
                </button>
              </section>

              <section id="failed-tasks-card" className="failed-tasks-panel">
                <div className="failed-tasks-header">
                  <h3>Failed Tasks</h3>
                  <button type="button" className="ghost" onClick={() => void loadFailedTasks()}>
                    Refresh
                  </button>
                </div>

                {failedTasks.length === 0 ? <p className="diagnostics-empty">No resumable failures.</p> : null}

                <ul className="failed-task-list">
                  {failedTasks.slice(0, 5).map((task) => (
                    <li key={task.requestId}>
                      <div>
                        <strong>{task.harnessId}</strong>
                        <small>{new Date(task.updatedAt).toLocaleString()}</small>
                        <small>{task.error ?? "stream interrupted"}</small>
                      </div>
                      <div className="failed-task-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setExpandedTaskId((current) => (current === task.requestId ? null : task.requestId))}
                        >
                          {expandedTaskId === task.requestId ? "Hide" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onResumeTask(task)}
                          disabled={resumeBusyId === task.requestId}
                        >
                          {resumeBusyId === task.requestId ? "Resuming..." : "Resume"}
                        </button>
                      </div>
                      {expandedTaskId === task.requestId ? (
                        <pre className="failed-task-preview">{task.partialOutput || "No partial output"}</pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default App;
