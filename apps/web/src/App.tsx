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

type VoiceStatus = {
  piperInstalled: boolean;
  piperPath: string | null;
  browserSpeechRecommended: boolean;
  notes: string[];
  scannedAt: string;
};

type RuntimeStatus = {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaModels: string[];
  piperInstalled: boolean;
  piperPath: string | null;
  piperVoices: string[];
  defaultVoiceInstalled: boolean;
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

function App() {
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
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceText, setVoiceText] = useState("Nexus OS voice check. This is your text to speech tool.");
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeBusyAction, setRuntimeBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Booting NEXUS OS...");
  const [toolsOpen, setToolsOpen] = useState(true);
  const [startupChecking, setStartupChecking] = useState(false);
  const [lastStartupCheck, setLastStartupCheck] = useState<{ readiness: StartupReadiness; timestamp: string } | null>(null);
  const [rightTab, setRightTab] = useState<"workspace" | "diagnostics">("workspace");
  
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
    await loadRuntimeStatus();
    setVoiceBusy(false);
  }

  async function runRuntimeAction(actionId: string, request: () => Promise<Response>, successMessage: string) {
    setRuntimeBusyAction(actionId);
    const response = await request();
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Runtime action failed");
      setRuntimeBusyAction(null);
      return;
    }

    await Promise.all([loadRuntimeStatus(), loadCookbookSnapshot(), loadVoiceStatus()]);
    setStatusMessage(successMessage);
    setRuntimeBusyAction(null);
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
          body: JSON.stringify({ text }),
        });

        if (response.ok) {
          const payload = (await response.json()) as { audioBase64: string; mimeType: string };
          const byteChars = atob(payload.audioBase64);
          const bytes = new Uint8Array(byteChars.length);
          for (let index = 0; index < byteChars.length; index += 1) {
            bytes[index] = byteChars.charCodeAt(index);
          }
          const blob = new Blob([bytes], { type: payload.mimeType });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.onended = () => {
            URL.revokeObjectURL(url);
            setVoicePlaying(false);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            setVoicePlaying(false);
          };
          await audio.play();
          return;
        }
      }

      stopVoicePlayback();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setVoicePlaying(false);
      utterance.onerror = () => setVoicePlaying(false);
      setVoicePlaying(true);
      window.speechSynthesis.speak(utterance);
    })();
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

  function parseFallbackKey(value: string): NxFallbackTarget | null {
    const [providerId, ...rest] = value.split("::");
    const model = rest.join("::").trim();
    const trimmedProvider = providerId.trim();
    if (!trimmedProvider || !model) {
      return null;
    }
    return { providerId: trimmedProvider, model };
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
    }
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
    if (selectedPane.type === "agent") {
      void loadHarnessThreads(selectedPane.id);
      void loadHarnessSchedules(selectedPane.id);
      void loadHarnessRuns(selectedPane.id);
    }
    if (selectedPane.type === "tool" && selectedPane.id === "cookbook") {
      void loadCookbookSnapshot();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "voice-studio") {
      void loadVoiceStatus();
    }
  }, [selectedPane, boot?.activeWorkspaceId]);

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
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setStatusMessage("Unable to stream response");
      setChatBusy(false);
      setActiveRequestId(null);
      await saveHarnessThread(harnessId, threadSnapshot);
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
          continue;
        }

        if (envelope.type === "done") {
          await saveHarnessThread(harnessId, threadSnapshot);
          setChatBusy(false);
          setActiveRequestId(null);
          setStatusMessage("Ready");
        }
      }
    }

    await saveHarnessThread(harnessId, threadSnapshot);
    setChatBusy(false);
    setActiveRequestId(null);
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
              {boot?.tools.filter((tool) => tool.id !== "9router").map((tool) => {
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
                    <select
                      value={nxProviderForm.preset}
                      onChange={(event) => {
                        const preset = PRESET_PROVIDERS.find((p) => p.id === event.target.value) ?? PRESET_PROVIDERS[0];
                        setNxProviderForm((c) => ({ ...c, preset: preset.id, id: preset.id, name: preset.name, type: preset.type, baseUrl: preset.baseUrl, defaultModel: preset.defaultModel }));
                      }}
                    >
                      {PRESET_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
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
                  {nxFallbackRows.map((row) => {
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
                <button type="button" onClick={() => void nxSaveConfig()}>Save Fallback Config</button>
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

              {cookbookSnapshot ? (
                <>
                  <section className="tool-section">
                    <h3>Bundled runtimes</h3>
                    <div className="tool-action-row tool-wrap-row">
                      <button
                        type="button"
                        onClick={() => void runRuntimeAction(
                          "install-ollama",
                          () => fetch("/api/tools/runtimes/install", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ runtime: "ollama" }),
                          }),
                          "Ollama installed and started.",
                        )}
                        disabled={runtimeBusyAction !== null || runtimeStatus?.ollamaInstalled}
                      >
                        {runtimeStatus?.ollamaInstalled ? "Ollama Installed" : runtimeBusyAction === "install-ollama" ? "Installing Ollama..." : "Install Ollama"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void runRuntimeAction(
                          "start-ollama",
                          () => fetch("/api/tools/runtimes/ollama/start", { method: "POST" }),
                          "Ollama started.",
                        )}
                        disabled={runtimeBusyAction !== null || !runtimeStatus?.ollamaInstalled || runtimeStatus?.ollamaRunning}
                      >
                        {runtimeStatus?.ollamaRunning ? "Ollama Running" : runtimeBusyAction === "start-ollama" ? "Starting Ollama..." : "Start Ollama"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void runRuntimeAction(
                          "pull-qwen",
                          () => fetch("/api/tools/runtimes/ollama/pull", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model: "qwen2.5-coder:7b" }),
                          }),
                          "Qwen2.5 Coder 7B pulled into Ollama.",
                        )}
                        disabled={runtimeBusyAction !== null || !runtimeStatus?.ollamaInstalled}
                      >
                        {runtimeBusyAction === "pull-qwen" ? "Pulling Qwen2.5 Coder 7B..." : "Install Coding Fallback Model"}
                      </button>
                    </div>
                    <small>Installed Ollama models: {runtimeStatus?.ollamaModels.join(", ") || "none yet"}</small>
                    <small>Cookbook models: {cookbookSnapshot.installedModels.join(", ") || "none yet"}</small>
                  </section>

                  <section className="tool-card-grid">
                    <article className="tool-card">
                      <h3>Machine</h3>
                      <small>{cookbookSnapshot.machine.platform} · {cookbookSnapshot.machine.arch}</small>
                      <p>{cookbookSnapshot.machine.cpuModel}</p>
                      <small>{cookbookSnapshot.machine.logicalCores} logical cores</small>
                    </article>
                    <article className="tool-card">
                      <h3>Memory</h3>
                      <p>{cookbookSnapshot.machine.totalRamGb} GB total</p>
                      <small>{cookbookSnapshot.machine.freeRamGb} GB free now</small>
                    </article>
                    <article className="tool-card">
                      <h3>Storage</h3>
                      <p>{cookbookSnapshot.machine.freeDiskGb ?? "Unknown"} GB free</p>
                      <small>{cookbookSnapshot.workspace?.path ?? "No active workspace path"}</small>
                    </article>
                    <article className="tool-card">
                      <h3>Runtimes</h3>
                      <p>Ollama: {cookbookSnapshot.runtimes.ollamaInstalled ? "installed" : "missing"}</p>
                      <small>Piper: {cookbookSnapshot.runtimes.piperInstalled ? "installed" : "missing"}</small>
                    </article>
                  </section>

                  <section className="tool-section">
                    <h3>Detected GPUs</h3>
                    <ul className="tool-list">
                      {(cookbookSnapshot.machine.gpuNames.length > 0 ? cookbookSnapshot.machine.gpuNames : ["No dedicated GPU detected"]).map((gpu) => (
                        <li key={gpu}>{gpu}</li>
                      ))}
                    </ul>
                  </section>

                  <section className="tool-section">
                    <h3>Recommended local models</h3>
                    <ul className="recommendation-list">
                      {cookbookSnapshot.recommendations.map((item) => (
                        <li key={item.id}>
                          <div className="recommendation-head">
                            <strong>{item.name}</strong>
                            <span>{item.category} · {item.size} · {item.runtime}</span>
                          </div>
                          <p>{item.summary}</p>
                          <small>{item.fitReason}</small>
                          <small>{item.installHint}</small>
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
                  <button type="button" className="ghost" onClick={stopVoicePlayback} disabled={!voicePlaying}>
                    Stop
                  </button>
                </div>
              </section>

              {voiceStatus ? (
                <section className="tool-section">
                  <h3>Voice runtime setup</h3>
                  <div className="tool-action-row tool-wrap-row">
                    <button
                      type="button"
                      onClick={() => void runRuntimeAction(
                        "install-piper",
                        () => fetch("/api/tools/runtimes/install", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ runtime: "piper" }),
                        }),
                        "Piper installed.",
                      )}
                      disabled={runtimeBusyAction !== null || runtimeStatus?.piperInstalled}
                    >
                      {runtimeStatus?.piperInstalled ? "Piper Installed" : runtimeBusyAction === "install-piper" ? "Installing Piper..." : "Install Piper"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runRuntimeAction(
                        "install-piper-voice",
                        () => fetch("/api/tools/runtimes/install", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ runtime: "default-piper-voice" }),
                        }),
                        "Default Piper voice installed.",
                      )}
                      disabled={runtimeBusyAction !== null || !runtimeStatus?.piperInstalled || runtimeStatus?.defaultVoiceInstalled}
                    >
                      {runtimeStatus?.defaultVoiceInstalled ? "Default Voice Installed" : runtimeBusyAction === "install-piper-voice" ? "Installing Default Voice..." : "Install Default Voice"}
                    </button>
                  </div>
                  <small>Installed Piper voices: {runtimeStatus?.piperVoices.join(", ") || "none yet"}</small>
                </section>
              ) : null}

              {voiceStatus ? (
                <section className="tool-card-grid">
                  <article className="tool-card">
                    <h3>Browser speech</h3>
                    <p>{voiceStatus.browserSpeechRecommended ? "recommended now" : "unavailable"}</p>
                    <small>Runs immediately in the app UI with no install.</small>
                  </article>
                  <article className="tool-card">
                    <h3>Piper</h3>
                    <p>{voiceStatus.piperInstalled ? "installed" : "not detected"}</p>
                    <small>{voiceStatus.piperPath ?? "Install Piper later for offline voices and exportable audio files."}</small>
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

          {selectedPane.type === "tool" && !["nexus-router", "cookbook", "voice-studio"].includes(selectedPane.id) ? (
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
                      <span className="chip">fallback: {chatMeta?.fallbackUsed ? "yes" : "no"}</span>
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

                  <section className="chat-log" aria-live="polite">
                    {messages.length === 0 ? (
                      <article className="message assistant">
                        <p>Send a prompt to start your unified harness session.</p>
                      </article>
                    ) : null}

                    {messages.map((message) => (
                      <article key={message.id} className={`message ${message.role}`}>
                        <header>{message.role}</header>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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
                <h3>File Tree</h3>
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
