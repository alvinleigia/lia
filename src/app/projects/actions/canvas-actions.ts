"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { parseStoredActionFlowConditionGroup } from "@/lib/action-flow-compiler";
import type { ProjectActionStatus } from "@/lib/action-flow-constants";
import {
  ACTION_BRANCH_OPERATORS,
  ACTION_STEP_INPUT_TYPES,
  type ActionBranchOperator,
  createActionFlowBranchRule,
  createActionFlowStep,
  deleteActionFlowBranchRule,
  deleteActionFlowStep,
  getActionFlowBranchRule,
  getActionFlowStep,
  getProjectAction,
  listActionFlowBranchRulesForStep,
  listActionFlowSteps,
  setActionFlowStepDefaultRoute,
  setActionFlowStepSettings,
  syncOperationStepRoutePresets,
  updateActionFlowBranchRule,
  updateActionFlowStep,
  updateProjectAction,
} from "@/lib/action-flows";
import {
  ACTION_OPTION_ROUTE_SETTINGS_KEY,
  buildStoredActionOptionRoute,
  getStoredActionOptionRoute,
  getStoredActionOptions,
} from "@/lib/action-option-routing";
import {
  getActionStepOptions,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import {
  createActionStepSchema,
  mergeActionStepOptions,
  parseActionStepOptions,
} from "@/lib/action-step-schema";
import { buildActionStepSettings } from "@/lib/action-step-settings";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import { getPublishedConversationalTaskOption } from "@/lib/conversational-tasks";
import {
  buildFlowContentDocument,
  type FlowContentBlock,
  getFlowChoiceContentBlock,
  getFlowContentBlocks,
  getFlowContentCompositionIssues,
  getFlowResponseCollectorBlocks,
  getFlowResponseCollectorCompatibilityIssue,
  parseFlowContentBlocks,
} from "@/lib/flow-content-blocks";
import { getFlowInputType, isFlowInputStepType } from "@/lib/flow-input-editor";
import {
  conversationalTaskFlowNodeSettingsV1Schema,
  hybridFlowEntryPolicySettingsV1Schema,
  knowledgeFlowNodeSettingsV1Schema,
} from "@/lib/hybrid-flow-contracts";
import { getProjectMediaAsset } from "@/lib/media-assets";
import { getProjectOperation } from "@/lib/operations";
import {
  getProjectCatalog,
  listProjectCatalogProductsByIds,
  listProjectCatalogProductsForCatalog,
} from "@/lib/product-catalogs";

type CanvasRouteActionResult = {
  message: string;
  ok: boolean;
};

const optionalValidationNumber = (schema: z.ZodType<number>) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

const canvasRouteSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  sourceStepId: z.coerce.number().int().positive(),
  targetStepId: z.coerce.number().int().positive(),
});

const clearCanvasRouteSchema = canvasRouteSchema.omit({ targetStepId: true });
const canvasOptionRouteSchema = canvasRouteSchema.extend({
  sourceOptionId: z.string().trim().min(1).max(160),
});
const clearCanvasOptionRouteSchema = canvasOptionRouteSchema.omit({
  targetStepId: true,
});
const canvasStepPositionsSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  positions: z
    .array(
      z.object({
        stepId: z.coerce.number().int().positive(),
        x: z.coerce.number().finite().min(-10_000).max(10_000),
        y: z.coerce.number().finite().min(-10_000).max(10_000),
      }),
    )
    .min(1)
    .max(200),
});
const canvasStepSchema = createActionStepSchema({});
const hybridRouteTargetSchema = z.union([
  z.literal("end"),
  z.number().int().positive(),
]);
const hybridStepBaseSchema = z.object({
  actionId: z.number().int().positive(),
  isEnabled: z.boolean(),
  label: z.string().trim().min(1).max(160),
  stepId: z.number().int().positive().optional(),
});
const hybridKnowledgeStepSchema = hybridStepBaseSchema.extend({
  answeredRoute: hybridRouteTargetSchema.nullable(),
  goal: z.string().trim().min(1).max(1000),
  handoffRoute: hybridRouteTargetSchema,
  noAnswerRoute: hybridRouteTargetSchema,
  recommendationTargetStepIds: z.array(z.number().int().positive()).max(50),
  remainActiveAfterAnswer: z.boolean(),
  stageMode: z.enum(["exact", "goal_driven"]),
  stepType: z.literal("knowledge_conversation"),
});
const hybridTaskStepSchema = hybridStepBaseSchema.extend({
  outcomeRoutes: z.record(
    z.string().trim().min(1).max(160),
    hybridRouteTargetSchema,
  ),
  stepType: z.literal("conversational_task"),
  taskVersionId: z.number().int().positive(),
  transferContextKeys: z.array(z.string().trim().min(1).max(160)).max(100),
  transferFieldKeys: z.array(z.string().trim().min(1).max(160)).max(100),
});
const hybridStepSchema = z.discriminatedUnion("stepType", [
  hybridKnowledgeStepSchema,
  hybridTaskStepSchema,
]);
const hybridEntryRouteSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z][a-zA-Z0-9_.:-]*$/),
  stepId: z.number().int().positive(),
});
const hybridEntryPolicySchema = z.object({
  actionId: z.number().int().positive(),
  campaignRoutes: z.array(hybridEntryRouteSchema).max(100),
  channelRoutes: z.array(hybridEntryRouteSchema).max(100),
  deepLinkRoutes: z.array(hybridEntryRouteSchema).max(100),
  normalStepId: z.number().int().positive().nullable(),
});
const canvasStepBasicsSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  choiceDisplayMode: z.enum(["buttons", "list", "text"]),
  contactAttributeFieldKey: z.string().trim().max(120).optional(),
  contactAttributeKey: z.string().trim().max(120).optional(),
  contactAttributeValue: z.string().trim().max(1000).optional(),
  contactAttributeValueSource: z.enum(["field", "static"]).optional(),
  contactTagNames: z.string().trim().max(1000).optional(),
  connectedActionId: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  connectFlowMode: z.enum(["jump", "return"]).optional(),
  contentBlocks: z.string().max(100000),
  contentBlocksChanged: z.coerce.boolean(),
  fieldKey: z.string().trim().max(80).optional(),
  handoffNotifyTeam: z.coerce.boolean().optional(),
  handoffPriority: z.enum(["high", "low", "normal", "urgent"]).optional(),
  handoffQueue: z.string().trim().max(120).optional(),
  waitAmount: optionalValidationNumber(
    z.coerce.number().int().min(1).max(2_592_000),
  ),
  waitUnit: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(["seconds", "minutes", "hours", "days"]).optional(),
  ),
  inputType: z.enum(ACTION_STEP_INPUT_TYPES).optional(),
  stepId: z.coerce.number().int().positive(),
  isEnabled: z.coerce.boolean(),
  isRequired: z.coerce.boolean(),
  label: z.string().trim().max(160),
  operationExecutionMode: z.enum(["post_submit", "inline"]).optional(),
  operationFailureStepId: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  operationId: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  operationSuccessStepId: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  options: z.string().max(4000),
  optionsChanged: z.coerce.boolean(),
  prompt: z.string().trim().max(1000),
});
const canvasBranchRuleSchema = z
  .object({
    actionId: z.coerce.number().int().positive(),
    ruleId: z.coerce.number().int().positive().optional(),
    sourceStepId: z.coerce.number().int().positive(),
    sourceFieldKey: z.string().trim().min(1).max(80),
    sourceOptionId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().trim().min(1).max(160).optional(),
    ),
    operator: z.enum(ACTION_BRANCH_OPERATORS),
    comparisonValue: z.string().trim().max(240).optional(),
    branchLabel: z.string().trim().max(80).optional(),
    conditionGroup: z.string().max(8000).optional(),
    targetStepId: z.coerce.number().int().positive(),
    sortOrder: z.coerce.number().int().positive(),
    isEnabled: z.coerce.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const needsComparison = !["is_empty", "is_not_empty"].includes(
      data.operator,
    );

    if (needsComparison && !data.comparisonValue?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Comparison value is required.",
        path: ["comparisonValue"],
      });
    }

    if (data.sourceStepId === data.targetStepId) {
      ctx.addIssue({
        code: "custom",
        message: "Target step must be different from source step.",
        path: ["targetStepId"],
      });
    }

    if (data.conditionGroup) {
      try {
        const parsedGroup = parseStoredActionFlowConditionGroup(
          JSON.parse(data.conditionGroup),
        );
        if (!parsedGroup.group) {
          ctx.addIssue({
            code: "custom",
            message: parsedGroup.message,
            path: ["conditionGroup"],
          });
        } else {
          for (const [
            index,
            condition,
          ] of parsedGroup.group.conditions.entries()) {
            const conditionNeedsComparison = ![
              "is_empty",
              "is_not_empty",
            ].includes(condition.operator);
            if (
              conditionNeedsComparison &&
              !condition.comparisonValue?.trim()
            ) {
              ctx.addIssue({
                code: "custom",
                message: `Condition ${index + 1} needs a comparison value.`,
                path: ["conditionGroup"],
              });
            }
          }
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Condition group must be valid JSON.",
          path: ["conditionGroup"],
        });
      }
    }
  });
const deleteCanvasBranchRuleSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  ruleId: z.coerce.number().int().positive(),
});
const deleteCanvasStepSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
});

async function resolveCanvasAction(actionId: number) {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const action = await getProjectAction(context.project.id, actionId);

  if (!action) {
    return { error: "Action not found." as const };
  }

  return { ...context, action };
}

function revalidateCanvasPaths(actionId: number) {
  revalidatePath(`/projects/actions/${actionId}`);
  revalidatePath(`/projects/actions/${actionId}/canvas`);
}

function buildBranchRuleSettings(
  existingSettings: Record<string, unknown> | undefined,
  branchLabel: string | undefined,
  conditionGroup: string | undefined,
  sourceOptionId: string | undefined,
) {
  const settings = { ...(existingSettings ?? {}) };

  if (branchLabel !== undefined) {
    const label = branchLabel.trim();
    if (label) {
      settings.branchLabel = label;
    } else {
      delete settings.branchLabel;
    }
  }

  if (conditionGroup !== undefined) {
    const parsed = parseStoredActionFlowConditionGroup(
      JSON.parse(conditionGroup),
    );
    if (parsed.group) {
      settings.conditionGroup = parsed.group;
    }
  }

  if (sourceOptionId !== undefined) {
    settings[ACTION_OPTION_ROUTE_SETTINGS_KEY] =
      buildStoredActionOptionRoute(sourceOptionId);
  }

  return settings;
}

function asSettingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getDuplicateEntryKey(routes: Array<{ key: string; stepId: number }>) {
  const keys = new Set<string>();
  for (const route of routes) {
    if (keys.has(route.key)) {
      return route.key;
    }
    keys.add(route.key);
  }
  return null;
}

function hasAvailableHybridRouteTarget(
  target: number | "end" | null,
  stepIds: Set<number>,
  sourceStepId?: number,
) {
  return (
    target === null ||
    target === "end" ||
    (stepIds.has(target) && target !== sourceStepId)
  );
}

function revalidateHybridCanvasPaths(actionId: number) {
  revalidateCanvasPaths(actionId);
  revalidatePath(`/projects/actions/${actionId}/hybrid-test`);
}

async function requireCanvasConnectedAction(input: {
  actionId: number;
  connectedActionId?: number;
  projectId: number;
  stepType: string;
}) {
  if (input.stepType !== "connect_flow") {
    return null;
  }

  if (!input.connectedActionId || input.connectedActionId === input.actionId) {
    return null;
  }

  const connectedAction = await getProjectAction(
    input.projectId,
    input.connectedActionId,
  );

  return connectedAction?.status === "active" ? connectedAction : null;
}

async function requireCanvasStep(input: {
  projectId: number;
  actionId: number;
  stepId: number;
}) {
  return getActionFlowStep(input.projectId, input.actionId, input.stepId);
}

async function getRemovedConnectedOptionLabel(input: {
  actionId: number;
  existingOptions: unknown;
  nextOptions: unknown;
  projectId: number;
  stepId: number;
}) {
  const nextOptionIds = new Set(
    getStoredActionOptions(input.nextOptions).map((option) => option.id),
  );
  const removedOptions = getStoredActionOptions(input.existingOptions).filter(
    (option) => !nextOptionIds.has(option.id),
  );
  if (removedOptions.length === 0) {
    return null;
  }

  const rules = await listActionFlowBranchRulesForStep(
    input.projectId,
    input.actionId,
    input.stepId,
  );
  const connectedOptionIds = new Set(
    rules
      .map((rule) => getStoredActionOptionRoute(rule.settings)?.sourceOptionId)
      .filter((optionId): optionId is string => Boolean(optionId)),
  );

  return (
    removedOptions.find((option) => connectedOptionIds.has(option.id))?.label ??
    null
  );
}

async function requireCanvasOperation(input: {
  operationId: number | undefined;
  projectId: number;
  stepType: string;
}) {
  if (!["handoff", "operation"].includes(input.stepType)) {
    return null;
  }

  if (!input.operationId) {
    return null;
  }

  const operation = await getProjectOperation(
    input.projectId,
    input.operationId,
  );

  return operation?.operation ?? null;
}

async function requireCanvasMediaAsset(input: {
  mediaAssetId: number | undefined;
  projectId: number;
  stepType: string;
}) {
  if (input.stepType !== "media") {
    return null;
  }

  if (!input.mediaAssetId) {
    return null;
  }

  return getProjectMediaAsset(input.projectId, input.mediaAssetId);
}

