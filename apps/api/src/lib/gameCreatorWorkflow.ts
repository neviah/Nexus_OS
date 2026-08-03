export type GameCreatorWorkflowStep =
  | "generate-canon-docs"
  | "build-queue"
  | "run-execution"
  | "create-release-package";

export type GameCreatorWorkflowPlan = {
  steps: GameCreatorWorkflowStep[];
  summary: string;
};

export function buildGameCreatorWorkflowPlan(input: {
  mode: "strict-approval" | "auto-produce";
  gate2Ready: boolean;
  canonDocCount: number;
  approvedLockedDocs: number;
  queueItemCount: number;
  releaseReady: boolean;
  queueCompleted?: boolean;
}): GameCreatorWorkflowPlan {
  const steps: GameCreatorWorkflowStep[] = [];

  if (!input.gate2Ready) {
    return {
      steps: [],
      summary: "Gate 2 must pass before the workflow can start.",
    };
  }

  if (!input.releaseReady && !input.queueCompleted) {
    steps.push("generate-canon-docs");
    steps.push("build-queue");
    steps.push("run-execution");
    steps.push("create-release-package");
  } else {
    steps.push("create-release-package");
  }

  return {
    steps,
    summary: steps.length === 0
      ? "Workflow is already complete."
      : `Recommended path: ${steps.join(" → ")}`,
  };
}
