import { z } from "zod";
import {
  buildActionStepTextFallbackMessage,
  buildStepAnswerResult,
  getActionStepContentMedia,
  getActionStepContentProductGroups,
  getActionStepOptions,
  getActionStepProductCatalog,
  getActionStepProducts,
  getActionStepWhatsAppTemplate,
  isActionReplyOption,
  type RuntimeActionStep,
  validateStepAnswer,
} from "@/lib/action-runtime";
import { getFlowStepChannelCapabilityIssues } from "@/lib/flow-channel-capabilities";
import {
  getFlowCatalogContentBlocks,
  getFlowContentReadinessIssues,
  getFlowMediaContentBlocks,
} from "@/lib/flow-content-blocks";
import {
  doesFileMatchAllowedFileTypes,
  getInvalidAllowedFileTypeTokens,
  parseAllowedFileTypeTokens,
} from "@/lib/flow-file-validation";
import { isFlowMediaUploadValue } from "@/lib/flow-media-values";

const resourceFlowTestCheckV1Schema = z.object({
  detail: z.string(),
  key: z.string(),
  status: z.enum(["failed", "passed"]),
  stepId: z.number().int().positive(),
  stepLabel: z.string(),
});

export const resourceFlowTestReportV1Schema = z.object({
  checks: z.array(resourceFlowTestCheckV1Schema),
  checksFailed: z.number().int().nonnegative(),
  checksPassed: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  schemaVersion: z.literal(1),
  status: z.enum(["failed", "passed"]),
  stepsConsidered: z.number().int().nonnegative(),
  stepsTested: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type ResourceFlowTestReportV1 = z.infer<
  typeof resourceFlowTestReportV1Schema
>;

const RESOURCE_STEP_TYPES = new Set([
  "catalog_message",
  "file_upload",
  "media",
  "multiple_products",
  "product_selection",
  "single_product",
  "template_message",
]);

function getStepLabel(step: RuntimeActionStep) {
  return step.label?.trim() || step.prompt?.trim() || `Step ${step.sortOrder}`;
}

function addUnique(target: string[], message: string) {
  if (!target.includes(message)) {
    target.push(message);
  }
}

function getFileFixture(allowedFileTypes: string) {
  const token = parseAllowedFileTypeTokens(allowedFileTypes)[0]?.toLowerCase();

  if (!token || token === ".pdf") {
    return { name: "automated-test.pdf", type: "application/pdf" } as File;
  }
  if (token.startsWith(".")) {
    return {
      name: `automated-test${token}`,
      type: "application/octet-stream",
    } as File;
  }
  if (token.endsWith("/*")) {
    const family = token.slice(0, -2);
    const subtype = family === "image" ? "png" : "mpeg";
    return {
      name: `automated-test.${subtype}`,
      type: `${family}/${subtype}`,
    } as File;
  }

  return { name: "automated-test.bin", type: token } as File;
}

function isResourceBackedStep(step: RuntimeActionStep) {
  return (
    RESOURCE_STEP_TYPES.has(step.stepType) ||
    getFlowMediaContentBlocks(step.settings).length > 0 ||
    getFlowCatalogContentBlocks(step.settings).length > 0
  );
}

export function runResourceBackedHybridFlowTest(
  publishedSteps: RuntimeActionStep[],
): ResourceFlowTestReportV1 {
  const checks: ResourceFlowTestReportV1["checks"] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const testedStepIds = new Set<number>();
  const steps = publishedSteps
    .filter((step) => step.isEnabled && isResourceBackedStep(step))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  function addCheck(
    step: RuntimeActionStep,
    key: string,
    passed: boolean,
    detail: string,
  ) {
    const stepLabel = getStepLabel(step);
    checks.push({
      detail,
      key: `${step.id}:${key}`,
      status: passed ? "passed" : "failed",
      stepId: step.id,
      stepLabel,
    });
    testedStepIds.add(step.id);
    if (!passed) {
      addUnique(errors, `${stepLabel}: ${detail}`);
    }
  }

  for (const step of steps) {
    const readinessIssues = getFlowContentReadinessIssues(step.settings);
    addCheck(
      step,
      "content-readiness",
      readinessIssues.length === 0,
      readinessIssues.length === 0
        ? "Published content references are complete."
        : readinessIssues.join(" "),
    );

    for (const issue of getFlowStepChannelCapabilityIssues({
      id: step.id,
      options: Array.isArray(step.options) ? step.options : undefined,
      settings: step.settings,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    })) {
      addUnique(warnings, issue.message);
    }

    if (step.stepType === "file_upload") {
      const allowedFileTypes =
        typeof step.settings.validationAllowedFileTypes === "string"
          ? step.settings.validationAllowedFileTypes
          : "";
      const invalidTokens = getInvalidAllowedFileTypeTokens(allowedFileTypes);
      addCheck(
        step,
        "file-types",
        invalidTokens.length === 0,
        invalidTokens.length === 0
          ? "Published file-type rules accept a generated matching file."
          : `Invalid allowed file types: ${invalidTokens.join(", ")}.`,
      );

      if (invalidTokens.length === 0) {
        const fixture = getFileFixture(allowedFileTypes);
        addCheck(
          step,
          "file-match",
          doesFileMatchAllowedFileTypes(fixture, allowedFileTypes),
          "Generated file fixture matches the published acceptance rules.",
        );
      }

      const uploadValue = {
        mediaAssetId: 1,
        mediaType: "document",
        mimeType: "application/pdf",
        originalName: "automated-test.pdf",
        provider: "local" as const,
        publicPath: "/automated-test.pdf",
        sizeBytes: 1024,
      };
      const fieldKey = step.fieldKey || `file${step.id}`;
      const answer = buildStepAnswerResult(step, fieldKey, uploadValue);
      addCheck(
        step,
        "upload-value",
        isFlowMediaUploadValue(uploadValue) &&
          answer.fields[fieldKey] === uploadValue,
        "A valid media value is preserved by the production field builder.",
      );
    }

    if (step.stepType === "product_selection") {
      const options = getActionStepOptions(step, {}).filter(
        isActionReplyOption,
      );
      addCheck(
        step,
        "product-options",
        options.length > 0,
        options.length > 0
          ? `${options.length} published product option(s) resolved.`
          : "No published product options resolved.",
      );

      const firstOption = options[0];
      if (firstOption) {
        const quantityEnabled =
          step.settings.productSelectionAllowQuantity === true ||
          step.settings.productSelectionAllowMultiple === true;
        const input = quantityEnabled
          ? `${firstOption.label} x 2`
          : firstOption.label;
        const valid = validateStepAnswer(step, input, {});
        const invalid = validateStepAnswer(
          step,
          "__unknown_automated_product__",
          {},
        );
        addCheck(
          step,
          "product-answer",
          valid.isValid && !invalid.isValid,
          "Known products are accepted and unknown products are rejected.",
        );

        const fieldKey = step.fieldKey || `product${step.id}`;
        const answer = buildStepAnswerResult(step, fieldKey, valid.value, {});
        addCheck(
          step,
          "product-fields",
          valid.isValid && Object.hasOwn(answer.fields, fieldKey),
          "The production field builder records the selected product data.",
        );
      }
    }

    if (step.stepType === "media") {
      const mediaAsset = step.settings.mediaAsset;
      const validMedia = Boolean(
        mediaAsset &&
          typeof mediaAsset === "object" &&
          !Array.isArray(mediaAsset) &&
          typeof (mediaAsset as Record<string, unknown>).id === "number" &&
          typeof (mediaAsset as Record<string, unknown>).publicPath ===
            "string",
      );
      addCheck(
        step,
        "media-asset",
        validMedia,
        validMedia
          ? "Published media asset resolves to a runtime reference."
          : "Published media asset is missing or malformed.",
      );
    }

    if (step.stepType === "template_message") {
      const template = getActionStepWhatsAppTemplate(step);
      const fallback = buildActionStepTextFallbackMessage(step);
      addCheck(
        step,
        "template",
        Boolean(template && fallback.includes(template.name)),
        template
          ? "Published template metadata resolves with a text fallback."
          : "Published template name or language is missing.",
      );
    }

    if (
      ["catalog_message", "single_product", "multiple_products"].includes(
        step.stepType,
      )
    ) {
      const catalog = getActionStepProductCatalog(step);
      const products = getActionStepProducts(step);
      const hasExpectedProducts =
        step.stepType === "single_product"
          ? products.length === 1
          : products.length > 0;
      addCheck(
        step,
        "catalog-products",
        Boolean(catalog && hasExpectedProducts),
        catalog && hasExpectedProducts
          ? `${products.length} published product(s) resolve from ${catalog.name}.`
          : "Published catalog or product references are incomplete.",
      );
    }

    const composedMedia = getActionStepContentMedia(step);
    const composedProducts = getActionStepContentProductGroups(step);
    if (composedMedia.length > 0 || composedProducts.length > 0) {
      addCheck(
        step,
        "composed-resources",
        true,
        `${composedMedia.length} media item(s) and ${composedProducts.length} product group(s) resolve from composed content.`,
      );
    }
  }

  const checksFailed = checks.filter(
    (check) => check.status === "failed",
  ).length;

  return resourceFlowTestReportV1Schema.parse({
    checks,
    checksFailed,
    checksPassed: checks.length - checksFailed,
    errors,
    schemaVersion: 1,
    status: checksFailed === 0 ? "passed" : "failed",
    stepsConsidered: steps.length,
    stepsTested: testedStepIds.size,
    warnings,
  });
}