async function requireCanvasProductConfig(input: {
  productCatalogId: number | undefined;
  productIds: number[] | undefined;
  projectId: number;
  stepType: string;
}) {
  if (
    ![
      "catalog_message",
      "single_product",
      "multiple_products",
      "product_selection",
    ].includes(input.stepType)
  ) {
    return { productCatalog: null, products: [] };
  }

  const productIds = input.productIds ?? [];
  const selectedProducts =
    productIds.length > 0
      ? await listProjectCatalogProductsByIds(input.projectId, productIds)
      : [];
  const catalogId =
    input.productCatalogId ?? selectedProducts[0]?.catalogId ?? null;

  if (!catalogId) {
    return { productCatalog: null, products: selectedProducts };
  }

  const productCatalog = await getProjectCatalog(input.projectId, catalogId);
  const products =
    input.stepType === "catalog_message" ||
    (input.stepType === "product_selection" && productIds.length === 0)
      ? await listProjectCatalogProductsForCatalog(input.projectId, catalogId)
      : selectedProducts.filter((product) => product.catalogId === catalogId);

  return {
    productCatalog,
    products:
      input.stepType === "single_product" ? products.slice(0, 1) : products,
  };
}

async function hydrateCanvasContentBlocks(input: {
  blocks: FlowContentBlock[];
  projectId: number;
}) {
  return Promise.all(
    input.blocks.map(async (block): Promise<FlowContentBlock> => {
      if (block.type === "media") {
        const mediaAsset = await getProjectMediaAsset(
          input.projectId,
          block.mediaAssetId,
        );

        if (!mediaAsset) {
          throw new Error("Selected media is no longer available.");
        }

        return {
          ...block,
          media: {
            id: mediaAsset.id,
            mediaType: mediaAsset.mediaType,
            mimeType: mediaAsset.mimeType,
            originalName: mediaAsset.originalName,
            publicPath: mediaAsset.publicPath,
          },
        };
      }

      if (block.type !== "catalog") {
        return block;
      }

      const catalog = await getProjectCatalog(input.projectId, block.catalogId);
      if (!catalog) {
        throw new Error("Selected product catalog is no longer available.");
      }

      const requestedProductIds = Array.from(new Set(block.productIds));
      const selectedProducts =
        requestedProductIds.length > 0
          ? await listProjectCatalogProductsByIds(
              input.projectId,
              requestedProductIds,
            )
          : await listProjectCatalogProductsForCatalog(
              input.projectId,
              catalog.id,
            );
      const products = selectedProducts
        .filter((product) => product.catalogId === catalog.id)
        .slice(0, 50);

      if (
        requestedProductIds.length > 0 &&
        products.length !== requestedProductIds.length
      ) {
        throw new Error("One or more selected products are unavailable.");
      }

      if (block.displayMode === "single_product" && products.length !== 1) {
        throw new Error("Choose one product for the single product block.");
      }

      if (block.displayMode === "multiple_products" && products.length === 0) {
        throw new Error("Choose at least one product for this block.");
      }

      return {
        ...block,
        catalog: {
          externalId: catalog.externalId,
          id: catalog.id,
          name: catalog.name,
          providerType: catalog.providerType,
        },
        productIds: products.map((product) => product.id),
        products: products.map((product) => ({
          currency: product.currency,
          description: product.description,
          id: product.id,
          imageUrl: product.imageUrl,
          name: product.name,
          priceAmount: product.priceAmount,
          productUrl: product.productUrl,
          sku: product.sku,
          whatsappRetailerId:
            typeof product.metadata.whatsappRetailerId === "string"
              ? product.metadata.whatsappRetailerId
              : null,
        })),
      };
    }),
  );
}

export async function saveCanvasHybridStepAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = hybridStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the hybrid step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const existingStep = parsed.data.stepId
    ? (steps.find((step) => step.id === parsed.data.stepId) ?? null)
    : null;

  if (
    parsed.data.stepId &&
    (!existingStep || existingStep.stepType !== parsed.data.stepType)
  ) {
    return { ok: false, message: "Hybrid step not found." };
  }

  const stepIds = new Set(steps.map((step) => step.id));
  const sourceStepId = existingStep?.id;
  let settings: Record<string, unknown> = {
    ...(existingStep?.settings ?? {}),
    nodeLabel: parsed.data.label,
  };
  let prompt = "";

  if (parsed.data.stepType === "knowledge_conversation") {
    const allTargets = [
      parsed.data.answeredRoute,
      parsed.data.noAnswerRoute,
      parsed.data.handoffRoute,
    ];
    if (
      allTargets.some(
        (target) =>
          !hasAvailableHybridRouteTarget(target, stepIds, sourceStepId),
      )
    ) {
      return {
        ok: false,
        message: "Every knowledge route must use an available flow step.",
      };
    }
    if (
      !parsed.data.remainActiveAfterAnswer &&
      parsed.data.answeredRoute === null
    ) {
      return {
        ok: false,
        message: "Choose where to go after a successful answer.",
      };
    }

    const taskStepIds = new Set(
      steps
        .filter((step) => step.stepType === "conversational_task")
        .map((step) => step.id),
    );
    if (
      parsed.data.recommendationTargetStepIds.some(
        (stepId) => !taskStepIds.has(stepId),
      )
    ) {
      return {
        ok: false,
        message: "Recommendations can only open Business Task steps.",
      };
    }

    const knowledgeSettings = knowledgeFlowNodeSettingsV1Schema.parse({
      answeredRoute: parsed.data.answeredRoute,
      handoffRoute: parsed.data.handoffRoute,
      noAnswerRoute: parsed.data.noAnswerRoute,
      recommendationTargetStepIds: parsed.data.recommendationTargetStepIds,
      remainActiveAfterAnswer: parsed.data.remainActiveAfterAnswer,
      schemaVersion: 1,
      stageMode: parsed.data.stageMode,
    });
    settings = {
      ...settings,
      knowledgeConversation: knowledgeSettings,
      knowledgeGoal: parsed.data.goal,
    };
    delete settings.conversationalTask;
    prompt = parsed.data.goal;
  } else {
    const task = await getPublishedConversationalTaskOption({
      projectId: project.id,
      taskVersionId: parsed.data.taskVersionId,
    });
    if (!task) {
      return {
        ok: false,
        message: "Choose an available published business task version.",
      };
    }

    const taskStep = parsed.data;
    const outputPorts = Array.from(
      new Set(task.outcomes.map((outcome) => outcome.outputPort)),
    );
    const outcomeRoutes = Object.fromEntries(
      outputPorts.flatMap((outputPort) => {
        const target = taskStep.outcomeRoutes[outputPort];
        return target === undefined ? [] : [[outputPort, target]];
      }),
    );
    if (
      outputPorts.some((outputPort) => outcomeRoutes[outputPort] === undefined)
    ) {
      return {
        ok: false,
        message: "Choose a destination for every task outcome.",
      };
    }
    if (
      Object.values(outcomeRoutes).some(
        (target) =>
          !hasAvailableHybridRouteTarget(target, stepIds, sourceStepId),
      )
    ) {
      return {
        ok: false,
        message: "Every task outcome must use an available flow step.",
      };
    }

    const transferFieldKeys = Array.from(new Set(taskStep.transferFieldKeys));
    const transferContextKeys = Array.from(
      new Set(taskStep.transferContextKeys),
    );
    if (
      transferFieldKeys.some((key) => !task.fieldKeys.includes(key)) ||
      transferContextKeys.some((key) => !task.contextKeys.includes(key))
    ) {
      return {
        ok: false,
        message: "One or more selected task values are unavailable.",
      };
    }

    const taskSettings = conversationalTaskFlowNodeSettingsV1Schema.parse({
      outcomeRoutes,
      schemaVersion: 1,
      task: {
        name: task.name,
        outcomes: task.outcomes,
        schemaVersion: 1,
        taskId: task.taskId,
        taskVersionId: task.taskVersionId,
        versionNumber: task.versionNumber,
      },
      transferContextKeys,
      transferFieldKeys,
    });
    settings = {
      ...settings,
      conversationalTask: taskSettings,
    };
    delete settings.knowledgeConversation;
    delete settings.knowledgeGoal;
    prompt = task.objective;
  }

  const sortOrder =
    existingStep?.sortOrder ??
    steps.reduce((maximum, step) => Math.max(maximum, step.sortOrder), 0) + 1;
  const step = existingStep
    ? await updateActionFlowStep({
        actionId: action.id,
        fieldKey: null,
        inputType: null,
        isEnabled: parsed.data.isEnabled,
        isRequired: false,
        label: parsed.data.label,
        nextStepId: null,
        operationId: null,
        options: [],
        projectId: project.id,
        prompt,
        settings,
        sortOrder,
        stepId: existingStep.id,
        stepType: parsed.data.stepType,
      })
    : await createActionFlowStep({
        actionId: action.id,
        fieldKey: null,
        inputType: null,
        isEnabled: parsed.data.isEnabled,
        isRequired: false,
        label: parsed.data.label,
        nextStepId: null,
        operationId: null,
        options: [],
        projectId: project.id,
        prompt,
        settings,
        sortOrder,
        stepType: parsed.data.stepType,
      });

  if (!step) {
    return { ok: false, message: "Could not save the hybrid step." };
  }

  await writeAuditLog({
    ...context,
    action: existingStep
      ? "chatbot_action.hybrid_step_updated"
      : "chatbot_action.hybrid_step_created",
    metadata: {
      actionId: action.id,
      stepType: step.stepType,
    },
    targetId: step.id,
    targetType: "action_flow_step",
  });
  revalidateHybridCanvasPaths(action.id);

  return {
    ok: true,
    message: existingStep ? "Hybrid step updated." : "Hybrid step created.",
  };
}

export async function saveHybridEntryPolicyAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = hybridEntryPolicySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the entry rules." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  for (const routes of [
    parsed.data.deepLinkRoutes,
    parsed.data.campaignRoutes,
    parsed.data.channelRoutes,
  ]) {
    const duplicateKey = getDuplicateEntryKey(routes);
    if (duplicateKey) {
      return {
        ok: false,
        message: `Entry key "${duplicateKey}" is used more than once.`,
      };
    }
  }

  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const stepIds = new Set(
    steps.filter((step) => step.isEnabled).map((step) => step.id),
  );
  const selectedStepIds = [
    parsed.data.normalStepId,
    ...parsed.data.deepLinkRoutes.map((route) => route.stepId),
    ...parsed.data.campaignRoutes.map((route) => route.stepId),
    ...parsed.data.channelRoutes.map((route) => route.stepId),
  ].filter((stepId): stepId is number => stepId !== null);

  if (selectedStepIds.some((stepId) => !stepIds.has(stepId))) {
    return {
      ok: false,
      message: "Every entry rule must start at an enabled flow step.",
    };
  }

  const entryPolicy = hybridFlowEntryPolicySettingsV1Schema.parse({
    campaignRoutes: Object.fromEntries(
      parsed.data.campaignRoutes.map((route) => [route.key, route.stepId]),
    ),
    channelRoutes: Object.fromEntries(
      parsed.data.channelRoutes.map((route) => [route.key, route.stepId]),
    ),
    deepLinkRoutes: Object.fromEntries(
      parsed.data.deepLinkRoutes.map((route) => [route.key, route.stepId]),
    ),
    normalStepId: parsed.data.normalStepId,
    schemaVersion: 1,
  });
  const updated = await updateProjectAction({
    actionId: action.id,
    description: action.description,
    name: action.name,
    projectId: project.id,
    settings: {
      ...action.settings,
      hybridEntryPolicy: entryPolicy,
    },
    status: action.status as ProjectActionStatus,
    triggerPhrases: action.triggerPhrases,
  });
  if (!updated) {
    return { ok: false, message: "Could not save the entry rules." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.hybrid_entry_policy_updated",
    metadata: {
      actionId: action.id,
      campaignRouteCount: parsed.data.campaignRoutes.length,
      channelRouteCount: parsed.data.channelRoutes.length,
      deepLinkRouteCount: parsed.data.deepLinkRoutes.length,
      normalStepId: parsed.data.normalStepId,
    },
    targetId: action.id,
    targetType: "project_action",
  });
  revalidateHybridCanvasPaths(action.id);

  return { ok: true, message: "Entry rules saved." };
}

