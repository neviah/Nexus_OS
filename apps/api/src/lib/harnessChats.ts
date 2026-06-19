import type { HarnessChatStore, HarnessChatThreadRecord, SystemState } from "../types.js";

function ensureWorkspaceHarnessThreads(
  root: Record<string, Record<string, HarnessChatThreadRecord[]>>,
  workspaceId: string,
  harnessId: string,
): HarnessChatThreadRecord[] {
  root[workspaceId] = root[workspaceId] ?? {};
  root[workspaceId][harnessId] = root[workspaceId][harnessId] ?? [];
  return root[workspaceId][harnessId];
}

export function ensureHarnessChatStore(state: SystemState): HarnessChatStore {
  if (!state.harnessChats) {
    state.harnessChats = {
      threadsByWorkspace: {},
    };
  }

  state.harnessChats.threadsByWorkspace = state.harnessChats.threadsByWorkspace ?? {};
  return state.harnessChats;
}

export function listHarnessThreads(state: SystemState, workspaceId: string, harnessId: string): HarnessChatThreadRecord[] {
  const store = ensureHarnessChatStore(state);
  const threads = ensureWorkspaceHarnessThreads(store.threadsByWorkspace, workspaceId, harnessId);
  return [...threads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function upsertHarnessThread(
  state: SystemState,
  input: {
    workspaceId: string;
    harnessId: string;
    thread: HarnessChatThreadRecord;
  },
): HarnessChatThreadRecord {
  const store = ensureHarnessChatStore(state);
  const threads = ensureWorkspaceHarnessThreads(store.threadsByWorkspace, input.workspaceId, input.harnessId);
  const nowIso = new Date().toISOString();
  const index = threads.findIndex((thread) => thread.id === input.thread.id);

  const normalized: HarnessChatThreadRecord = {
    ...input.thread,
    title: input.thread.title.trim() || "New chat",
    createdAt: input.thread.createdAt || nowIso,
    updatedAt: input.thread.updatedAt || nowIso,
    meta: input.thread.meta ?? null,
    messages: input.thread.messages ?? [],
  };

  if (index >= 0) {
    threads[index] = normalized;
  } else {
    threads.unshift(normalized);
  }

  // Keep latest threads only to prevent unbounded state growth.
  if (threads.length > 120) {
    store.threadsByWorkspace[input.workspaceId][input.harnessId] = threads.slice(0, 120);
  }

  return normalized;
}

export function deleteHarnessThread(state: SystemState, workspaceId: string, harnessId: string, threadId: string): boolean {
  const store = ensureHarnessChatStore(state);
  const threads = ensureWorkspaceHarnessThreads(store.threadsByWorkspace, workspaceId, harnessId);
  const next = threads.filter((thread) => thread.id !== threadId);
  const changed = next.length !== threads.length;
  if (changed) {
    store.threadsByWorkspace[workspaceId][harnessId] = next;
  }
  return changed;
}
