import {
  listActionFlowSteps,
  listActionSubmissionEvents,
  listActionSubmissions,
  listProjectActions,
} from "@/lib/action-flows";

type ActionFlowStep = {
  id: number;
  sortOrder: number;
  stepType: string;
  fieldKey: string | null;
  label: string | null;
};

export type ActionFlowStepAnalytics = {
  stepId: number;
  label: string;
  sortOrder: number;
  stepType: string;
  fieldKey: string | null;
  collectedCount: number;
  validationFailureCount: number;
  routeDecisionCount: number;
  dropOffCount: number;
};

export type ActionFlowAnalytics = {
  totalSubmissions: number;
  submittedCount: number;
  inProgressCount: number;
  cancelledCount: number;
  otherStatusCount: number;
  completionRate: number;
  validationFailureCount: number;
  branchDecisionCount: number;
  sourceCounts: Array<{ source: string; count: number }>;
  stepAnalytics: ActionFlowStepAnalytics[];
};

export type ProjectActionFlowAnalyticsRow = {
  actionId: number;
  actionName: string;
  actionStatus: string;
  branchDecisionCount: number;
  completionRate: number;
  dropOffCount: number;
  submittedCount: number;
  totalSubmissions: number;
  validationFailureCount: number;
};

export type ProjectActionFlowDropOffStep = {
  actionId: number;
  actionName: string;
  dropOffCount: number;
  fieldKey: string | null;
  label: string;
  sortOrder: number;
  stepId: number;
  stepType: string;
};

export type ProjectActionFlowAnalytics = {
  actionCount: number;
  activeActionCount: number;
  averageCompletionRate: number;
  branchDecisionCount: number;
  dropOffCount: number;
  flows: ProjectActionFlowAnalyticsRow[];
  submittedCount: number;
  topDropOffSteps: ProjectActionFlowDropOffStep[];
  totalSubmissions: number;
  validationFailureCount: number;
};

export async function getActionFlowAnalytics(input: {
  actionId: number;
  projectId: number;
  steps: ActionFlowStep[];
}): Promise<ActionFlowAnalytics> {
  const submissions = await listActionSubmissions(
    input.projectId,
    input.actionId,
  );
  const eventsBySubmission = await Promise.all(
    submissions.map(async (submission) => ({
      submissionId: submission.id,
      events: await listActionSubmissionEvents(input.projectId, submission.id),
    })),
  );
  const events = eventsBySubmission.flatMap((entry) => entry.events);
  const stepMetrics = new Map(
    input.steps.map((step) => [
      step.id,
      {
        collectedCount: 0,
        dropOffCount: 0,
        routeDecisionCount: 0,
        validationFailureCount: 0,
      },
    ]),
  );
  const sourceCounts = new Map<string, number>();

  for (const submission of submissions) {
    sourceCounts.set(
      submission.source,
      (sourceCounts.get(submission.source) ?? 0) + 1,
    );

    if (submission.status === "in_progress" && submission.currentStepId) {
      const metrics = stepMetrics.get(submission.currentStepId);
      if (metrics) {
        metrics.dropOffCount += 1;
      }
    }
  }

  for (const event of events) {
    if (event.eventType === "field.collected") {
      const stepId = getStepIdFromPayload(event.payload);
      const metrics = stepId ? stepMetrics.get(stepId) : null;
      if (metrics) {
        metrics.collectedCount += 1;
      }
    }

    if (event.eventType === "flow.validation_failed") {
      const stepId = getStepIdFromPayload(event.payload);
      const metrics = stepId ? stepMetrics.get(stepId) : null;
      if (metrics) {
        metrics.validationFailureCount += 1;
      }
    }

    if (event.eventType === "flow.branch_decision") {
      const stepId = getSourceStepIdFromPayload(event.payload);
      const metrics = stepId ? stepMetrics.get(stepId) : null;
      if (metrics) {
        metrics.routeDecisionCount += 1;
      }
    }
  }

  const submittedCount = submissions.filter(
    (submission) => submission.status === "submitted",
  ).length;
  const inProgressCount = submissions.filter(
    (submission) => submission.status === "in_progress",
  ).length;
  const cancelledCount = submissions.filter(
    (submission) => submission.status === "cancelled",
  ).length;
  const knownStatusCount = submittedCount + inProgressCount + cancelledCount;
  const totalSubmissions = submissions.length;

  return {
    branchDecisionCount: events.filter(
      (event) => event.eventType === "flow.branch_decision",
    ).length,
    cancelledCount,
    completionRate:
      totalSubmissions === 0
        ? 0
        : Math.round((submittedCount / totalSubmissions) * 100),
    inProgressCount,
    otherStatusCount: Math.max(totalSubmissions - knownStatusCount, 0),
    sourceCounts: [...sourceCounts.entries()]
      .map(([source, count]) => ({ count, source }))
      .sort((left, right) => right.count - left.count),
    stepAnalytics: input.steps.map((step) => {
      const metrics = stepMetrics.get(step.id);

      return {
        collectedCount: metrics?.collectedCount ?? 0,
        dropOffCount: metrics?.dropOffCount ?? 0,
        fieldKey: step.fieldKey,
        label: step.label || step.fieldKey || step.stepType,
        routeDecisionCount: metrics?.routeDecisionCount ?? 0,
        sortOrder: step.sortOrder,
        stepId: step.id,
        stepType: step.stepType,
        validationFailureCount: metrics?.validationFailureCount ?? 0,
      };
    }),
    submittedCount,
    totalSubmissions,
    validationFailureCount: events.filter(
      (event) => event.eventType === "flow.validation_failed",
    ).length,
  };
}

