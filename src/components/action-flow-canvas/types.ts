import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import type {
  ActionFlowRouteValidationIssue,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "@/lib/action-flows";

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
  branchRules: BranchRule[];
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  operations: OperationOption[];
  productCatalogs: ProductCatalogOption[];
  projectActions: ProjectActionOption[];
  routeIssues: ActionFlowRouteValidationIssue[];
  steps: FlowStep[];
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
  operationExecutionMode?: string;
  operationFailureStepId?: string;
  operationId?: string;
  operationSuccessStepId?: string;
  options: string;
  optionsChanged: boolean;
  prompt: string;
  waitAmount?: string;
  waitUnit?: string;
};

export type CanvasStepQuickSave = (
  stepId: number,
  input: CanvasStepBasicsInput,
) => Promise<{ message: string; ok: boolean }>;

export type CanvasQuickEditChange = (
  stepId: number,
  isEditing: boolean,
) => void;
