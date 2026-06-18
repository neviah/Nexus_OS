import express from "express";
import cors from "cors";
import {
  buildWorkspaceTree,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "./lib/workspaceManager.js";
import { readHarnessRegistry, resolveHarnessHealth } from "./lib/harnessRegistry.js";
import { readSystemState, writeSystemState } from "./lib/stateStore.js";
import { getRouterSummary } from "./lib/routerStatus.js";
import type { ChatMessage } from "./types.js";
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

const app = express();
const port = Number(process.env.PORT ?? 8080);
const activeStreams = new Map<string, AbortController>();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nexus-os-api" });
});

app.get("/api/bootstrap", async (_req, res) => {
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const harnessStatus = await resolveHarnessHealth(harnesses);
  const workspaces = await listWorkspaces({
    [state.activeWorkspaceId]: harnessStatus.filter((h) => h.status === "online").map((h) => h.id),
  });

  res.json({
    appName: "NEXUS OS",
    onboardingRequired: !state.onboardingComplete,
    selectedPane: state.selectedPane,
    activeWorkspaceId: state.activeWorkspaceId,
    harnesses: harnessStatus,
    tools: [
      {
        id: "9router",
        name: "9router",
        status: state.router9.apiKey ? "online" : "setup-required",
      },
      { id: "image-generator", name: "Image Generator", status: "offline" },
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

app.get("/api/harnesses/conformance", async (_req, res) => {
  const harnesses = await readHarnessRegistry();
  const results = await runHarnessConformance(harnesses);
  res.json({ results });
});

app.get("/api/tools/9router/status", async (_req, res) => {
  const state = await readSystemState();
  res.json(getRouterSummary(state));
});

app.post("/api/tools/9router/config", async (req, res) => {
  const { apiKey, baseUrl, defaultModel, fallbackOrder } = req.body as {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    fallbackOrder?: string[];
  };

  if (!apiKey || apiKey.trim().length < 8) {
    return res.status(400).json({ error: "A valid 9router API key is required." });
  }

  const state = await readSystemState();
  state.router9.apiKey = apiKey.trim();
  state.router9.baseUrl = baseUrl?.trim() || state.router9.baseUrl;
  state.router9.defaultModel = defaultModel?.trim() || state.router9.defaultModel;
  state.router9.fallbackOrder = Array.isArray(fallbackOrder) && fallbackOrder.length > 0
    ? fallbackOrder
    : state.router9.fallbackOrder;
  state.onboardingComplete = true;
  state.selectedPane = { type: "agent", id: "hermes" };
  state.router9.logs.unshift({
    timestamp: new Date().toISOString(),
    level: "info",
    message: "9router configured successfully. Provider routing is now enabled.",
  });

  await writeSystemState(state);
  return res.json({ ok: true, router9: getRouterSummary(state) });
});

app.get("/api/workspaces", async (_req, res) => {
  const state = await readSystemState();
  const harnesses = await readHarnessRegistry();
  const records = await listWorkspaces({
    [state.activeWorkspaceId]: harnesses.map((h) => h.id),
  });
  res.json({
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: records,
  });
});

app.post("/api/workspaces", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: "Workspace name must be at least 2 characters." });
  }

  await createWorkspace(name);
  return res.json({ ok: true });
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

  const state = await readSystemState();
  state.activeWorkspaceId = id;
  await writeSystemState(state);
  return res.json({ ok: true });
});

app.get("/api/workspaces/:id/tree", async (req, res) => {
  const { id } = req.params;
  const tree = await buildWorkspaceTree(id);
  return res.json({ tree });
});

app.post("/api/chat", async (req, res) => {
  const { harnessId, message, history, requestId } = req.body as {
    harnessId: string;
    message: string;
    history?: ChatMessage[];
    requestId?: string;
  };

  const state = await readSystemState();
  const safeHistory = history ?? [];
  const harnesses = await readHarnessRegistry();
  const harness = harnesses.find((entry) => entry.id === harnessId);
  const taskId = requestId ?? crypto.randomUUID();

  if (!state.onboardingComplete) {
    return res.status(412).json({
      error: "Complete 9router setup before starting chats.",
    });
  }

  if (!harness) {
    return res.status(404).json({ error: `Unknown harness: ${harnessId}` });
  }

  await createTask({
    requestId: taskId,
    harnessId,
    workspaceId: state.activeWorkspaceId,
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
    });
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
  const resumed = await invokeHarness({
    harness,
    message: replayPrompt,
    history: task.history,
    state,
  });

  await updateTaskStatus(requestId, "completed", {
    finalOutput: `${task.partialOutput}${resumed.content}`,
    meta: resumed.meta,
  });

  return res.json({
    requestId,
    resumed: true,
    content: resumed.content,
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
  const safeHistory = history ?? [];
  const harnesses = await readHarnessRegistry();
  const harness = harnesses.find((entry) => entry.id === harnessId);

  if (!state.onboardingComplete) {
    return res.status(412).json({ error: "Complete 9router setup before starting chats." });
  }

  if (!harness) {
    return res.status(404).json({ error: `Unknown harness: ${harnessId}` });
  }

  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  await createTask({
    requestId,
    harnessId,
    workspaceId: state.activeWorkspaceId,
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

    await updateTaskStatus(requestId, controller.signal.aborted ? "aborted" : "completed", {
      finalOutput: output,
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
        });

        await appendTaskOutput(requestId, resumed.content);
        await updateTaskStatus(requestId, "completed", {
          finalOutput: `${replayTask.partialOutput}${resumed.content}`,
          meta: resumed.meta,
        });

        res.write(`data: ${JSON.stringify({ type: "meta", meta: { ...resumed.meta, fallbackUsed: true } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "delta", text: resumed.content })}\n\n`);
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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`NEXUS OS API running on http://localhost:${port}`);
});