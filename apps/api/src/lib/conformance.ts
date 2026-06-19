import type { HarnessConfig, HarnessConformanceCheck, HarnessConformanceResult, SystemState } from "../types.js";
import { probeHarnessProtocol } from "./harnessProbe.js";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function runHarnessConformance(harnesses: HarnessConfig[], state?: SystemState): Promise<HarnessConformanceResult[]> {
  return Promise.all(harnesses.map((harness) => runHarnessChecks(harness, state)));
}

async function runHarnessChecks(harness: HarnessConfig, state?: SystemState): Promise<HarnessConformanceResult> {
  const checks: HarnessConformanceCheck[] = [];
  const adapter = harness.adapter;

  checks.push({
    name: "adapter-config-exists",
    passed: Boolean(adapter),
    details: adapter ? "Adapter config present" : "Adapter config missing (defaults applied)",
  });

  checks.push({
    name: "endpoint-is-http",
    passed: /^https?:\/\//i.test(harness.endpoint),
    details: `endpoint=${harness.endpoint}`,
  });

  checks.push({
    name: "models-configured",
    passed: harness.models.length > 0,
    details: `models=${harness.models.join(",") || "none"}`,
  });

  checks.push({
    name: "default-model-in-list",
    passed: harness.models.includes(harness.defaultModel),
    details: `defaultModel=${harness.defaultModel}`,
  });

  const pathChecks = [
    { key: "healthPath", value: adapter?.healthPath },
    { key: "openAiPath", value: adapter?.openAiPath },
    { key: "streamPath", value: adapter?.streamPath },
  ];
  for (const pathCheck of pathChecks) {
    if (!pathCheck.value) {
      continue;
    }
    checks.push({
      name: `${pathCheck.key}-starts-with-slash`,
      passed: pathCheck.value.startsWith("/"),
      details: `${pathCheck.key}=${pathCheck.value}`,
    });
  }

  if (adapter?.genericPaths) {
    checks.push({
      name: "generic-paths-valid",
      passed: adapter.genericPaths.every((entry) => entry.startsWith("/")),
      details: `genericPaths=${adapter.genericPaths.join(",")}`,
    });
  }

  const healthPath = adapter?.healthPath ?? "/health";
  try {
    const response = await fetchWithTimeout(`${harness.endpoint}${healthPath}`, 1500);
    checks.push({
      name: "live-health-check",
      passed: response.ok,
      details: `status=${response.status}`,
    });
  } catch {
    checks.push({
      name: "live-health-check",
      passed: false,
      details: "unreachable",
    });
  }

  if (state) {
    const protocolProbes = ["openai", "generic", "stream"] as const;
    for (const proto of protocolProbes) {
      const probe = await probeHarnessProtocol(harness, proto, state);
      checks.push({
        name: `live-probe-${proto}`,
        passed: probe.success,
        details: `${probe.elapsedMs}ms: ${probe.message}`,
      });
    }
  }

  const passed = checks.filter((entry) => entry.passed).length;
  return {
    harnessId: harness.id,
    harnessName: harness.name,
    endpoint: harness.endpoint,
    timestamp: new Date().toISOString(),
    checks,
    score: {
      passed,
      total: checks.length,
    },
  };
}