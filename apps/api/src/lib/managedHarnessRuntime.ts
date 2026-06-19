import express from "express";
import type { Server } from "node:http";
import type { ChatMessage, HarnessConfig } from "../types.js";
import { routeChatWithFallback } from "./nexusRouter.js";
import { readSystemState, writeSystemState } from "./stateStore.js";

type ManagedRuntimeStatus = {
  harnessId: string;
  endpoint: string;
  mode: "managed" | "external" | "failed";
  detail: string;
};

type ManagedRuntimeEntry = {
  status: ManagedRuntimeStatus;
  server?: Server;
};

const runtimeByHarness = new Map<string, ManagedRuntimeEntry>();

export function getManagedHarnessRuntimeStatus(): ManagedRuntimeStatus[] {
  return Array.from(runtimeByHarness.values()).map((entry) => entry.status);
}

export async function ensureManagedHarnesses(harnesses: HarnessConfig[]): Promise<ManagedRuntimeStatus[]> {
  const results: ManagedRuntimeStatus[] = [];

  for (const harness of harnesses) {
    const existing = runtimeByHarness.get(harness.id);
    if (existing) {
      results.push(existing.status);
      continue;
    }

    const status = await ensureOneHarness(harness);
    runtimeByHarness.set(harness.id, { status, server: status.mode === "managed" ? statusToServer.get(status) : undefined });
    results.push(status);
  }

  return results;
}

const statusToServer = new WeakMap<ManagedRuntimeStatus, Server>();

async function ensureOneHarness(harness: HarnessConfig): Promise<ManagedRuntimeStatus> {
  const parsed = parseEndpoint(harness.endpoint);
  if (!parsed) {
    return {
      harnessId: harness.id,
      endpoint: harness.endpoint,
      mode: "failed",
      detail: "Invalid endpoint URL",
    };
  }

  const healthPath = harness.adapter?.healthPath ?? "/health";
  const healthUrl = `${parsed.origin}${joinPath(parsed.basePath, healthPath)}`;

  if (await probeUrl(healthUrl, 900)) {
    return {
      harnessId: harness.id,
      endpoint: harness.endpoint,
      mode: "external",
      detail: `Using existing service at ${healthUrl}`,
    };
  }

  const app = createHarnessApp(harness, parsed.basePath);
  const listenResult = await listenServer(app, parsed.host, parsed.port);
  if (listenResult.ok && listenResult.server) {
    const status: ManagedRuntimeStatus = {
      harnessId: harness.id,
      endpoint: harness.endpoint,
      mode: "managed",
      detail: `Managed runtime started on ${parsed.host}:${parsed.port}`,
    };
    statusToServer.set(status, listenResult.server);
    return status;
  }

  if (listenResult.addressInUse && (await probeUrl(healthUrl, 900))) {
    return {
      harnessId: harness.id,
      endpoint: harness.endpoint,
      mode: "external",
      detail: `Port already in use; existing service responded at ${healthUrl}`,
    };
  }

  return {
    harnessId: harness.id,
    endpoint: harness.endpoint,
    mode: "failed",
    detail: listenResult.error ?? "Failed to start managed runtime",
  };
}

