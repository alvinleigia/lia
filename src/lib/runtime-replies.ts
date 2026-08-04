import {
  type ActionOptionBehavior,
  getActionOptionHref,
} from "@/lib/action-option-routing";
import type { RuntimeInputRequest } from "@/lib/runtime-input-request";
import { renderWhatsAppTemplateBodyPreview } from "@/lib/whatsapp-template-metadata";

export const RUNTIME_REPLY_SCHEMA_VERSION = 1 as const;

export const RUNTIME_REPLY_INTENTS = [
  "content",
  "question",
  "choices",
  "confirmation",
  "media",
  "handoff",
  "outcome",
] as const;

export type RuntimeReplyIntent = (typeof RUNTIME_REPLY_INTENTS)[number];

export type RuntimeReplyType =
  | "buttons"
  | "catalog"
  | "handoff"
  | "list"
  | "media"
  | "template"
  | "text";

export type RuntimeReplyOption = {
  actionType?: ActionOptionBehavior;
  actionValue?: string;
  description?: string;
  id: string;
  label: string;
  section?: string;
  value: string;
};

export type RuntimeReply = {
  fallbackText: string;
  intent?: RuntimeReplyIntent;
  payload?: Record<string, unknown>;
  schemaVersion?: typeof RUNTIME_REPLY_SCHEMA_VERSION;
  text: string;
  type: RuntimeReplyType;
};

export type RuntimeReplyV1 = RuntimeReply & {
  intent: RuntimeReplyIntent;
  schemaVersion: typeof RUNTIME_REPLY_SCHEMA_VERSION;
};

export type RuntimeReplyMedia = {
  id: number;
  mediaType: string;
  mimeType: string;
  originalName: string;
  publicPath: string;
};

export type RuntimeReplyProduct = {
  currency: string | null;
  description: string | null;
  id: number;
  imageUrl: string | null;
  name: string;
  priceAmount: number | null;
  productUrl: string | null;
  sku: string | null;
  whatsappRetailerId?: string | null;
};

export type RuntimeReplyTemplate = {
  body?: string | null;
  category?: "authentication" | "marketing" | "utility";
  language: string;
  name: string;
  status?: "approved" | "draft" | "pending" | "rejected";
  variables: string[];
};

export function createTextReply(
  text: string,
  payload?: Record<string, unknown>,
  intent: RuntimeReplyIntent = "content",
): RuntimeReplyV1 {
  return {
    fallbackText: text,
    intent,
    payload,
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text,
    type: "text",
  };
}

function buildChoiceFallbackText(input: {
  options: RuntimeReplyOption[];
  text: string;
}) {
  if (input.options.length === 0) {
    return input.text;
  }

  return [
    input.text,
    "",
    ...input.options.map((option, index) => {
      const href = getActionOptionHref(option);
      return href
        ? `${index + 1}. ${option.label} - ${href}`
        : `${index + 1}. ${option.label}`;
    }),
  ].join("\n");
}

export function createChoiceReply(input: {
  displayMode: "buttons" | "list" | "text";
  footer?: string;
  header?: string;
  intent?: Extract<RuntimeReplyIntent, "choices" | "confirmation">;
  options: RuntimeReplyOption[];
  text: string;
}): RuntimeReplyV1 {
  const fallbackText = buildChoiceFallbackText(input);

  if (input.displayMode === "text" || input.options.length === 0) {
    return {
      fallbackText,
      intent: input.intent ?? "choices",
      payload: {
        displayMode: input.displayMode,
        footer: input.footer,
        header: input.header,
        options: input.options,
      },
      schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
      text: input.text,
      type: "text",
    };
  }

  return {
    fallbackText,
    intent: input.intent ?? "choices",
    payload: {
      displayMode: input.displayMode,
      footer: input.footer,
      header: input.header,
      options: input.options,
    },
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text: input.text,
    type: input.displayMode === "list" ? "list" : "buttons",
  };
}

function formatProductPrice(product: RuntimeReplyProduct) {
  if (product.priceAmount === null) {
    return "";
  }

  return new Intl.NumberFormat("en", {
    currency: product.currency ?? "USD",
    style: "currency",
  }).format(product.priceAmount / 100);
}

function buildProductFallbackText(input: {
  products: RuntimeReplyProduct[];
  text: string;
}) {
  if (input.products.length === 0) {
    return input.text;
  }

  return [
    input.text,
    "",
    ...input.products.map((product, index) => {
      const price = formatProductPrice(product);
      const details = [price, product.description, product.productUrl]
        .filter(Boolean)
        .join(" - ");

      return details
        ? `${index + 1}. ${product.name} - ${details}`
        : `${index + 1}. ${product.name}`;
    }),
  ].join("\n");
}

export function createProductReply(input: {
  catalog?: {
    externalId?: string | null;
    id: number;
    name: string;
    providerType?: string;
  } | null;
  mode: "catalog" | "multiple_products" | "single_product";
  products: RuntimeReplyProduct[];
  text: string;
}): RuntimeReplyV1 {
  return {
    fallbackText: buildProductFallbackText(input),
    intent: "content",
    payload: {
      catalog: input.catalog ?? null,
      mode: input.mode,
      products: input.products,
    },
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text: input.text,
    type: "catalog",
  };
}

