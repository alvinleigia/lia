import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import type {
  ActionFlowRouteValidationIssue,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "@/lib/action-flows";
import type { PublishedConversationalTaskOption } from "@/lib/conversational-tasks";

export type FlowStep = Awaited<ReturnType<typeof listActionFlowSteps>>[number];
export type BranchRule = Awaited<
  ReturnType<typeof listActionFlowBranchRules>
>[number];

export type CanvasNodeData = {
  label: ReactNode;
};

export type CanvasNode = Node<CanvasNodeData>;

export type OperationOption = {
  id: number;
  name: string;
};

export type MediaAssetOption = {
  id: number;
  label: string;
  mediaType: string;
};

export type ProductCatalogOption = {
  id: number;
  name: string;
};

export type ProjectActionOption = {
  id: number;
  name: string;
};

export type CatalogProductOption = {
  catalogId: number;
  catalogName: string;
  id: number;
  name: string;
  sku: string | null;
};

export type ActionFlowCanvasProps = {
  actionId: number;
  actionSettings: Record<string, unknown>;
  branchRules: BranchRule[];
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  operations: OperationOption[];
  productCatalogs: ProductCatalogOption[];
  projectActions: ProjectActionOption[];
  routeIssues: ActionFlowRouteValidationIssue[];
  steps: FlowStep[];
  taskOptions: PublishedConversationalTaskOption[];
};

export type HybridRouteTarget = number | "end";

export type HybridKnowledgeStepInput = {
  answeredRoute: HybridRouteTarget | null;
  goal: string;
  handoffRoute: HybridRouteTarget;
  isEnabled: boolean;
  label: string;
  noAnswerRoute: HybridRouteTarget;
  recommendationTargetStepIds: number[];
  remainActiveAfterAnswer: boolean;
  stageMode: "exact" | "goal_driven";
  stepType: "knowledge_conversation";
};

export type HybridTaskStepInput = {
  isEnabled: boolean;
  label: string;
  outcomeRoutes: Record<string, HybridRouteTarget>;
  stepType: "conversational_task";
  taskVersionId: number;
  transferContextKeys: string[];
  transferFieldKeys: string[];
};

export type HybridStepInput = HybridKnowledgeStepInput | HybridTaskStepInput;

export type HybridEntryRouteInput = {
  key: string;
  stepId: number;
};

export type HybridEntryPolicyInput = {
  campaignRoutes: HybridEntryRouteInput[];
  channelRoutes: HybridEntryRouteInput[];
  deepLinkRoutes: HybridEntryRouteInput[];
  normalStepId: number | null;
};

export type InspectorSelection =
  | { id: string; type: "edge" }
  | { id: string; type: "node" }
  | null;

export type CanvasBranchRuleInput = {
  branchLabel: string;
  comparisonValue: string;
  conditionGroup: string;
  isEnabled: boolean;
  operator: string;
  sortOrder: number;
  sourceFieldKey: string;
  sourceOptionId: string;
  sourceStepId: number;
  targetStepId: number;
};

export type BranchConditionDraft = {
  comparisonValue: string;
  fieldKey: string;
  id: string;
  operator: string;
};

export type BranchFieldOption = {
  fieldKey: string;
  inputType: "date" | "number" | "text" | "time";
  label: string;
};

export type CanvasStepInput = {
  cancellationStepId: string;
  choiceDisplayMode: string;
  contactAttributeFieldKey: string;
  contactAttributeKey: string;
  contactAttributeValue: string;
  contactAttributeValueSource: string;
  contactTagNames: string;
  connectedActionId: string;
  connectFlowMode: string;
  fieldKey: string;
  handoffNotifyTeam: boolean;
  handoffPriority: string;
  handoffQueue: string;
  inputType: string;
  isEnabled: boolean;
  isRequired: boolean;
  label: string;
  mediaAssetId: string;
  noReplyReminderMessage: string;
  noReplyReminderMinutes: string;
  noReplyTimeoutMessage: string;
  noReplyTimeoutMinutes: string;
  noReplyTimeoutStepId: string;
  operationExecutionMode: string;
  operationFailureStepId: string;
  operationId: string;
  operationSuccessStepId: string;
  options: string;
  productCatalogId: string;
  productDisplayLayout: string;
  productIds: string[];
  productSelectionAllowMultiple: boolean;
  productSelectionAllowQuantity: boolean;
  prompt: string;
  requiredMessage: string;
  retryCount: string;
  retryExhaustedStepId: string;
  retryMessage: string;
  stepType: string;
  validationAllowedFileTypes: string;
  validationMaxDate: string;
  validationMaxLength: string;
  validationMaxNumber: string;
  validationMessage: string;
  validationMinDate: string;
  validationMinLength: string;
  validationMinNumber: string;
  validationRegex: string;
  validationFailureStepId: string;
  waitAmount: string;
  waitUnit: string;
  whatsappTemplateBody: string;
  whatsappTemplateCategory: string;
  whatsappTemplateLanguage: string;
  whatsappTemplateName: string;
  whatsappTemplateStatus: string;
  whatsappTemplateVariables: string;
};

export type CanvasStepBasicsInput = {
  cancellationStepId?: string;
  choiceDisplayMode: string;
  contactAttributeFieldKey?: string;
  contactAttributeKey?: string;
  contactAttributeValue?: string;
  contactAttributeValueSource?: string;
  contactTagNames?: string;
  connectedActionId?: string;
  connectFlowMode?: string;
  contentBlocks: string;
  contentBlocksChanged: boolean;
  fieldKey?: string;
  handoffNotifyTeam?: boolean;
  handoffPriority?: string;
  handoffQueue?: string;
  inputType: string;
  isEnabled: boolean;
  isRequired: boolean;
  label: string;
  noReplyReminderMessage?: string;
  noReplyReminderMinutes?: string;
  noReplyTimeoutMessage?: string;
  noReplyTimeoutMinutes?: string;
  noReplyTimeoutStepId?: string;
  operationExecutionMode?: string;
  operationFailureStepId?: string;
  operationId?: string;
  operationSuccessStepId?: string;
  options: string;
  optionsChanged: boolean;
  prompt: string;
  retryCount?: string;
  retryExhaustedStepId?: string;
  retryMessage?: string;
  waitAmount?: string;
  waitUnit?: string;
  validationFailureStepId?: string;
};

export type CanvasMutationResult = {
  message: string;
  ok: boolean;
};

export type CanvasStepQuickSave = (
  stepId: number,
  input: CanvasStepBasicsInput,
) => Promise<CanvasMutationResult>;

export type CanvasQuickEditChange = (
  stepId: number,
  isEditing: boolean,
) => void;

export type CanvasOptionRouteChange = (
  stepId: number,
  optionId: string,
  targetStepId: number | null,
) => void;
