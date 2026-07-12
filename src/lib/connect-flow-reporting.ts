import type {
  SelectActionSubmission,
  SelectProjectAction,
} from "@/lib/db-schema";

export type SubmissionWithAction = {
  action: SelectProjectAction;
  submission: SelectActionSubmission;
};

export type ConnectFlowSubmissionSummary = {
  actionId: number | null;
  actionName: string | null;
  depth: number;
  mode: "jump" | "return" | null;
  parentSubmissionId: number | null;
  sourceActionId: number | null;
  sourceStepId: number | null;
};

export type ConnectFlowSubmissionRelationship = {
  children: SubmissionWithAction[];
  parent: SubmissionWithAction | null;
  summary: ConnectFlowSubmissionSummary;
};

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function getConnectFlowSubmissionSummary(
  submission: SelectActionSubmission,
): ConnectFlowSubmissionSummary {
  const mode =
    submission.metadata.connectedFlowMode === "jump" ||
    submission.metadata.connectedFlowMode === "return"
      ? submission.metadata.connectedFlowMode
      : null;

  return {
    actionId:
      getNumber(submission.metadata.connectedActionId) ?? submission.actionId,
    actionName:
      getString(submission.metadata.actionName) ??
      getString(submission.metadata.connectedActionName),
    depth: getNumber(submission.metadata.connectedFlowDepth) ?? 0,
    mode,
    parentSubmissionId: getNumber(submission.metadata.parentSubmissionId),
    sourceActionId: getNumber(submission.metadata.connectedFromActionId),
    sourceStepId: getNumber(submission.metadata.connectedFromStepId),
  };
}

export function buildConnectFlowRelationship(
  submissions: SubmissionWithAction[],
  submissionId: number,
): ConnectFlowSubmissionRelationship {
  const byId = new Map(
    submissions.map((item) => [item.submission.id, item] as const),
  );
  const current = byId.get(submissionId);
  const summary = current
    ? getConnectFlowSubmissionSummary(current.submission)
    : {
        actionId: null,
        actionName: null,
        depth: 0,
        mode: null,
        parentSubmissionId: null,
        sourceActionId: null,
        sourceStepId: null,
      };
  const children = submissions
    .filter(
      (item) =>
        getConnectFlowSubmissionSummary(item.submission).parentSubmissionId ===
        submissionId,
    )
    .sort(
      (left, right) =>
        left.submission.createdAt.getTime() -
        right.submission.createdAt.getTime(),
    );

  return {
    children,
    parent:
      summary.parentSubmissionId === null
        ? null
        : (byId.get(summary.parentSubmissionId) ?? null),
    summary,
  };
}

export function hasConnectFlowRelationship(
  item: SubmissionWithAction,
  submissions: SubmissionWithAction[],
) {
  const summary = getConnectFlowSubmissionSummary(item.submission);

  if (summary.parentSubmissionId !== null) {
    return true;
  }

  return submissions.some(
    (candidate) =>
      getConnectFlowSubmissionSummary(candidate.submission)
        .parentSubmissionId === item.submission.id,
  );
}

export function getConnectFlowReportingCounts(
  submissions: SubmissionWithAction[],
) {
  let childSubmissionCount = 0;
  let returnModeCount = 0;
  let jumpModeCount = 0;
  const parentSubmissionIds = new Set<number>();

  for (const item of submissions) {
    const summary = getConnectFlowSubmissionSummary(item.submission);

    if (summary.parentSubmissionId !== null) {
      childSubmissionCount += 1;
      parentSubmissionIds.add(summary.parentSubmissionId);
    }

    if (summary.mode === "return") {
      returnModeCount += 1;
    }

    if (summary.mode === "jump") {
      jumpModeCount += 1;
    }
  }

  return {
    childSubmissionCount,
    jumpModeCount,
    parentSubmissionCount: parentSubmissionIds.size,
    returnModeCount,
  };
}
