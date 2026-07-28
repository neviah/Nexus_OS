export type GameCreatorWorkflowStatus = "setup" | "docs" | "queue" | "execution" | "ready-to-release";

export type GameCreatorWorkflowSummary = {
  status: GameCreatorWorkflowStatus;
  progressPercent: number;
  nextAction: string;
  summary: string;
};

export type BuildGameCreatorWorkflowSummaryInput = {
  hasSetupDraft: boolean;
  canonDocCount: number;
  approvedLockedDocs: number;
  queueItemCount: number;
  releaseReady: boolean;
  complianceStatus: "ready" | "needs-attention";
};

export function buildGameCreatorWorkflowSummary(input: BuildGameCreatorWorkflowSummaryInput): GameCreatorWorkflowSummary {
  if (!input.hasSetupDraft) {
    return {
      status: "setup",
      progressPercent: 10,
      nextAction: "Complete the setup wizard before generating docs.",
      summary: "The workflow is still at the setup stage.",
    };
  }

  if (input.canonDocCount === 0) {
    return {
      status: "docs",
      progressPercent: 25,
      nextAction: "Generate the canonical docs and review them.",
      summary: "The foundation is defined, but the canonical documents are not ready yet.",
    };
  }

  if (input.approvedLockedDocs < Math.max(1, input.canonDocCount)) {
    return {
      status: "docs",
      progressPercent: 55,
      nextAction: "Approve and lock the canon docs to unblock the queue.",
      summary: "The docs have been generated, but the review gates still need to be closed.",
    };
  }

  if (input.queueItemCount === 0) {
    return {
      status: "queue",
      progressPercent: 70,
      nextAction: "Build the execution queue so work can be scheduled.",
      summary: "The docs are ready, and the next step is queue construction.",
    };
  }

  if (!input.releaseReady || input.complianceStatus !== "ready") {
    return {
      status: "execution",
      progressPercent: 85,
      nextAction: "Complete the remaining approvals, decisions, and artifact checks.",
      summary: "The queue is built, and the workflow is progressing toward release readiness.",
    };
  }

  return {
    status: "ready-to-release",
    progressPercent: 100,
    nextAction: "Create the release package and share the build.",
    summary: "The workflow is fully prepared for packaging and distribution.",
  };
}