export async function getProjectActionFlowAnalytics(
  projectId: number,
): Promise<ProjectActionFlowAnalytics> {
  const actions = await listProjectActions(projectId);
  const flowDetails = await Promise.all(
    actions.map(async (action) => {
      const steps = await listActionFlowSteps(projectId, action.id);
      const analytics = await getActionFlowAnalytics({
        actionId: action.id,
        projectId,
        steps,
      });

      return {
        actionId: action.id,
        actionName: action.name,
        actionStatus: action.status,
        analytics,
        branchDecisionCount: analytics.branchDecisionCount,
        completionRate: analytics.completionRate,
        dropOffCount: analytics.stepAnalytics.reduce(
          (total, step) => total + step.dropOffCount,
          0,
        ),
        submittedCount: analytics.submittedCount,
        totalSubmissions: analytics.totalSubmissions,
        validationFailureCount: analytics.validationFailureCount,
      };
    }),
  );
  const flows = flowDetails.map(({ analytics: _analytics, ...flow }) => flow);
  const activeFlows = flows.filter((flow) => flow.actionStatus === "active");
  const totalSubmissions = flows.reduce(
    (total, flow) => total + flow.totalSubmissions,
    0,
  );
  const submittedCount = flows.reduce(
    (total, flow) => total + flow.submittedCount,
    0,
  );
  const validationFailureCount = flows.reduce(
    (total, flow) => total + flow.validationFailureCount,
    0,
  );
  const branchDecisionCount = flows.reduce(
    (total, flow) => total + flow.branchDecisionCount,
    0,
  );
  const dropOffCount = flows.reduce(
    (total, flow) => total + flow.dropOffCount,
    0,
  );

  return {
    actionCount: flows.length,
    activeActionCount: activeFlows.length,
    averageCompletionRate:
      totalSubmissions === 0
        ? 0
        : Math.round((submittedCount / totalSubmissions) * 100),
    branchDecisionCount,
    dropOffCount,
    flows: flows.sort((left, right) => {
      if (right.totalSubmissions !== left.totalSubmissions) {
        return right.totalSubmissions - left.totalSubmissions;
      }

      return left.actionName.localeCompare(right.actionName);
    }),
    submittedCount,
    topDropOffSteps: flowDetails
      .flatMap((flow) =>
        flow.analytics.stepAnalytics
          .filter((step) => step.dropOffCount > 0)
          .map((step) => ({
            actionId: flow.actionId,
            actionName: flow.actionName,
            dropOffCount: step.dropOffCount,
            fieldKey: step.fieldKey,
            label: step.label,
            sortOrder: step.sortOrder,
            stepId: step.stepId,
            stepType: step.stepType,
          })),
      )
      .sort((left, right) => {
        if (right.dropOffCount !== left.dropOffCount) {
          return right.dropOffCount - left.dropOffCount;
        }

        if (left.actionName !== right.actionName) {
          return left.actionName.localeCompare(right.actionName);
        }

        return left.sortOrder - right.sortOrder;
      })
      .slice(0, 10),
    totalSubmissions,
    validationFailureCount,
  };
}

function getStepIdFromPayload(payload: Record<string, unknown>) {
  if (typeof payload.stepId === "number" && Number.isInteger(payload.stepId)) {
    return payload.stepId;
  }

  const issueStepId = getStepIdFromIssues(payload.issues);
  return issueStepId;
}

function getSourceStepIdFromPayload(payload: Record<string, unknown>) {
  if (
    typeof payload.sourceStepId === "number" &&
    Number.isInteger(payload.sourceStepId)
  ) {
    return payload.sourceStepId;
  }

  return null;
}

function getStepIdFromIssues(issues: unknown) {
  if (!Array.isArray(issues)) {
    return null;
  }

  for (const issue of issues) {
    if (
      issue &&
      typeof issue === "object" &&
      "stepId" in issue &&
      typeof issue.stepId === "number" &&
      Number.isInteger(issue.stepId)
    ) {
      return issue.stepId;
    }
  }

  return null;
}
