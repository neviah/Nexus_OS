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

const workspacesRoot = path.join(getRootDir(), "data", "workspaces");

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
  await fs.mkdir(workspacesRoot, { recursive: true });
  const entries = await fs.readdir(workspacesRoot, { withFileTypes: true });

  const directories = entries.filter((entry) => entry.isDirectory());

  const records = await Promise.all(
    directories.map(async (dir) => {
      const workspacePath = path.join(workspacesRoot, dir.name);
      const stats = await getDirectoryStats(workspacePath);
      return {
        id: dir.name,
        name: dir.name,
        path: workspacePath,
        sizeBytes: stats.sizeBytes,
        lastModified: stats.lastModified,
        activeHarnesses: activeHarnessesByWorkspace[dir.name] ?? [],
      };
    }),
  );

  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspace(id: string): Promise<void> {
  const safeId = sanitizeWorkspaceId(id);
  const target = path.join(workspacesRoot, safeId);
  await fs.mkdir(target, { recursive: true });
}

export async function deleteWorkspace(id: string): Promise<void> {
  const safeId = sanitizeWorkspaceId(id);
  const target = path.join(workspacesRoot, safeId);
  await fs.rm(target, { recursive: true, force: true });
}

export async function buildWorkspaceTree(id: string): Promise<WorkspaceTreeNode> {
  const safeId = sanitizeWorkspaceId(id);
  const rootPath = path.join(workspacesRoot, safeId);

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

function sanitizeWorkspaceId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 40);
}