export function createMediaReply(input: {
  media: RuntimeReplyMedia;
  text: string;
}): RuntimeReplyV1 {
  const fallbackText = [
    input.text,
    "",
    `${input.media.originalName}: ${input.media.publicPath}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    fallbackText,
    intent: "media",
    payload: {
      media: input.media,
    },
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text: input.text,
    type: "media",
  };
}

export function createTemplateReply(input: {
  template: RuntimeReplyTemplate;
  text: string;
}): RuntimeReplyV1 {
  const bodyPreview = renderWhatsAppTemplateBodyPreview(
    input.template.body,
    input.template.variables,
  );
  const variableLines =
    input.template.variables.length > 0
      ? [
          "",
          ...input.template.variables.map(
            (variable, index) => `${index + 1}. ${variable}`,
          ),
        ]
      : [];

  return {
    fallbackText: [
      input.text,
      "",
      `Template: ${input.template.name} (${input.template.language})`,
      ...(bodyPreview ? ["", bodyPreview] : []),
      ...variableLines,
    ].join("\n"),
    intent: "content",
    payload: {
      template: input.template,
    },
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text: input.text,
    type: "template",
  };
}

export function createHandoffReply(text: string): RuntimeReplyV1 {
  return {
    fallbackText: text,
    intent: "handoff",
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text,
    type: "handoff",
  };
}

type TaskReplyNextAction =
  | "ask"
  | "clarify"
  | "lookup"
  | "confirm"
  | "complete"
  | "cancel"
  | "handoff"
  | "fail";

export function createTaskRuntimeReply(input: {
  inputRequest?: RuntimeInputRequest | null;
  nextAction: TaskReplyNextAction;
  text: string;
}): RuntimeReplyV1 {
  if (input.nextAction === "handoff") {
    return createHandoffReply(input.text);
  }

  if (input.nextAction === "confirm") {
    const options = [
      {
        id: "task-confirm",
        label: "Confirm",
        value: "confirm",
      },
      {
        id: "task-cancel",
        label: "Cancel",
        value: "cancel",
      },
    ];
    const reply = createChoiceReply({
      displayMode: "buttons",
      intent: "confirmation",
      options,
      text: input.text,
    });

    return {
      ...reply,
      payload: {
        ...reply.payload,
        inputRequest: {
          fieldKey: "lia_confirmation",
          inputKind: "choice",
          label: "Confirmation",
          options,
          required: true,
        } satisfies RuntimeInputRequest,
      },
    };
  }

  if (
    input.nextAction === "ask" &&
    input.inputRequest?.inputKind === "choice" &&
    input.inputRequest.options.length > 0
  ) {
    const reply = createChoiceReply({
      displayMode: "buttons",
      options: input.inputRequest.options.map((option) => ({
        id: `task-field:${input.inputRequest?.fieldKey}:${option.value}`,
        label: option.label,
        value: option.value,
      })),
      text: input.text,
    });

    return {
      ...reply,
      payload: { ...reply.payload, inputRequest: input.inputRequest },
    };
  }

  const intent: RuntimeReplyIntent =
    input.nextAction === "complete" ||
    input.nextAction === "cancel" ||
    input.nextAction === "fail"
      ? "outcome"
      : input.inputRequest?.inputKind === "media"
        ? "media"
        : "question";

  return createTextReply(
    input.text,
    input.inputRequest ? { inputRequest: input.inputRequest } : undefined,
    intent,
  );
}

export function normalizeRuntimeReply(value: unknown): RuntimeReplyV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const reply = value as Record<string, unknown>;
  const type = reply.type;
  if (
    typeof type !== "string" ||
    ![
      "buttons",
      "catalog",
      "handoff",
      "list",
      "media",
      "template",
      "text",
    ].includes(type) ||
    typeof reply.text !== "string" ||
    typeof reply.fallbackText !== "string" ||
    (reply.payload !== undefined &&
      (!reply.payload ||
        typeof reply.payload !== "object" ||
        Array.isArray(reply.payload)))
  ) {
    return null;
  }

  const intent = RUNTIME_REPLY_INTENTS.includes(
    reply.intent as RuntimeReplyIntent,
  )
    ? (reply.intent as RuntimeReplyIntent)
    : type === "handoff"
      ? "handoff"
      : type === "media"
        ? "media"
        : type === "buttons" || type === "list"
          ? "choices"
          : "content";

  return {
    fallbackText: reply.fallbackText,
    intent,
    ...(reply.payload
      ? { payload: reply.payload as Record<string, unknown> }
      : {}),
    schemaVersion: RUNTIME_REPLY_SCHEMA_VERSION,
    text: reply.text,
    type: type as RuntimeReplyType,
  };
}

export function getRuntimeReplyText(reply: RuntimeReply) {
  return reply.fallbackText || reply.text;
}
