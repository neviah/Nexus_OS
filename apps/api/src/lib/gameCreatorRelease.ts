import fs from "node:fs/promises";
import path from "node:path";

export type GameCreatorReleaseDoc = {
  fileName: string;
  reviewStatus?: "pending" | "approved" | "rejected";
  locked?: boolean;
};

export type GameCreatorReleaseQueueItem = {
  status?: string;
};

export type GameCreatorReleaseArtifact = {
  status?: string;
};

export type GameCreatorReleaseJob = {
  status?: string;
};

export type GameCreatorReleaseRun = {
  status?: string;
  mode?: string;
};

export type GameCreatorReleasePackage = {
  workspacePath: string;
  readyForPackaging: boolean;
  blockers: string[];
  suggestedNextActions: string[];
  releaseNotes: string;
  packageRelativePath: string;
  createdAt: string;
};

export type BuildGameCreatorReleasePackageInput = {
  workspacePath: string;
  specPackage?: {
    setupWizard?: {
      target?: string;
      scopeTier?: string;
      controls?: string;
    };
  };
  canonDocs?: GameCreatorReleaseDoc[];
  queueItems?: GameCreatorReleaseQueueItem[];
  artifacts?: GameCreatorReleaseArtifact[];
  jobs?: GameCreatorReleaseJob[];
  run?: GameCreatorReleaseRun;
};

export function buildGameCreatorReleasePackage(input: BuildGameCreatorReleasePackageInput): GameCreatorReleasePackage {
  const blockers: string[] = [];
  const suggestedNextActions: string[] = [];

  const requiredDocs = (input.canonDocs ?? []).filter((doc) => doc.reviewStatus === "approved" && doc.locked);
  if (requiredDocs.length < 2) {
    blockers.push("Required canon docs are not fully approved and locked.");
    suggestedNextActions.push("Approve and lock the canonical docs before packaging.");
  }

  const pendingArtifacts = (input.artifacts ?? []).some((artifact) => artifact.status !== "approved");
  if (pendingArtifacts) {
    blockers.push("Pending artifacts remain in the pipeline.");
    suggestedNextActions.push("Approve outstanding artifacts before packaging.");
  }

  const blockedQueue = (input.queueItems ?? []).some((entry) => entry.status && entry.status !== "done");
  if (blockedQueue) {
    blockers.push("Some queue items are still incomplete.");
    suggestedNextActions.push("Complete or defer unfinished queue items.");
  }

  const failedJobs = (input.jobs ?? []).some((job) => job.status === "failed");
  if (failedJobs) {
    blockers.push("Some execution jobs failed.");
    suggestedNextActions.push("Resolve failed jobs before shipping.");
  }

  const readyForPackaging = blockers.length === 0;
  if (readyForPackaging) {
    suggestedNextActions.push("Create the release bundle and share the package.");
  }

  const releaseNotes = [
    "Release candidate",
    `Target: ${input.specPackage?.setupWizard?.target ?? "unspecified"}`,
    `Scope: ${input.specPackage?.setupWizard?.scopeTier ?? "unspecified"}`,
    `Controls: ${input.specPackage?.setupWizard?.controls ?? "unspecified"}`,
    `Execution mode: ${input.run?.mode ?? "unknown"}`,
  ].join("\n");

  return {
    workspacePath: input.workspacePath,
    readyForPackaging,
    blockers,
    suggestedNextActions,
    releaseNotes,
    packageRelativePath: path.posix.join("GameBuild", "release", "game-creator-release.zip"),
    createdAt: new Date().toISOString(),
  };
}

export async function writeGameCreatorReleasePackage(input: BuildGameCreatorReleasePackageInput): Promise<GameCreatorReleasePackage> {
  const release = buildGameCreatorReleasePackage(input);
  const bundleDir = path.join(input.workspacePath, "GameBuild", "release");
  await fs.mkdir(bundleDir, { recursive: true });
  const manifestPath = path.join(bundleDir, "release-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(release, null, 2), "utf-8");
  return release;
}
