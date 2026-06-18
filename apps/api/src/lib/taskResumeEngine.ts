import fs from "node:fs/promises";
import path from "node:path";
import { getRootDir } from "./stateStore.js";
import type { TaskRecord, TaskRecordStatus } from "../types.js";

const taskStorePath = path.join(getRootDir(), "data", "inflight-tasks.local.json");

async function ensureStore(): Promise<void> {
  try {
    await fs.access(taskStorePath);
  } catch {
    await fs.writeFile(taskStorePath, "[]", "utf-8");
  }
}

async function readTasks(): Promise<TaskRecord[]> {
  await ensureStore();
  const raw = await fs.readFile(taskStorePath, "utf-8");
  return JSON.parse(raw) as TaskRecord[];
}

async function writeTasks(tasks: TaskRecord[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(taskStorePath, JSON.stringify(tasks, null, 2), "utf-8");
}

export async function createTask(record: Omit<TaskRecord, "updatedAt" | "partialOutput" | "status">): Promise<void> {
  const tasks = await readTasks();
  tasks.unshift({
    ...record,
    status: "running",
    partialOutput: "",
    updatedAt: new Date().toISOString(),
  });
  await writeTasks(trimTasks(tasks));
}

export async function appendTaskOutput(requestId: string, delta: string): Promise<void> {
  if (!delta) {
    return;
  }

  const tasks = await readTasks();
  const target = tasks.find((task) => task.requestId === requestId);
  if (!target) {
    return;
  }

  target.partialOutput += delta;
  target.updatedAt = new Date().toISOString();
  await writeTasks(trimTasks(tasks));
}

export async function updateTaskStatus(
  requestId: string,
  status: TaskRecordStatus,
  patch?: Partial<Pick<TaskRecord, "error" | "finalOutput" | "meta">>,
): Promise<void> {
  const tasks = await readTasks();
  const target = tasks.find((task) => task.requestId === requestId);
  if (!target) {
    return;
  }

  target.status = status;
  target.updatedAt = new Date().toISOString();
  if (patch?.error !== undefined) {
    target.error = patch.error;
  }
  if (patch?.finalOutput !== undefined) {
    target.finalOutput = patch.finalOutput;
  }
  if (patch?.meta !== undefined) {
    target.meta = patch.meta;
  }

  await writeTasks(trimTasks(tasks));
}

export async function getTask(requestId: string): Promise<TaskRecord | undefined> {
  const tasks = await readTasks();
  return tasks.find((task) => task.requestId === requestId);
}

export async function listResumableTasks(): Promise<TaskRecord[]> {
  const tasks = await readTasks();
  return tasks.filter((task) => task.status === "failed").slice(0, 30);
}

export function buildReplayPrompt(task: TaskRecord): string {
  return [
    "The previous response was interrupted.",
    "Continue from the exact point it stopped and do not repeat prior completed content.",
    "",
    `Original user prompt: ${task.message}`,
    "",
    "Partial assistant output so far:",
    task.partialOutput || "(none)",
  ].join("\n");
}

function trimTasks(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.slice(0, 300);
}