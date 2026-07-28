export type GameCreatorComplianceCheck = {
  id: string;
  title: string;
  passed: boolean;
  details: string;
};

export type GameCreatorComplianceSummary = {
  overallStatus: "ready" | "needs-attention";
  policyChecks: GameCreatorComplianceCheck[];
  warnings: string[];
};

export type BuildGameCreatorComplianceSummaryInput = {
  workspacePath: string;
  artifacts?: Array<{ status?: string; provenance?: string | null }>;
  canonDocs?: Array<{ reviewStatus?: string; locked?: boolean }>;
  telemetryEntries?: Array<{ severity?: string }>;
};

export function buildGameCreatorComplianceSummary(input: BuildGameCreatorComplianceSummaryInput): GameCreatorComplianceSummary {
  const policyChecks: GameCreatorComplianceCheck[] = [];

  const provenancePassed = (input.artifacts ?? []).every((artifact) => artifact.provenance && artifact.provenance.trim().length > 0);
  policyChecks.push({
    id: "provenance",
    title: "Artifact provenance",
    passed: provenancePassed,
    details: provenancePassed ? "All artifacts include provenance metadata." : "Some artifacts are missing provenance metadata.",
  });

  const docApprovalsPassed = (input.canonDocs ?? []).every((doc) => doc.reviewStatus === "approved" && doc.locked);
  policyChecks.push({
    id: "doc-approvals",
    title: "Canonical document approvals",
    passed: docApprovalsPassed,
    details: docApprovalsPassed ? "Canonical docs are approved and locked." : "Some canonical docs are still pending review or unlocked.",
  });

  const warningCount = (input.telemetryEntries ?? []).filter((entry) => entry.severity === "warn" || entry.severity === "error").length;
  policyChecks.push({
    id: "telemetry",
    title: "Telemetry health",
    passed: warningCount === 0,
    details: warningCount === 0 ? "No warning-level telemetry events recorded." : `${warningCount} warning or error telemetry event(s) recorded.`,
  });

  const warnings = policyChecks.filter((check) => !check.passed).map((check) => check.title);
  return {
    overallStatus: warnings.length === 0 ? "ready" : "needs-attention",
    policyChecks,
    warnings,
  };
}
