import type { HarnessConfig, SystemState } from "../types.js";

export type ProbeResult = {
  success: boolean;
  protocol: "openai" | "generic" | "stream";
  elapsedMs: number;
  message?: string;
};

async function fetchWithTimeout(url: string, body: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHarnessProtocol(
  harness: HarnessConfig,
  protocol: "openai" | "generic" | "stream",
  state: SystemState,
): Promise<ProbeResult> {
  const config = harness.adapter;
  const startMs = Date.now();
  const timeoutMs = 2500;

  if (protocol === "openai") {
    const path = config?.openAiPath ?? "/v1/chat/completions";
    try {
      const response = await fetchWithTimeout(
        `${harness.endpoint}${path}`,
        JSON.stringify({
          model: harness.defaultModel,
          stream: false,
          messages: [{ role: "user", content: "ping" }],
        }),
        timeoutMs,
      );

      return {
        success: response.ok,
        protocol: "openai",
        elapsedMs: Date.now() - startMs,
        message: response.ok ? "ok" : `http ${response.status}`,
      };
    } catch (err) {
      return {
        success: false,
        protocol: "openai",
        elapsedMs: Date.now() - startMs,
        message: String(err),
      };
    }
  }

  if (protocol === "generic") {
    const paths = config?.genericPaths ?? ["/api/chat", "/chat"];
    for (const path of paths) {
      try {
        const response = await fetchWithTimeout(
          `${harness.endpoint}${path}`,
          JSON.stringify({
            model: harness.defaultModel,
            message: "ping",
            history: [],
          }),
          timeoutMs,
        );

        if (response.ok) {
          return {
            success: true,
            protocol: "generic",
            elapsedMs: Date.now() - startMs,
            message: `ok (${path})`,
          };
        }
      } catch {
        // Try next path
      }
    }

    return {
      success: false,
      protocol: "generic",
      elapsedMs: Date.now() - startMs,
      message: `all paths failed`,
    };
  }

  if (protocol === "stream") {
    const path = config?.streamPath ?? "/api/chat/stream";
    try {
      const response = await fetchWithTimeout(
        `${harness.endpoint}${path}`,
        JSON.stringify({
          model: harness.defaultModel,
          message: "ping",
          history: [],
        }),
        timeoutMs,
      );

      if (!response.ok || !response.body) {
        return {
          success: false,
          protocol: "stream",
          elapsedMs: Date.now() - startMs,
          message: response.ok ? "no body" : `http ${response.status}`,
        };
      }

      const reader = response.body.getReader();
      const { value } = await reader.read();
      await reader.cancel();

      return {
        success: Boolean(value),
        protocol: "stream",
        elapsedMs: Date.now() - startMs,
        message: value ? "ok" : "no data",
      };
    } catch (err) {
      return {
        success: false,
        protocol: "stream",
        elapsedMs: Date.now() - startMs,
        message: String(err),
      };
    }
  }

  return {
    success: false,
    protocol: "openai",
    elapsedMs: Date.now() - startMs,
    message: "unknown protocol",
  };
}
