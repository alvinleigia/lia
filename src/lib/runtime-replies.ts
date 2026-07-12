import { renderWhatsAppTemplateBodyPreview } from "@/lib/whatsapp-template-metadata";

export type RuntimeReplyType =
  | "buttons"
  | "catalog"
  | "handoff"
  | "list"
  | "media"
  | "template"
  | "text";

export type RuntimeReplyOption = {
  description?: string;
  id: string;
  label: string;
  value: string;
};

export type RuntimeReply = {
  fallbackText: string;
  payload?: Record<string, unknown>;
  text: string;
  type: RuntimeReplyType;
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
): RuntimeReply {
  return {
    fallbackText: text,
    payload,
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
    ...input.options.map((option, index) => `${index + 1}. ${option.label}`),
  ].join("\n");
}

export function createChoiceReply(input: {
  displayMode: "buttons" | "list" | "text";
  options: RuntimeReplyOption[];
  text: string;
}): RuntimeReply {
  const fallbackText = buildChoiceFallbackText(input);

  if (input.displayMode === "text" || input.options.length === 0) {
    return {
      fallbackText,
      payload: {
        displayMode: input.displayMode,
        options: input.options,
      },
      text: input.text,
      type: "text",
    };
  }

  return {
    fallbackText,
    payload: {
      displayMode: input.displayMode,
      options: input.options,
    },
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
}): RuntimeReply {
  return {
    fallbackText: buildProductFallbackText(input),
    payload: {
      catalog: input.catalog ?? null,
      mode: input.mode,
      products: input.products,
    },
    text: input.text,
    type: "catalog",
  };
}

export function createMediaReply(input: {
  media: RuntimeReplyMedia;
  text: string;
}): RuntimeReply {
  const fallbackText = [
    input.text,
    "",
    `${input.media.originalName}: ${input.media.publicPath}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    fallbackText,
    payload: {
      media: input.media,
    },
    text: input.text,
    type: "media",
  };
}

export function createTemplateReply(input: {
  template: RuntimeReplyTemplate;
  text: string;
}): RuntimeReply {
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
    payload: {
      template: input.template,
    },
    text: input.text,
    type: "template",
  };
}

export function getRuntimeReplyText(reply: RuntimeReply) {
  return reply.fallbackText || reply.text;
}
