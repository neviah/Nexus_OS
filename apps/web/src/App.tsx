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

type RouterProbe = {
  origin: string;
  dashboardUrl: string;
  reachable: boolean;
  checks: Array<{ url: string; ok: boolean; status?: number; error?: string }>;
  checkedAt: string;
};

const initialRouterForm = {
  apiKey: "",
  baseUrl: "http://localhost:20128/v1",
  defaultModel: "deepseek-v3",
  fallbackOrder: "deepseek-v3, qwen-2.5-72b, claude-3.5-sonnet",
};

function App() {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [selectedPane, setSelectedPane] = useState<PaneSelection>({ type: "tool", id: "9router" });
  const [routerForm, setRouterForm] = useState(initialRouterForm);
  const [routerSaving, setRouterSaving] = useState(false);
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
  const [routerFrameRefresh, setRouterFrameRefresh] = useState(0);
  const [routerProbe, setRouterProbe] = useState<RouterProbe | null>(null);
  const [routerProbeLoading, setRouterProbeLoading] = useState(false);

  const activeHarness = useMemo(
    () => boot?.harnesses.find((harness) => harness.id === selectedPane.id) ?? null,
    [boot, selectedPane.id],
  );

  const loadBootstrap = useCallback(async () => {
    const response = await fetch("/api/bootstrap");
    const payload = (await response.json()) as BootstrapPayload;
    setBoot(payload);
    setRouterForm((current) => ({
      ...current,
      baseUrl: payload.router9.baseUrl || current.baseUrl,
      defaultModel: payload.router9.defaultModel || current.defaultModel,
      fallbackOrder: payload.router9.fallbackOrder.join(", "),
    }));

    const preferredPane: PaneSelection = payload.onboardingRequired
      ? { type: "tool", id: "9router" }
      : payload.selectedPane;
    setSelectedPane(preferredPane);
    await loadWorkspaceTree(payload.activeWorkspaceId);
    await loadFailedTasks();
    await loadLastStartupCheck();
    await loadRouterProbe();
    setStatusMessage(payload.onboardingRequired ? "First run detected: Configure 9router endpoint to unlock harnesses." : "Ready");
  }, []);

  async function loadRouterProbe() {
    setRouterProbeLoading(true);
    try {
      const response = await fetch("/api/tools/9router/probe");
      if (!response.ok) {
        setRouterProbe(null);
        return;
      }
      const payload = (await response.json()) as RouterProbe;
      setRouterProbe(payload);
    } catch {
      setRouterProbe(null);
    } finally {
      setRouterProbeLoading(false);
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
    if (selectedPane.type === "tool" && selectedPane.id === "9router") {
      void loadRouterProbe();
    }
  }, [selectedPane]);

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

  async function onSaveRouterConfig(event: FormEvent) {
    event.preventDefault();
    setRouterSaving(true);
    setStatusMessage("Saving 9router configuration...");

    const fallbackOrder = routerForm.fallbackOrder
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    const response = await fetch("/api/tools/9router/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: routerForm.apiKey,
        baseUrl: routerForm.baseUrl,
        defaultModel: routerForm.defaultModel,
        fallbackOrder,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error: string };
      setStatusMessage(payload.error);
      setRouterSaving(false);
      return;
    }

    await loadBootstrap();
    setSelectedPane({ type: "agent", id: "hermes" });
    setStatusMessage("9router configured. Harness routing is live.");
    setRouterSaving(false);
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
    setStatusMessage(`Routing ${activeHarness.name} via 9router...`);
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
  const routerDashboardUrl = routerProbe?.dashboardUrl
    ?? getRouterDashboardUrl(routerForm.baseUrl || boot?.router9.baseUrl || initialRouterForm.baseUrl);
  const routerRootUrl = routerProbe?.origin ?? getRouterOrigin(routerForm.baseUrl || boot?.router9.baseUrl || initialRouterForm.baseUrl);

  return (
    <main className="app-shell">
      <div className="orb orb-left" />
      <div className="orb orb-right" />

      {onboardingRequired ? (
        <section className="first-run-banner">
          <strong>First launch checkpoint:</strong> Configure 9router endpoint to unlock all harness routing.
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
              {boot?.tools.map((tool) => {
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
          {selectedPane.type === "tool" && selectedPane.id === "9router" ? (
            <div className="tool-view">
              <h2>9router Dashboard</h2>
              <p className="subtitle">Connect providers directly in 9router. NexusOS uses it as the shared fallback router.</p>

              <form className="router-form router-toolbar" onSubmit={(event) => void onSaveRouterConfig(event)}>
                <label>
                  9router API Key (optional)
                  <input
                    type="password"
                    value={routerForm.apiKey}
                    placeholder="Paste dashboard key if requireApiKey is enabled"
                    onChange={(event) => setRouterForm((current) => ({ ...current, apiKey: event.target.value }))}
                  />
                </label>

                <label>
                  Base URL
                  <input
                    required
                    type="text"
                    value={routerForm.baseUrl}
                    onChange={(event) => setRouterForm((current) => ({ ...current, baseUrl: event.target.value }))}
                  />
                </label>

                <button type="submit" disabled={routerSaving}>
                  {routerSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    window.open(routerDashboardUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  Open Tab
                </button>
                <button type="button" className="ghost" onClick={() => setRouterFrameRefresh((current) => current + 1)}>
                  Reload
                </button>
                <button type="button" className="ghost" onClick={() => void loadRouterProbe()} disabled={routerProbeLoading}>
                  {routerProbeLoading ? "Checking..." : "Probe"}
                </button>
              </form>

              <p className="router-hint">
                Local default endpoint is http://localhost:20128/v1. Use the embedded dashboard below to connect free or API-key providers.
              </p>

              {routerProbe && !routerProbe.reachable ? (
                <section className="router-unavailable">
                  <h3>9router dashboard not reachable</h3>
                  <p>
                    Checked: {routerProbe.checks.map((entry) => `${entry.url} (${entry.status ?? entry.error ?? "failed"})`).join(" | ")}
                  </p>
                  <div className="router-unavailable-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        window.open(routerDashboardUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Open /dashboard
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        window.open(routerRootUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Open Root
                    </button>
                  </div>
                </section>
              ) : (
                <div className="router-embed-wrap">
                  <iframe
                    key={`${routerFrameRefresh}-${routerDashboardUrl}`}
                    className="router-embed"
                    src={routerDashboardUrl}
                    title="9router Dashboard"
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id !== "9router" ? (
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
                    model: {chatMeta?.model ?? boot?.router9.defaultModel} | provider: {chatMeta?.provider ?? "9router"}
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

function getRouterDashboardUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.origin}/dashboard`;
  } catch {
    return "http://localhost:20128/dashboard";
  }
}

function getRouterOrigin(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return parsed.origin;
  } catch {
    return "http://localhost:20128";
  }
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
