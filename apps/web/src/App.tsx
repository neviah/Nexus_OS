import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

type BootstrapPayload = {
  appName: string;
  onboardingRequired: boolean;
  selectedPane: PaneSelection;
  activeWorkspaceId: string;
  harnesses: Harness[];
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

const initialRouterForm = {
  apiKey: "",
  baseUrl: "https://api.9router.io/v1",
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
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [statusMessage, setStatusMessage] = useState("Booting NEXUS OS...");
  const [toolsOpen, setToolsOpen] = useState(true);

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
    setStatusMessage(payload.onboardingRequired ? "First run detected: Configure 9router to unlock harnesses." : "Ready");
  }, []);

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

  async function onSendMessage() {
    if (!activeHarness || !composer.trim() || chatBusy) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: composer.trim(),
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setComposer("");
    setChatBusy(true);
    setStatusMessage(`Routing ${activeHarness.name} via 9router...`);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        harnessId: activeHarness.id,
        message: userMessage.content,
        history: nextHistory,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Chat request failed");
      setChatBusy(false);
      return;
    }

    const payload = (await response.json()) as { message: ChatMessage; meta: ChatMeta };
    setMessages((current) => [...current, payload.message]);
    setChatMeta(payload.meta);
    setChatBusy(false);
    setStatusMessage("Ready");
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

  function renderTree(node: WorkspaceTreeNode): ReactElement {
    return (
      <li key={node.path} className={`tree-node ${node.type}`}>
        <span>{node.name}</span>
        {node.children && node.children.length > 0 ? <ul>{node.children.map(renderTree)}</ul> : null}
      </li>
    );
  }

  const onboardingRequired = boot?.onboardingRequired ?? true;

  return (
    <main className="app-shell">
      <div className="orb orb-left" />
      <div className="orb orb-right" />

      <header className="topbar">
        <div>
          <p className="kicker">Agentic Operating System</p>
          <h1>NEXUS OS</h1>
        </div>
        <div className="topbar-status">{statusMessage}</div>
      </header>

      {onboardingRequired ? (
        <section className="first-run-banner">
          <strong>First launch checkpoint:</strong> Configure 9router API key to unlock all harness routing.
        </section>
      ) : null}

      <section className="pane-grid">
        <aside className="pane pane-left">
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
              <h2>9router Integration Layer</h2>
              <p className="subtitle">Configure provider routing once. Harnesses inherit this transport automatically.</p>

              <form className="router-form" onSubmit={(event) => void onSaveRouterConfig(event)}>
                <label>
                  9router API Key
                  <input
                    required
                    type="password"
                    value={routerForm.apiKey}
                    placeholder="Enter API key"
                    onChange={(event) => setRouterForm((current) => ({ ...current, apiKey: event.target.value }))}
                  />
                </label>

                <label>
                  Base URL
                  <input
                    type="text"
                    value={routerForm.baseUrl}
                    onChange={(event) => setRouterForm((current) => ({ ...current, baseUrl: event.target.value }))}
                  />
                </label>

                <label>
                  Default Model
                  <input
                    type="text"
                    value={routerForm.defaultModel}
                    onChange={(event) => setRouterForm((current) => ({ ...current, defaultModel: event.target.value }))}
                  />
                </label>

                <label>
                  Fallback Order (comma-separated)
                  <input
                    type="text"
                    value={routerForm.fallbackOrder}
                    onChange={(event) => setRouterForm((current) => ({ ...current, fallbackOrder: event.target.value }))}
                  />
                </label>

                <button type="submit" disabled={routerSaving}>
                  {routerSaving ? "Saving..." : "Save 9router Settings"}
                </button>
              </form>

              <div className="router-panels">
                <article>
                  <h3>Providers</h3>
                  <ul>
                    {boot?.router9.providers.map((provider) => (
                      <li key={provider.id}>
                        <span className={`health ${provider.health}`} />
                        {provider.name} ({provider.latencyMs} ms)
                      </li>
                    ))}
                  </ul>
                </article>
                <article>
                  <h3>Routing Logs</h3>
                  <ul className="logs">
                    {boot?.router9.logs.slice(0, 8).map((log) => (
                      <li key={`${log.timestamp}-${log.message}`}>
                        <strong>{log.level.toUpperCase()}</strong> {log.message}
                      </li>
                    ))}
                  </ul>
                </article>
              </div>
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
          <h2>Workspace</h2>

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
