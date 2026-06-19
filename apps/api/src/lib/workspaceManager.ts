import fs from "node:fs/promises";
import path from "node:path";
import { getRootDir } from "./stateStore.js";
import type { WorkspaceRecord } from "../types.js";

type WorkspaceTreeNode = {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: WorkspaceTreeNode[];
};

type WorkspaceRegistryEntry = {
  id: string;
  name: string;
  path: string;
  managed: boolean;
};

type FolderEntry = {
  name: string;
  path: string;
};

const workspacesRoot = path.join(getRootDir(), "data", "workspaces");
const workspaceRegistryPath = path.join(getRootDir(), "data", "workspaces.local.json");

async function ensureWorkspaceStore(): Promise<void> {
  await fs.mkdir(workspacesRoot, { recursive: true });
  const defaultPath = path.join(workspacesRoot, "default");
  await fs.mkdir(defaultPath, { recursive: true });

  try {
    await fs.access(workspaceRegistryPath);
  } catch {
    const seed: WorkspaceRegistryEntry[] = [{
      id: "default",
      name: "default",
      path: defaultPath,
      managed: true,
    }];
    await fs.writeFile(workspaceRegistryPath, JSON.stringify(seed, null, 2), "utf-8");
  }
}

async function readWorkspaceRegistry(): Promise<WorkspaceRegistryEntry[]> {
  await ensureWorkspaceStore();
  const raw = await fs.readFile(workspaceRegistryPath, "utf-8");
  const parsed = JSON.parse(raw) as WorkspaceRegistryEntry[];
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed;
}

async function writeWorkspaceRegistry(entries: WorkspaceRegistryEntry[]): Promise<void> {
  await ensureWorkspaceStore();
  await fs.writeFile(workspaceRegistryPath, JSON.stringify(entries, null, 2), "utf-8");
}

async function getDirectoryStats(targetPath: string): Promise<{ sizeBytes: number; lastModified: string }> {
  let totalSize = 0;
  let newestMtime = 0;

  async function walk(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const stat = await fs.stat(entryPath);
      totalSize += stat.size;
      newestMtime = Math.max(newestMtime, stat.mtimeMs);

      if (entry.isDirectory()) {
        await walk(entryPath);
      }
    }
  }

  await walk(targetPath);
  return {
    sizeBytes: totalSize,
    lastModified: new Date(newestMtime || Date.now()).toISOString(),
  };
}

export async function listWorkspaces(activeHarnessesByWorkspace: Record<string, string[]>): Promise<WorkspaceRecord[]> {
  const registry = await readWorkspaceRegistry();

  const records = await Promise.all(registry.map(async (entry) => {
    let stats = { sizeBytes: 0, lastModified: new Date().toISOString() };
    try {
      stats = await getDirectoryStats(entry.path);
    } catch {
      // Keep stale registry entry visible even if path is missing.
    }

    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      sizeBytes: stats.sizeBytes,
      lastModified: stats.lastModified,
      activeHarnesses: activeHarnessesByWorkspace[entry.id] ?? [],
    };
  }));

  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspace(name: string): Promise<{ id: string; path: string }> {
  const registry = await readWorkspaceRegistry();
  const baseId = sanitizeWorkspaceId(name) || "workspace";
  const id = uniqueWorkspaceId(baseId, registry.map((entry) => entry.id));
  const target = path.join(workspacesRoot, id);
  await fs.mkdir(target, { recursive: true });

  registry.push({
    id,
    name: name.trim() || id,
    path: target,
    managed: true,
  });
  await writeWorkspaceRegistry(registry);
  return { id, path: target };
}

export async function deleteWorkspace(id: string): Promise<void> {
  const registry = await readWorkspaceRegistry();
  const existing = registry.find((entry) => entry.id === id);
  if (!existing) {
    return;
  }

  const next = registry.filter((entry) => entry.id !== id);
  await writeWorkspaceRegistry(next);

  if (existing.managed) {
    await fs.rm(existing.path, { recursive: true, force: true });
  }
}

export async function buildWorkspaceTree(id: string): Promise<WorkspaceTreeNode> {
  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    throw new Error(`Unknown workspace ${id}`);
  }
  const rootPath = workspace.path;

  async function walk(currentPath: string): Promise<WorkspaceTreeNode> {
    const stat = await fs.stat(currentPath);
    const relativePath = path.relative(rootPath, currentPath) || ".";

    if (!stat.isDirectory()) {
      return {
        name: path.basename(currentPath),
        type: "file",
        path: relativePath,
      };
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const children = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => walk(path.join(currentPath, entry.name))),
    );

    children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      name: path.basename(currentPath),
      type: "directory",
      path: relativePath,
      children,
    };
  }

  return walk(rootPath);
}

export async function getWorkspaceById(id: string): Promise<WorkspaceRegistryEntry | undefined> {
  const registry = await readWorkspaceRegistry();
  return registry.find((entry) => entry.id === id);
}

export async function registerWorkspacePath(input: { name: string; workspacePath: string }): Promise<{ id: string; path: string }> {
  const registry = await readWorkspaceRegistry();
  const normalized = normalizeWorkspacePath(input.workspacePath);
  const stat = await fs.stat(normalized);
  if (!stat.isDirectory()) {
    throw new Error("Selected path is not a directory.");
  }

  const existingByPath = registry.find((entry) => normalizeWorkspacePath(entry.path) === normalized);
  if (existingByPath) {
    return { id: existingByPath.id, path: existingByPath.path };
  }

  const baseId = sanitizeWorkspaceId(input.name || path.basename(normalized) || "workspace") || "workspace";
  const id = uniqueWorkspaceId(baseId, registry.map((entry) => entry.id));
  registry.push({
    id,
    name: input.name.trim() || path.basename(normalized) || id,
    path: normalized,
    managed: false,
  });
  await writeWorkspaceRegistry(registry);
  return { id, path: normalized };
}

export async function listWorkspaceRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const candidate = `${letter}:\\`;
    try {
      await fs.access(candidate);
      roots.push(candidate);
    } catch {
      // Not mounted.
    }
  }
  return roots;
}

export async function listFoldersAt(targetPath: string): Promise<{ path: string; parentPath: string | null; folders: FolderEntry[] }> {
  const normalized = normalizeWorkspacePath(targetPath);
  const stat = await fs.stat(normalized);
  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  const entries = await fs.readdir(normalized, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(normalized, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(normalized);
  const parentPath = parent === normalized ? null : parent;
  return { path: normalized, parentPath, folders };
}

function normalizeWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) {
    throw new Error("Workspace path must be absolute.");
  }
  return resolved;
}

function sanitizeWorkspaceId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 40);
}

function uniqueWorkspaceId(base: string, existingIds: string[]): string {
  if (!existingIds.includes(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.includes(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}