import type { HarnessCapabilitySettings, SystemState } from "../types.js";

const DEFAULT_ALLOWED_EXTENSIONS = [".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv", ".json"];

export function createDefaultHarnessCapabilities(): HarnessCapabilitySettings {
  return {
    crawl4ai: {
      enabled: false,
      allowedDomains: [],
      allowExternalDomains: false,
      obeyRobotsTxt: true,
      maxPages: 8,
      timeoutMs: 45000,
    },
    officeCli: {
      enabled: false,
      allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
      maxFileSizeMb: 32,
    },
  };
}

export function ensureHarnessCapabilitiesStore(state: SystemState): Record<string, HarnessCapabilitySettings> {
  if (!state.harnessCapabilities || typeof state.harnessCapabilities !== "object") {
    state.harnessCapabilities = {};
  }
  return state.harnessCapabilities;
}

export function getHarnessCapabilities(state: SystemState, harnessId: string): HarnessCapabilitySettings {
  const store = ensureHarnessCapabilitiesStore(state);
  const current = store[harnessId];
  if (!current) {
    const defaults = createDefaultHarnessCapabilities();
    store[harnessId] = defaults;
    return defaults;
  }

  const normalized = normalizeHarnessCapabilities(current);
  store[harnessId] = normalized;
  return normalized;
}

export function updateHarnessCapabilities(
  state: SystemState,
  harnessId: string,
  next: {
    crawl4ai?: Partial<HarnessCapabilitySettings["crawl4ai"]>;
    officeCli?: Partial<HarnessCapabilitySettings["officeCli"]>;
  },
): HarnessCapabilitySettings {
  const store = ensureHarnessCapabilitiesStore(state);
  const current = getHarnessCapabilities(state, harnessId);

  const merged: HarnessCapabilitySettings = {
    crawl4ai: {
      ...current.crawl4ai,
      ...(next.crawl4ai ?? {}),
    },
    officeCli: {
      ...current.officeCli,
      ...(next.officeCli ?? {}),
    },
  };

  const normalized = normalizeHarnessCapabilities(merged);
  store[harnessId] = normalized;
  return normalized;
}

function normalizeHarnessCapabilities(value: HarnessCapabilitySettings): HarnessCapabilitySettings {
  const defaults = createDefaultHarnessCapabilities();

  const crawlAllowedDomains = Array.isArray(value?.crawl4ai?.allowedDomains)
    ? value.crawl4ai.allowedDomains.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : defaults.crawl4ai.allowedDomains;

  const officeExtensions = Array.isArray(value?.officeCli?.allowedExtensions)
    ? value.officeCli.allowedExtensions.map((entry) => {
      const normalized = String(entry).trim().toLowerCase();
      if (!normalized) {
        return "";
      }
      return normalized.startsWith(".") ? normalized : `.${normalized}`;
    }).filter(Boolean)
    : defaults.officeCli.allowedExtensions;

  return {
    crawl4ai: {
      enabled: Boolean(value?.crawl4ai?.enabled),
      allowedDomains: Array.from(new Set(crawlAllowedDomains)),
      allowExternalDomains: Boolean(value?.crawl4ai?.allowExternalDomains),
      obeyRobotsTxt: value?.crawl4ai?.obeyRobotsTxt ?? defaults.crawl4ai.obeyRobotsTxt,
      maxPages: clampNumber(value?.crawl4ai?.maxPages, 1, 200, defaults.crawl4ai.maxPages),
      timeoutMs: clampNumber(value?.crawl4ai?.timeoutMs, 1000, 180000, defaults.crawl4ai.timeoutMs),
    },
    officeCli: {
      enabled: Boolean(value?.officeCli?.enabled),
      allowedExtensions: Array.from(new Set(officeExtensions.length > 0 ? officeExtensions : defaults.officeCli.allowedExtensions)),
      maxFileSizeMb: clampNumber(value?.officeCli?.maxFileSizeMb, 1, 512, defaults.officeCli.maxFileSizeMb),
    },
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
