import type { SystemState } from "../types.js";

export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return "";
  }
  if (apiKey.length <= 8) {
    return "*".repeat(apiKey.length);
  }
  return `${apiKey.slice(0, 4)}${"*".repeat(apiKey.length - 8)}${apiKey.slice(-4)}`;
}

export function getRouterSummary(state: SystemState) {
  const configured = state.onboardingComplete;
  return {
    configured,
    baseUrl: state.router9.baseUrl,
    defaultModel: state.router9.defaultModel,
    fallbackOrder: state.router9.fallbackOrder,
    providers: state.router9.providers,
    logs: state.router9.logs,
    maskedApiKey: maskApiKey(state.router9.apiKey),
  };
}