export async function createCanvasStepAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Please check the step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const sortOrder =
    steps.reduce((max, step) => Math.max(max, step.sortOrder), 0) + 1;
  const isInputStep = isFlowInputStepType(parsed.data.stepType);
  const inputType = getFlowInputType(
    parsed.data.stepType,
    parsed.data.inputType,
  );
  const operation = await requireCanvasOperation({
    operationId: parsed.data.operationId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const mediaAsset = await requireCanvasMediaAsset({
    mediaAssetId: parsed.data.mediaAssetId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const productConfig = await requireCanvasProductConfig({
    productCatalogId: parsed.data.productCatalogId,
    productIds: parsed.data.productIds,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const connectedAction = await requireCanvasConnectedAction({
    actionId: action.id,
    connectedActionId: parsed.data.connectedActionId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });

  if (
    parsed.data.stepType === "operation" ||
    (parsed.data.stepType === "handoff" && parsed.data.operationId)
  ) {
    if (!operation) {
      return { ok: false, message: "Operation must belong to this project." };
    }
  }

  if (parsed.data.stepType === "operation" && !operation) {
    return { ok: false, message: "Operation must belong to this project." };
  }

  if (parsed.data.stepType === "media" && !mediaAsset) {
    return { ok: false, message: "Media asset must belong to this project." };
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    return {
      ok: false,
      message: "Connected flow must be an active flow in this project.",
    };
  }

  try {
    const step = await createActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      sortOrder,
      stepType: parsed.data.stepType,
      fieldKey:
        isInputStep || parsed.data.stepType === "operation"
          ? parsed.data.fieldKey || null
          : null,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep ? inputType : null,
      operationId:
        parsed.data.stepType === "operation" ||
        parsed.data.stepType === "handoff"
          ? (operation?.id ?? null)
          : null,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled ?? true,
      options: isInputStep ? parseActionStepOptions(parsed.data.options) : [],
      settings: buildActionStepSettings({
        stepType: parsed.data.stepType,
        choiceDisplayMode: parsed.data.choiceDisplayMode,
        contactAttributeFieldKey: parsed.data.contactAttributeFieldKey,
        contactAttributeKey: parsed.data.contactAttributeKey,
        contactAttributeValue: parsed.data.contactAttributeValue,
        contactAttributeValueSource: parsed.data.contactAttributeValueSource,
        contactTagNames: parsed.data.contactTagNames,
        connectedAction,
        connectFlowMode: parsed.data.connectFlowMode,
        handoffNotifyTeam: parsed.data.handoffNotifyTeam,
        handoffPriority: parsed.data.handoffPriority,
        handoffQueue: parsed.data.handoffQueue,
        waitAmount: parsed.data.waitAmount,
        waitUnit: parsed.data.waitUnit,
        mediaAsset,
        operationExecutionMode: parsed.data.operationExecutionMode,
        whatsappTemplateCategory: parsed.data.whatsappTemplateCategory,
        whatsappTemplateBody: parsed.data.whatsappTemplateBody,
        whatsappTemplateLanguage: parsed.data.whatsappTemplateLanguage,
        whatsappTemplateName: parsed.data.whatsappTemplateName,
        whatsappTemplateStatus: parsed.data.whatsappTemplateStatus,
        whatsappTemplateVariables: parsed.data.whatsappTemplateVariables,
        productDisplayLayout: parsed.data.productDisplayLayout,
        productSelectionAllowMultiple:
          parsed.data.productSelectionAllowMultiple,
        productSelectionAllowQuantity:
          parsed.data.productSelectionAllowQuantity,
        requiredMessage: parsed.data.requiredMessage,
        validationAllowedFileTypes: parsed.data.validationAllowedFileTypes,
        validationMaxDate: parsed.data.validationMaxDate,
        validationMaxLength: parsed.data.validationMaxLength,
        validationMaxNumber: parsed.data.validationMaxNumber,
        validationMessage: parsed.data.validationMessage,
        validationMinDate: parsed.data.validationMinDate,
        validationMinLength: parsed.data.validationMinLength,
        validationMinNumber: parsed.data.validationMinNumber,
        validationRegex: parsed.data.validationRegex,
        ...productConfig,
      }),
    });
    await syncOperationStepRoutePresets({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step.fieldKey ?? undefined,
      projectId: project.id,
      sourceStepId: step.id,
      stepType: step.stepType,
      successStepId: parsed.data.operationSuccessStepId,
    });

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_step_created",
      targetType: "action_flow_step",
      targetId: step.id,
      metadata: {
        actionId: action.id,
        fieldKey: step.fieldKey,
        sortOrder: step.sortOrder,
        stepType: step.stepType,
      },
    });
  } catch {
    return { ok: false, message: "Could not create the step." };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step created." };
}

export async function updateCanvasStepAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepSchema.safeParse(input);

  if (!parsed.success || !parsed.data.stepId) {
    return { ok: false, message: "Please check the step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const existingStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.stepId,
  );

  if (!existingStep) {
    return { ok: false, message: "Step not found." };
  }

  const isInputStep = isFlowInputStepType(parsed.data.stepType);
  const inputType = getFlowInputType(
    parsed.data.stepType,
    parsed.data.inputType,
  );
  const operation = await requireCanvasOperation({
    operationId: parsed.data.operationId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const mediaAsset = await requireCanvasMediaAsset({
    mediaAssetId: parsed.data.mediaAssetId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const productConfig = await requireCanvasProductConfig({
    productCatalogId: parsed.data.productCatalogId,
    productIds: parsed.data.productIds,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const connectedAction = await requireCanvasConnectedAction({
    actionId: action.id,
    connectedActionId: parsed.data.connectedActionId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });

  if (
    parsed.data.stepType === "operation" ||
    (parsed.data.stepType === "handoff" && parsed.data.operationId)
  ) {
    if (!operation) {
      return { ok: false, message: "Operation must belong to this project." };
    }
  }

  if (parsed.data.stepType === "media" && !mediaAsset) {
    return { ok: false, message: "Media asset must belong to this project." };
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    return {
      ok: false,
      message: "Connected flow must be an active flow in this project.",
    };
  }

  const options = isInputStep
    ? mergeActionStepOptions(parsed.data.options, existingStep.options)
    : [];
  const connectedRemovedOption = await getRemovedConnectedOptionLabel({
    actionId: action.id,
    existingOptions: existingStep.options,
    nextOptions: options,
    projectId: project.id,
    stepId: existingStep.id,
  });
  if (connectedRemovedOption) {
    return {
      ok: false,
      message: `Clear the Go to route for "${connectedRemovedOption}" before deleting it.`,
    };
  }

  try {
    const step = await updateActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      stepId: existingStep.id,
      sortOrder: existingStep.sortOrder,
      stepType: parsed.data.stepType,
      fieldKey:
        isInputStep || parsed.data.stepType === "operation"
          ? parsed.data.fieldKey || null
          : null,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep ? inputType : null,
      operationId:
        parsed.data.stepType === "operation" ||
        parsed.data.stepType === "handoff"
          ? (operation?.id ?? null)
          : null,
      nextStepId: existingStep.nextStepId,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled ?? true,
      options,
      settings: buildActionStepSettings({
        stepType: parsed.data.stepType,
        choiceDisplayMode: parsed.data.choiceDisplayMode,
        contactAttributeFieldKey: parsed.data.contactAttributeFieldKey,
        contactAttributeKey: parsed.data.contactAttributeKey,
        contactAttributeValue: parsed.data.contactAttributeValue,
        contactAttributeValueSource: parsed.data.contactAttributeValueSource,
        contactTagNames: parsed.data.contactTagNames,
        connectedAction,
        connectFlowMode: parsed.data.connectFlowMode,
        existingSettings: existingStep.settings,
        handoffNotifyTeam: parsed.data.handoffNotifyTeam,
        handoffPriority: parsed.data.handoffPriority,
        handoffQueue: parsed.data.handoffQueue,
        waitAmount: parsed.data.waitAmount,
        waitUnit: parsed.data.waitUnit,
        mediaAsset,
        operationExecutionMode: parsed.data.operationExecutionMode,
        whatsappTemplateCategory: parsed.data.whatsappTemplateCategory,
        whatsappTemplateBody: parsed.data.whatsappTemplateBody,
        whatsappTemplateLanguage: parsed.data.whatsappTemplateLanguage,
        whatsappTemplateName: parsed.data.whatsappTemplateName,
        whatsappTemplateStatus: parsed.data.whatsappTemplateStatus,
        whatsappTemplateVariables: parsed.data.whatsappTemplateVariables,
        productDisplayLayout: parsed.data.productDisplayLayout,
        productSelectionAllowMultiple:
          parsed.data.productSelectionAllowMultiple,
        productSelectionAllowQuantity:
          parsed.data.productSelectionAllowQuantity,
        requiredMessage: parsed.data.requiredMessage,
        validationAllowedFileTypes: parsed.data.validationAllowedFileTypes,
        validationMaxDate: parsed.data.validationMaxDate,
        validationMaxLength: parsed.data.validationMaxLength,
        validationMaxNumber: parsed.data.validationMaxNumber,
        validationMessage: parsed.data.validationMessage,
        validationMinDate: parsed.data.validationMinDate,
        validationMinLength: parsed.data.validationMinLength,
        validationMinNumber: parsed.data.validationMinNumber,
        validationRegex: parsed.data.validationRegex,
        ...productConfig,
      }),
    });
    await syncOperationStepRoutePresets({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step?.fieldKey ?? undefined,
      projectId: project.id,
      sourceStepId: existingStep.id,
      stepType: parsed.data.stepType,
      successStepId: parsed.data.operationSuccessStepId,
    });

    if (!step) {
      return { ok: false, message: "Could not update the step." };
    }

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_step_updated",
      targetType: "action_flow_step",
      targetId: step.id,
      metadata: {
        actionId: action.id,
        fieldKey: step.fieldKey,
        sortOrder: step.sortOrder,
        stepType: step.stepType,
      },
    });
  } catch {
    return { ok: false, message: "Could not update the step." };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step updated." };
}

export async function updateCanvasStepBasicsAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepBasicsSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Please check the step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const existingStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.stepId,
  );

  if (!existingStep) {
    return { ok: false, message: "Step not found." };
  }

  const isInputStep = isFlowInputStepType(existingStep.stepType);
  const isActionStep = [
    "add_tag",
    "connect_flow",
    "handoff",
    "operation",
    "set_attribute",
    "submit",
    "wait",
  ].includes(existingStep.stepType);
  const operation = isActionStep
    ? await requireCanvasOperation({
        operationId: parsed.data.operationId,
        projectId: project.id,
        stepType: existingStep.stepType,
      })
    : null;
  const connectedAction = isActionStep
    ? await requireCanvasConnectedAction({
        actionId: action.id,
        connectedActionId: parsed.data.connectedActionId,
        projectId: project.id,
        stepType: existingStep.stepType,
      })
    : null;

  if (
    existingStep.stepType === "operation" ||
    (existingStep.stepType === "handoff" && parsed.data.operationId)
  ) {
    if (!operation) {
      return { ok: false, message: "Operation must belong to this project." };
    }
  }

  if (existingStep.stepType === "connect_flow" && !connectedAction) {
    return {
      ok: false,
      message: "Connected flow must be an active flow in this project.",
    };
  }

  if (
    existingStep.stepType === "set_attribute" &&
    (!parsed.data.contactAttributeKey?.trim() ||
      (parsed.data.contactAttributeValueSource === "static"
        ? !parsed.data.contactAttributeValue?.trim()
        : !parsed.data.contactAttributeFieldKey?.trim()))
  ) {
    return { ok: false, message: "Choose the contact detail and its value." };
  }

  if (
    existingStep.stepType === "add_tag" &&
    !parsed.data.contactTagNames?.trim()
  ) {
    return { ok: false, message: "Add at least one contact tag." };
  }
  const existingContentBlocks = getFlowContentBlocks(existingStep.settings);
  let contentBlocks = existingContentBlocks;

  if (parsed.data.contentBlocksChanged) {
    try {
      const rawContentBlocks = JSON.parse(parsed.data.contentBlocks) as unknown;
      const parsedContentBlocks = parseFlowContentBlocks(rawContentBlocks);

      if (
        !Array.isArray(rawContentBlocks) ||
        parsedContentBlocks.length !== rawContentBlocks.length
      ) {
        return { ok: false, message: "Please check the added content." };
      }

      contentBlocks = await hydrateCanvasContentBlocks({
        blocks: parsedContentBlocks,
        projectId: project.id,
      });
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Please check the added content.",
      };
    }
  }

  const existingChoiceContent = getFlowChoiceContentBlock(
    existingStep.settings,
  );
  const responseCollectors = getFlowResponseCollectorBlocks(contentBlocks);
  const choiceContent = responseCollectors[0] ?? null;
  const compositionIssue = getFlowContentCompositionIssues(contentBlocks)[0];
  if (compositionIssue) {
    return { ok: false, message: compositionIssue.message };
  }

  const dynamicSourceType =
    typeof existingStep.settings.sourceType === "string"
      ? existingStep.settings.sourceType
      : "";
  const hasDynamicOptions = ["catalog_categories", "catalog_items"].includes(
    dynamicSourceType,
  );
  const requiresPrompt =
    isInputStep ||
    ["display_result", "handoff", "message"].includes(existingStep.stepType);
  let options = existingStep.options;

  const collectorCompatibilityIssue =
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions,
      hasManualOptions: existingStep.options.length > 0,
      hasStoredResponseCollector: Boolean(existingChoiceContent),
      isInputStep,
    });
  if (choiceContent && collectorCompatibilityIssue) {
    return {
      ok: false,
      message: collectorCompatibilityIssue,
    };
  }

  if (choiceContent && parsed.data.contentBlocksChanged) {
    options = choiceContent.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
    }));
  } else if (
    existingChoiceContent &&
    !choiceContent &&
    parsed.data.contentBlocksChanged
  ) {
    options = [];
  } else if (isInputStep && parsed.data.optionsChanged && !hasDynamicOptions) {
    options = mergeActionStepOptions(parsed.data.options, existingStep.options);
  }

  if (isInputStep && !parsed.data.label) {
    return { ok: false, message: "Add a step name before saving." };
  }

  if (requiresPrompt && !parsed.data.prompt) {
    return { ok: false, message: "Add the message shown to visitors." };
  }

  if (
    existingStep.stepType === "choice" &&
    !hasDynamicOptions &&
    options.length === 0
  ) {
    return { ok: false, message: "Add at least one choice before saving." };
  }

  const connectedRemovedOption = await getRemovedConnectedOptionLabel({
    actionId: action.id,
    existingOptions: existingStep.options,
    nextOptions: options,
    projectId: project.id,
    stepId: existingStep.id,
  });
  if (connectedRemovedOption) {
    return {
      ok: false,
      message: `Clear the Go to route for "${connectedRemovedOption}" before deleting it.`,
    };
  }

  let settings = { ...existingStep.settings };
  if (parsed.data.contentBlocksChanged) {
    if (contentBlocks.length > 0) {
      settings.contentDocument = buildFlowContentDocument(contentBlocks);
      delete settings.contentBlocks;
    } else {
      delete settings.contentDocument;
      delete settings.contentBlocks;
    }
  }

  if (choiceContent) {
    settings.choiceDisplayMode = choiceContent.displayMode;
  }

  if (
    !choiceContent &&
    (existingStep.stepType === "choice" ||
      hasDynamicOptions ||
      options.length > 0)
  ) {
    settings.choiceDisplayMode = parsed.data.choiceDisplayMode;
  }

  if (isActionStep) {
    settings = buildActionStepSettings({
      contactAttributeFieldKey: parsed.data.contactAttributeFieldKey,
      contactAttributeKey: parsed.data.contactAttributeKey,
      contactAttributeValue: parsed.data.contactAttributeValue,
      contactAttributeValueSource: parsed.data.contactAttributeValueSource,
      contactTagNames: parsed.data.contactTagNames,
      connectedAction,
      connectFlowMode: parsed.data.connectFlowMode,
      existingSettings: settings,
      handoffNotifyTeam: parsed.data.handoffNotifyTeam,
      handoffPriority: parsed.data.handoffPriority,
      handoffQueue: parsed.data.handoffQueue,
      waitAmount: parsed.data.waitAmount,
      waitUnit: parsed.data.waitUnit,
      operationExecutionMode: parsed.data.operationExecutionMode,
      stepType: existingStep.stepType,
    });
  }

  try {
    const step = await updateActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      stepId: existingStep.id,
      sortOrder: existingStep.sortOrder,
      stepType: existingStep.stepType,
      fieldKey:
        existingStep.stepType === "operation"
          ? parsed.data.fieldKey || null
          : existingStep.fieldKey,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep
        ? getFlowInputType(
            existingStep.stepType,
            parsed.data.inputType ?? existingStep.inputType,
          )
        : existingStep.inputType,
      operationId:
        existingStep.stepType === "operation" ||
        existingStep.stepType === "handoff"
          ? (operation?.id ?? null)
          : existingStep.operationId,
      nextStepId: existingStep.nextStepId,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled,
      options,
      settings,
    });

    if (!step) {
      return { ok: false, message: "Could not update the step." };
    }

    await syncOperationStepRoutePresets({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step.fieldKey ?? undefined,
      projectId: project.id,
      sourceStepId: step.id,
      stepType: step.stepType,
      successStepId: parsed.data.operationSuccessStepId,
    });

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_step_updated",
      targetType: "action_flow_step",
      targetId: step.id,
      metadata: {
        actionId: action.id,
        editMode: "basic",
        fieldKey: step.fieldKey,
        sortOrder: step.sortOrder,
        stepType: step.stepType,
      },
    });
  } catch {
    return { ok: false, message: "Could not update the step." };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step updated." };
}

export async function saveCanvasStepPositionsAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepPositionsSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid canvas layout." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const stepsById = new Map(steps.map((step) => [step.id, step]));

  for (const position of parsed.data.positions) {
    if (!stepsById.has(position.stepId)) {
      return { ok: false, message: "All nodes must belong to this action." };
    }
  }

  for (const position of parsed.data.positions) {
    const step = stepsById.get(position.stepId);
    if (!step) {
      continue;
    }

    await setActionFlowStepSettings({
      projectId: project.id,
      actionId: action.id,
      stepId: step.id,
      settings: {
        ...asSettingsRecord(step.settings),
        canvasPosition: {
          x: Math.round(position.x),
          y: Math.round(position.y),
        },
      },
    });
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_layout_saved",
    targetType: "project_action",
    targetId: action.id,
    metadata: {
      actionId: action.id,
      nodeCount: parsed.data.positions.length,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Canvas layout saved." };
}

export async function setCanvasDefaultRouteAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasRouteSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid canvas route." };
  }

  if (parsed.data.sourceStepId === parsed.data.targetStepId) {
    return { ok: false, message: "A step cannot route to itself." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [sourceStep, targetStep] = await Promise.all([
    getActionFlowStep(project.id, action.id, parsed.data.sourceStepId),
    getActionFlowStep(project.id, action.id, parsed.data.targetStepId),
  ]);

  if (!sourceStep || !targetStep) {
    return { ok: false, message: "Both steps must belong to this action." };
  }

  if (sourceStep.stepType === "submit") {
    return { ok: false, message: "Submit steps cannot have a default route." };
  }

  const step = await setActionFlowStepDefaultRoute({
    projectId: project.id,
    actionId: action.id,
    stepId: sourceStep.id,
    nextStepId: targetStep.id,
  });

  if (!step) {
    return { ok: false, message: "Could not save the default route." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_default_route_updated",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: {
      actionId: action.id,
      sourceStepId: sourceStep.id,
      targetStepId: targetStep.id,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Default route saved." };
}

export async function clearCanvasDefaultRouteAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = clearCanvasRouteSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid canvas route." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const sourceStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.sourceStepId,
  );

  if (!sourceStep) {
    return { ok: false, message: "Step not found." };
  }

  const step = await setActionFlowStepDefaultRoute({
    projectId: project.id,
    actionId: action.id,
    stepId: sourceStep.id,
    nextStepId: null,
  });

  if (!step) {
    return { ok: false, message: "Could not clear the default route." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_default_route_cleared",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: {
      actionId: action.id,
      sourceStepId: sourceStep.id,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Default route cleared." };
}

export async function setCanvasOptionRouteAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasOptionRouteSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.sourceStepId === parsed.data.targetStepId
  ) {
    return { ok: false, message: "Please check the option route." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [sourceStep, targetStep, sourceRules] = await Promise.all([
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.sourceStepId,
    }),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.targetStepId,
    }),
    listActionFlowBranchRulesForStep(
      project.id,
      action.id,
      parsed.data.sourceStepId,
    ),
  ]);

  if (!sourceStep || !targetStep || !sourceStep.fieldKey) {
    return {
      ok: false,
      message: "The option and destination must belong to this action.",
    };
  }

  if (
    sourceStep.stepType === "product_selection" &&
    (sourceStep.settings.productSelectionAllowMultiple === true ||
      sourceStep.settings.productSelectionAllowQuantity === true)
  ) {
    return {
      ok: false,
      message:
        "Per-product routes require a single product selection without quantity.",
    };
  }

  const option = getActionStepOptions(sourceStep as RuntimeActionStep).find(
    (candidate) => candidate.id === parsed.data.sourceOptionId,
  );
  if (!option) {
    return {
      ok: false,
      message: "This option is no longer available on the source step.",
    };
  }

  const matchingRules = sourceRules.filter(
    (rule) =>
      getStoredActionOptionRoute(rule.settings)?.sourceOptionId === option.id,
  );
  if (matchingRules.length > 1) {
    return {
      ok: false,
      message: "Resolve the duplicate option routes before changing this one.",
    };
  }

  const settings = {
    [ACTION_OPTION_ROUTE_SETTINGS_KEY]: buildStoredActionOptionRoute(option.id),
  };
  const existingRule = matchingRules[0] ?? null;
  try {
    const rule = existingRule
      ? await updateActionFlowBranchRule({
          projectId: project.id,
          actionId: action.id,
          ruleId: existingRule.id,
          sourceStepId: sourceStep.id,
          sourceFieldKey: sourceStep.fieldKey,
          operator: "equals",
          comparisonValue: String(option.value),
          targetStepId: targetStep.id,
          sortOrder: existingRule.sortOrder,
          isEnabled: true,
          settings,
        })
      : await createActionFlowBranchRule({
          projectId: project.id,
          actionId: action.id,
          sourceStepId: sourceStep.id,
          sourceFieldKey: sourceStep.fieldKey,
          operator: "equals",
          comparisonValue: String(option.value),
          targetStepId: targetStep.id,
          sortOrder:
            sourceRules.reduce(
              (highest, candidate) => Math.max(highest, candidate.sortOrder),
              0,
            ) + 1,
          isEnabled: true,
          settings,
        });

    if (!rule) {
      return { ok: false, message: "The option route could not be saved." };
    }

    await writeAuditLog({
      ...context,
      action: existingRule
        ? "chatbot_action.canvas_option_route_updated"
        : "chatbot_action.canvas_option_route_created",
      targetType: "action_flow_branch_rule",
      targetId: rule.id,
      metadata: {
        actionId: action.id,
        sourceOptionId: option.id,
        sourceOutputPort: option.outputPort,
        sourceStepId: sourceStep.id,
        targetStepId: targetStep.id,
      },
    });
  } catch {
    return {
      ok: false,
      message: "The option route conflicted with another saved route.",
    };
  }

  revalidateCanvasPaths(action.id);
  return { ok: true, message: "Option route saved." };
}

export async function clearCanvasOptionRouteAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = clearCanvasOptionRouteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the option route." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const sourceStep = await requireCanvasStep({
    projectId: project.id,
    actionId: action.id,
    stepId: parsed.data.sourceStepId,
  });
  if (!sourceStep) {
    return { ok: false, message: "Source step not found." };
  }

  const sourceRules = await listActionFlowBranchRulesForStep(
    project.id,
    action.id,
    sourceStep.id,
  );
  const matchingRules = sourceRules.filter(
    (rule) =>
      getStoredActionOptionRoute(rule.settings)?.sourceOptionId ===
      parsed.data.sourceOptionId,
  );

  if (matchingRules.length !== 1) {
    return {
      ok: false,
      message:
        matchingRules.length > 1
          ? "Resolve the duplicate option routes before clearing this one."
          : "This option does not have a saved route.",
    };
  }

  await deleteActionFlowBranchRule(project.id, action.id, matchingRules[0].id);
  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_option_route_cleared",
    targetType: "action_flow_branch_rule",
    targetId: matchingRules[0].id,
    metadata: {
      actionId: action.id,
      sourceOptionId: parsed.data.sourceOptionId,
      sourceStepId: sourceStep.id,
    },
  });

  revalidateCanvasPaths(action.id);
  return { ok: true, message: "Option route cleared." };
}