function createHarnessApp(harness: HarnessConfig, basePath: string) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const healthPath = harness.adapter?.healthPath ?? "/health";
  app.get(joinPath(basePath, healthPath), (_req, res) => {
    res.json({ ok: true, harnessId: harness.id, source: "managed" });
  });
  app.get(joinPath(basePath, "/health"), (_req, res) => {
    res.json({ ok: true, harnessId: harness.id, source: "managed" });
  });
  app.get(joinPath(basePath, "/healthz"), (_req, res) => {
    res.json({ ok: true, harnessId: harness.id, source: "managed" });
  });

  const genericPaths = harness.adapter?.genericPaths?.length ? harness.adapter.genericPaths : ["/api/chat", "/chat"];
  for (const path of genericPaths) {
    app.post(joinPath(basePath, path), async (req, res) => {
      try {
        const body = req.body as { model?: string; message?: string; history?: ChatMessage[]; messages?: Array<{ role: string; content: string }> };
        const messages = normalizeMessages(body.message ?? "", body.history, body.messages);
        const state = await readSystemState();
        const routed = await routeChatWithFallback(state, {
          harnessId: harness.id,
          model: body.model,
          messages,
        });
        await writeSystemState(state);

        return res.json({
          output: routed.content,
          content: routed.content,
          model: routed.model,
          provider: routed.providerId,
          attempts: routed.attempts,
        });
      } catch (error) {
        return res.status(502).json({ error: String(error) });
      }
    });
  }

  const openAiPath = harness.adapter?.openAiPath ?? "/v1/chat/completions";
  app.post(joinPath(basePath, openAiPath), async (req, res) => {
    try {
      const body = req.body as {
        model?: string;
        stream?: boolean;
        messages?: Array<{ role: string; content: string }>;
      };
      const state = await readSystemState();
      const routed = await routeChatWithFallback(state, {
        harnessId: harness.id,
        model: body.model,
        messages: normalizeMessages("", undefined, body.messages),
      });
      await writeSystemState(state);

      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        for (const token of chunkText(routed.content)) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      return res.json({
        id: crypto.randomUUID(),
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: routed.content } }],
      });
    } catch (error) {
      return res.status(502).json({ error: String(error) });
    }
  });

  const streamPath = harness.adapter?.streamPath ?? "/api/chat/stream";
  app.post(joinPath(basePath, streamPath), async (req, res) => {
    try {
      const body = req.body as { model?: string; message?: string; history?: ChatMessage[]; messages?: Array<{ role: string; content: string }> };
      const messages = normalizeMessages(body.message ?? "", body.history, body.messages);
      const state = await readSystemState();
      const routed = await routeChatWithFallback(state, {
        harnessId: harness.id,
        model: body.model,
        messages,
      });
      await writeSystemState(state);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for (const token of chunkText(routed.content)) {
        res.write(`data: ${JSON.stringify({ delta: token })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    } catch (error) {
      return res.status(502).json({ error: String(error) });
    }
  });

  return app;
}

function normalizeMessages(
  message: string,
  history?: ChatMessage[],
  messages?: Array<{ role: string; content: string }>,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .map((entry) => ({ role: normalizeRole(entry.role), content: String(entry.content ?? "") }))
      .filter((entry) => entry.content.trim().length > 0);
  }

  const normalizedHistory = (history ?? []).map((entry) => ({
    role: normalizeRole(entry.role),
    content: String(entry.content ?? ""),
  }));

  const prompt = String(message ?? "").trim();
  if (prompt) {
    const last = normalizedHistory[normalizedHistory.length - 1];
    if (!last || last.role !== "user" || last.content !== prompt) {
      normalizedHistory.push({ role: "user", content: prompt });
    }
  }

  if (normalizedHistory.length === 0) {
    normalizedHistory.push({ role: "user", content: "Hello" });
  }

  return normalizedHistory;
}

function normalizeRole(role: string): "user" | "assistant" | "system" {
  if (role === "assistant" || role === "system") {
    return role;
  }
  return "user";
}

function chunkText(text: string): string[] {
  const chunks = text.match(/.{1,36}(\s+|$)/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}

function parseEndpoint(endpoint: string): { host: string; port: number; origin: string; basePath: string } | null {
  try {
    const parsed = new URL(endpoint);
    if (!parsed.port) {
      return null;
    }

    return {
      host: parsed.hostname,
      port: Number(parsed.port),
      origin: parsed.origin,
      basePath: normalizePath(parsed.pathname),
    };
  } catch {
    return null;
  }
}

function normalizePath(value: string): string {
  if (!value || value === "/") {
    return "";
  }
  return `/${value.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function joinPath(basePath: string, routePath: string): string {
  const normalizedRoute = `/${routePath.replace(/^\/+/, "")}`;
  return `${basePath}${normalizedRoute}`;
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function listenServer(
  app: ReturnType<typeof express>,
  host: string,
  port: number,
): Promise<{ ok: boolean; server?: Server; error?: string; addressInUse?: boolean }> {
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      resolve({ ok: true, server });
    });

    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        error: String(error.message ?? error),
        addressInUse: error.code === "EADDRINUSE",
      });
    });
  });
}
