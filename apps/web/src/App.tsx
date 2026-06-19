import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMeta, setChatMeta] = useState<ChatMeta | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [lastUserPrompt, setLastUserPrompt] = useState<string>("");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [failedTasks, setFailedTasks] = useState<FailedTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [statusMessage, setStatusMessage] = useState("Booting NEXUS OS...");
  const [toolsOpen, setToolsOpen] = useState(true);
  const [startupChecking, setStartupChecking] = useState(false);
  const [lastStartupCheck, setLastStartupCheck] = useState<{ readiness: StartupReadiness; timestamp: string } | null>(null);
  const [rightTab, setRightTab] = useState<"workspace" | "diagnostics">("workspace");

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

  const activeHarness = useMemo(
    () => boot?.harnesses.find((harness) => harness.id === selectedPane.id) ?? null,
    [boot, selectedPane.id],
  );

  const fallbackChoiceOptions = useMemo(
    () => nxFallbackRows
      .filter((row) => row.providerId && row.model)
      .map((row) => `${row.providerId}::${row.model}`),
    [nxFallbackRows],
  );

  const fallbackChoiceSet = useMemo(() => new Set(fallbackChoiceOptions), [fallbackChoiceOptions]);

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

    const nextHistory = [...messages, userMessage];
    setMessages([...nextHistory, assistantPlaceholder]);
    setLastUserPrompt(textToSend);
    setComposer("");
    setChatBusy(true);
    setChatMeta(null);
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
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setStatusMessage("Unable to stream response");
      setChatBusy(false);
      setActiveRequestId(null);
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
          setChatMeta(envelope.meta);
          continue;
        }

        if (envelope.type === "delta") {
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantPlaceholder.id
                ? { ...entry, content: `${entry.content}${envelope.text}` }
                : entry,
            ),
          );
          continue;
        }

        if (envelope.type === "error") {
          setStatusMessage(envelope.message);
          continue;
        }

        if (envelope.type === "done") {
          setChatBusy(false);
          setActiveRequestId(null);
          setStatusMessage("Ready");
        }
      }
    }

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

  async function onResend() {
    if (!lastUserPrompt || chatBusy) {
      return;
    }
    await onSendMessage(lastUserPrompt);
  }

  async function onCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (createWorkspaceName.trim().length < 2) {
      return;
    }
    await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: createWorkspaceName.trim() }),
    });
    setCreateWorkspaceName("");
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

    setMessages([userMessage, assistantMessage]);
    setChatMeta(payload.meta);
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
                      setMessages([]);
                    }}
                  >
                    <span className={`health ${harness.health}`} />
                    <span className="meta-block">
                      <strong>{harness.name}</strong>
                      <small>{harness.status} | {harness.defaultModel}</small>
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
              {nxProviders.length > 0 ? (
                <section className="nxr-section">
                  <h3>Connected Providers</h3>
                  <ul className="nxr-provider-list">
                    {nxProviders.map((provider) => (
                      <li key={provider.id}>
                        <div className="nxr-provider-row">
                          <span className={`health ${provider.enabled ? "healthy" : "offline"}`} />
                          <div>
                            <strong>{provider.name}</strong>
                            <small>{provider.id} · {provider.maskedApiKey || "(no key)"} · {provider.models?.length ?? 0} models{provider.lastSyncedAt ? ` · synced ${new Date(provider.lastSyncedAt).toLocaleTimeString()}` : ""}</small>
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
                        {provider.models && provider.models.length > 0 ? (
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
                    const modelOptions = nxModelOptionsByProvider[row.providerId] ?? [];
                    return (
                      <div key={row.id} className="nxr-fallback-row">
                        <select
                          value={row.providerId}
                          onChange={(event) => {
                            const providerId = event.target.value;
                            setNxFallbackRows((rows) => rows.map((entry) => entry.id === row.id ? { ...entry, providerId, model: "" } : entry));
                            if (providerId && (nxModelOptionsByProvider[providerId]?.length ?? 0) === 0) {
                              void nxSyncModels(providerId);
                            }
                          }}
                        >
                          <option value="">Select provider</option>
                          {nxProviders.filter((provider) => provider.enabled).map((provider) => (
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

          {selectedPane.type === "tool" && selectedPane.id !== "nexus-router" ? (
            <div className="placeholder-view">
              <h2>{boot?.tools.find((tool) => tool.id === selectedPane.id)?.name ?? "Tool"}</h2>
              <p>Tool plugin slot ready. Hook this panel to a future backend module.</p>
            </div>
          ) : null}

          {selectedPane.type === "agent" ? (
            <div className="chat-view">
              <header className="chat-status">
                <div>
                  <strong>{activeHarness?.name ?? "Harness"}</strong>
                  <small>
                    model: {chatMeta?.model ?? "auto"} | provider: {chatMeta?.provider ?? "nexus-router"}
                  </small>
                </div>
                <div className="status-chip-row">
                  <span className="chip">fallback: {chatMeta?.fallbackUsed ? "yes" : "no"}</span>
                  <span className="chip">time: {chatMeta?.elapsedMs ?? 0} ms</span>
                  <span className="chip">tokens: {(chatMeta?.tokenUsage.input ?? 0) + (chatMeta?.tokenUsage.output ?? 0)}</span>
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
                  <button type="button" className="ghost chip-button" onClick={() => void onStopStream()} disabled={!chatBusy}>
                    Stop
                  </button>
                  <button type="button" className="ghost chip-button" onClick={() => void onResend()} disabled={chatBusy || !lastUserPrompt}>
                    Resend
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
                  <button type="button" onClick={() => void onSendMessage()} disabled={!composer.trim() || chatBusy}>
                    {chatBusy ? "Thinking..." : "Send"}
                  </button>
                </div>
              </footer>
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
                <button type="submit">Create</button>
              </form>

              <ul className="workspace-list">
                {boot?.workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <div>
                      <strong>{workspace.name}</strong>
                      <small>{formatBytes(workspace.sizeBytes)} | active agents: {workspace.activeHarnesses.length}</small>
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