export async function createCanvasBranchRuleAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasBranchRuleSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Please check the branch rule." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [sourceStep, targetStep] = await Promise.all([
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.sourceStepId,
    }),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.targetStepId,
    }),
  ]);

  if (!sourceStep || !targetStep) {
    return { ok: false, message: "Both steps must belong to this action." };
  }

  try {
    const rule = await createActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      sourceStepId: sourceStep.id,
      sourceFieldKey: parsed.data.sourceFieldKey,
      operator: parsed.data.operator as ActionBranchOperator,
      comparisonValue: parsed.data.comparisonValue || null,
      targetStepId: targetStep.id,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled ?? true,
      settings: buildBranchRuleSettings(
        undefined,
        parsed.data.branchLabel,
        parsed.data.conditionGroup,
        parsed.data.sourceOptionId,
      ),
    });

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_branch_rule_created",
      targetType: "action_flow_branch_rule",
      targetId: rule.id,
      metadata: {
        actionId: action.id,
        sourceFieldKey: rule.sourceFieldKey,
        sourceStepId: rule.sourceStepId,
        targetStepId: rule.targetStepId,
      },
    });
  } catch {
    return {
      ok: false,
      message: "Branch rule order must be unique for this source step.",
    };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Branch rule created." };
}

export async function updateCanvasBranchRuleAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasBranchRuleSchema.safeParse(input);

  if (!parsed.success || !parsed.data.ruleId) {
    return { ok: false, message: "Please check the branch rule." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [existingRule, sourceStep, targetStep] = await Promise.all([
    getActionFlowBranchRule(project.id, action.id, parsed.data.ruleId),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.sourceStepId,
    }),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.targetStepId,
    }),
  ]);

  if (!existingRule) {
    return { ok: false, message: "Branch rule not found." };
  }

  if (!sourceStep || !targetStep) {
    return { ok: false, message: "Both steps must belong to this action." };
  }

  try {
    const rule = await updateActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      ruleId: existingRule.id,
      sourceStepId: sourceStep.id,
      sourceFieldKey: parsed.data.sourceFieldKey,
      operator: parsed.data.operator as ActionBranchOperator,
      comparisonValue: parsed.data.comparisonValue || null,
      targetStepId: targetStep.id,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled ?? true,
      settings: buildBranchRuleSettings(
        existingRule.settings,
        parsed.data.branchLabel,
        parsed.data.conditionGroup,
        parsed.data.sourceOptionId,
      ),
    });

    if (rule) {
      await writeAuditLog({
        ...context,
        action: "chatbot_action.canvas_branch_rule_updated",
        targetType: "action_flow_branch_rule",
        targetId: rule.id,
        metadata: {
          actionId: action.id,
          sourceFieldKey: rule.sourceFieldKey,
          sourceStepId: rule.sourceStepId,
          targetStepId: rule.targetStepId,
        },
      });
    }
  } catch {
    return {
      ok: false,
      message: "Branch rule order must be unique for this source step.",
    };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Branch rule updated." };
}

export async function deleteCanvasBranchRuleAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = deleteCanvasBranchRuleSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid branch rule." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const rule = await deleteActionFlowBranchRule(
    project.id,
    action.id,
    parsed.data.ruleId,
  );

  if (!rule) {
    return { ok: false, message: "Branch rule not found." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_branch_rule_deleted",
    targetType: "action_flow_branch_rule",
    targetId: rule.id,
    metadata: {
      actionId: action.id,
      sourceFieldKey: rule.sourceFieldKey,
      sourceStepId: rule.sourceStepId,
      targetStepId: rule.targetStepId,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Branch rule deleted." };
}

export async function deleteCanvasStepAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = deleteCanvasStepSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid step." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const step = await deleteActionFlowStep(
    project.id,
    action.id,
    parsed.data.stepId,
  );

  if (!step) {
    return { ok: false, message: "Step not found." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_step_deleted",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: {
      actionId: action.id,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step deleted." };
}
