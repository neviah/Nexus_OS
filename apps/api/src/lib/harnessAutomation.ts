import type { HarnessAutomationStore, HarnessRunRecord, HarnessSchedule, SystemState } from "../types.js";

const DEFAULT_INTERVAL_MINUTES = 30;

export function ensureHarnessAutomationStore(state: SystemState): HarnessAutomationStore {
  if (!state.harnessAutomation) {
    state.harnessAutomation = {
      schedulesByWorkspace: {},
      runsByWorkspace: {},
    };
  }

  state.harnessAutomation.schedulesByWorkspace = state.harnessAutomation.schedulesByWorkspace ?? {};
  state.harnessAutomation.runsByWorkspace = state.harnessAutomation.runsByWorkspace ?? {};

  return state.harnessAutomation;
}

function ensureWorkspaceHarnessList<T>(
  root: Record<string, Record<string, T[]>>,
  workspaceId: string,
  harnessId: string,
): T[] {
  root[workspaceId] = root[workspaceId] ?? {};
  root[workspaceId][harnessId] = root[workspaceId][harnessId] ?? [];
  return root[workspaceId][harnessId];
}

export function listHarnessSchedules(state: SystemState, workspaceId: string, harnessId: string): HarnessSchedule[] {
  const store = ensureHarnessAutomationStore(state);
  const list = ensureWorkspaceHarnessList(store.schedulesByWorkspace, workspaceId, harnessId);
  return [...list].sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
}

export function upsertHarnessSchedule(
  state: SystemState,
  input: {
    workspaceId: string;
    harnessId: string;
    id?: string;
    title?: string;
    prompt: string;
    intervalMinutes?: number;
    enabled?: boolean;
  },
): HarnessSchedule {
  const store = ensureHarnessAutomationStore(state);
  const list = ensureWorkspaceHarnessList(store.schedulesByWorkspace, input.workspaceId, input.harnessId);
  const nowIso = new Date().toISOString();
  const scheduleId = input.id ?? crypto.randomUUID();
  const index = list.findIndex((entry) => entry.id === scheduleId);

  const base = index >= 0 ? list[index] : undefined;
  const intervalMinutes = clampInt(input.intervalMinutes ?? base?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES, 1, 24 * 60);

  const schedule: HarnessSchedule = {
    id: scheduleId,
    harnessId: input.harnessId,
    workspaceId: input.workspaceId,
    title: (input.title ?? base?.title ?? "Scheduled run").trim() || "Scheduled run",
    prompt: input.prompt.trim(),
    intervalMinutes,
    enabled: input.enabled ?? base?.enabled ?? true,
    nextRunAt: base?.nextRunAt ?? addMinutesIso(nowIso, intervalMinutes),
    lastRunAt: base?.lastRunAt,
    createdAt: base?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  if (index >= 0) {
    list[index] = schedule;
  } else {
    list.unshift(schedule);
  }

  return schedule;
}

export function deleteHarnessSchedule(state: SystemState, workspaceId: string, harnessId: string, scheduleId: string): boolean {
  const store = ensureHarnessAutomationStore(state);
  const list = ensureWorkspaceHarnessList(store.schedulesByWorkspace, workspaceId, harnessId);
  const next = list.filter((entry) => entry.id !== scheduleId);
  const changed = next.length !== list.length;
  if (changed) {
    store.schedulesByWorkspace[workspaceId][harnessId] = next;
  }
  return changed;
}

export function listHarnessRuns(state: SystemState, workspaceId: string, harnessId: string): HarnessRunRecord[] {
  const store = ensureHarnessAutomationStore(state);
  const list = ensureWorkspaceHarnessList(store.runsByWorkspace, workspaceId, harnessId);
  return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function appendHarnessRun(state: SystemState, run: HarnessRunRecord): void {
  const store = ensureHarnessAutomationStore(state);
  const list = ensureWorkspaceHarnessList(store.runsByWorkspace, run.workspaceId, run.harnessId);
  list.unshift(run);
  if (list.length > 100) {
    store.runsByWorkspace[run.workspaceId][run.harnessId] = list.slice(0, 100);
  }
}

export function listDueSchedules(state: SystemState, nowIso: string): HarnessSchedule[] {
  const store = ensureHarnessAutomationStore(state);
  const due: HarnessSchedule[] = [];

  for (const byHarness of Object.values(store.schedulesByWorkspace)) {
    for (const schedules of Object.values(byHarness)) {
      for (const schedule of schedules) {
        if (!schedule.enabled) {
          continue;
        }
        if (new Date(schedule.nextRunAt).getTime() <= new Date(nowIso).getTime()) {
          due.push(schedule);
        }
      }
    }
  }

  return due;
}

export function markScheduleRun(
  state: SystemState,
  input: { workspaceId: string; harnessId: string; scheduleId: string; runAtIso: string },
): HarnessSchedule | null {
  const store = ensureHarnessAutomationStore(state);
  const list = ensureWorkspaceHarnessList(store.schedulesByWorkspace, input.workspaceId, input.harnessId);
  const index = list.findIndex((entry) => entry.id === input.scheduleId);
  if (index === -1) {
    return null;
  }

  const existing = list[index];
  const updated: HarnessSchedule = {
    ...existing,
    lastRunAt: input.runAtIso,
    nextRunAt: addMinutesIso(input.runAtIso, existing.intervalMinutes),
    updatedAt: input.runAtIso,
  };
  list[index] = updated;
  return updated;
}

function addMinutesIso(baseIso: string, minutes: number): string {
  const base = new Date(baseIso);
  base.setMinutes(base.getMinutes() + minutes);
  return base.toISOString();
}

function clampInt(value: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, parsed));
}
