export const PROJECT_ACTION_STATUSES = ["draft", "active", "archived"] as const;
export const ACTION_FLOW_VERSION_STATUSES = ["published", "archived"] as const;
export const ACTION_SUBMISSION_STATUSES = [
  "in_progress",
  "submitted",
  "under_review",
  "completed",
  "rejected",
  "cancelled",
] as const;
export const ACTION_STEP_TYPES = [
  "message",
  "collect_input",
  "choice",
  "date",
  "date_range",
  "address",
  "time",
  "number",
  "email",
  "phone",
  "location",
  "file_upload",
  "media",
  "template_message",
  "catalog_message",
  "single_product",
  "multiple_products",
  "product_selection",
  "display_result",
  "confirmation",
  "submit",
  "operation",
  "handoff",
  "connect_flow",
  "set_attribute",
  "add_tag",
] as const;
export const ACTION_STEP_INPUT_TYPES = [
  "text",
  "email",
  "phone",
  "date",
  "time",
  "int",
  "float",
] as const;
export const ACTION_BRANCH_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;

export type ProjectActionStatus = (typeof PROJECT_ACTION_STATUSES)[number];
export type ActionFlowVersionStatus =
  (typeof ACTION_FLOW_VERSION_STATUSES)[number];
export type ActionSubmissionStatus =
  (typeof ACTION_SUBMISSION_STATUSES)[number];
export type ActionStepType = (typeof ACTION_STEP_TYPES)[number];
export type ActionStepInputType = (typeof ACTION_STEP_INPUT_TYPES)[number];
export type ActionBranchOperator = (typeof ACTION_BRANCH_OPERATORS)[number];
