import type { HarnessConfig, SystemState } from "../types.js";

export type RouterContractContext = {
  requestId: string;
  model: string;
  baseUrl: string;
  fallbackOrder: string[];
  apiKey: string;
  workspace?: {
    id: string;
    path: string;
  };
};

export function createRouterContext(
  state: SystemState,
  model: string,
  workspace?: { id: string; path: string },
): RouterContractContext {
  return {
    requestId: crypto.randomUUID(),
    model,
    baseUrl: state.router9.baseUrl,
    fallbackOrder: state.router9.fallbackOrder,
    apiKey: state.router9.apiKey,
    workspace,
  };
}

export function buildRouterHeaders(
  harness: HarnessConfig,
  context: RouterContractContext,
): Record<string, string> {
  const authMode = harness.adapter?.authMode ?? "both";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-9Router-Request-Id": context.requestId,
    "X-9Router-Transport-Version": "1",
    "X-9Router-Base-Url": context.baseUrl,
    "X-9Router-Model": context.model,
    "X-9Router-Fallback-Order": context.fallbackOrder.join(","),
    ...(context.workspace
      ? {
          "X-Nexus-Workspace-Id": context.workspace.id,
          "X-Nexus-Workspace-Path": context.workspace.path,
        }
      : {}),
    ...(harness.adapter?.customHeaders ?? {}),
  };

  if ((authMode === "bearer" || authMode === "both") && context.apiKey) {
    headers.Authorization = `Bearer ${context.apiKey}`;
  }

  if ((authMode === "x-api-key" || authMode === "both") && context.apiKey) {
    headers["X-API-Key"] = context.apiKey;
    headers["X-9Router-Api-Key"] = context.apiKey;
  }

  return headers;
}

export function buildRouterBody(context: RouterContractContext): {
  requestId: string;
  model: string;
  baseUrl: string;
  fallbackOrder: string[];
  workspace?: {
    id: string;
    path: string;
  };
} {
  return {
    requestId: context.requestId,
    model: context.model,
    baseUrl: context.baseUrl,
    fallbackOrder: context.fallbackOrder,
    workspace: context.workspace,
  };
}
