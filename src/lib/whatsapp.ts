import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { CHANNEL_METADATA_LAST_INBOUND_AT } from "@/lib/channels";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  companies,
  projectChannels,
  projects,
  type SelectProjectChannel,
  workspaces,
} from "@/lib/db-schema";
import type { FlowMediaUploadValue } from "@/lib/flow-media-values";
import type { FlowLocationValue } from "@/lib/flow-structured-values";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  saveProjectMediaBytes,
} from "@/lib/media-assets";
import {
  getRuntimeReplyText,
  type RuntimeReply,
  type RuntimeReplyMedia,
  type RuntimeReplyOption,
  type RuntimeReplyProduct,
  type RuntimeReplyTemplate,
} from "@/lib/runtime-replies";

export type WhatsAppChannelConfig = {
  businessAccountId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  businessName?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
};

export type WhatsAppWebhookMessage = {
  audio?: WhatsAppWebhookMedia;
  document?: WhatsAppWebhookMedia & {
    filename?: string;
  };
  from: string;
  id?: string;
  image?: WhatsAppWebhookMedia;
  interactive?: {
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
    };
    type?: string;
  };
  location?: {
    address?: string;
    latitude?: number;
    longitude?: number;
    name?: string;
  };
  order?: {
    catalog_id?: string;
    product_items?: Array<{
      currency?: string;
      item_price?: number;
      product_retailer_id?: string;
      quantity?: number;
    }>;
    text?: string;
  };
  sticker?: WhatsAppWebhookMedia & {
    animated?: boolean;
  };
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
  video?: WhatsAppWebhookMedia;
};

type WhatsAppWebhookMedia = {
  caption?: string;
  id?: string;
  mime_type?: string;
  sha256?: string;
};

type WhatsAppMessageRequestBody = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type:
    | "audio"
    | "document"
    | "image"
    | "interactive"
    | "template"
    | "text"
    | "video";
  audio?: {
    link: string;
  };
  document?: {
    caption?: string;
    filename?: string;
    link: string;
  };
  image?: {
    caption?: string;
    link: string;
  };
  interactive?: Record<string, unknown>;
  template?: Record<string, unknown>;
  text?: {
    body: string;
    preview_url: boolean;
  };
  video?: {
    caption?: string;
    link: string;
  };
};

type WhatsAppReplySendResult = {
  deliveryMode: "interactive" | "media" | "template" | "text";
  messageType: string;
  result: unknown;
  text: string;
};

export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

type RuntimeReplyProductCatalog = {
  externalId?: string | null;
  id: number;
  name: string;
  providerType?: string;
};

type RuntimeReplyProductPayload = {
  catalog: RuntimeReplyProductCatalog | null;
  mode: "catalog" | "multiple_products" | "single_product";
  products: RuntimeReplyProduct[];
};

type WhatsAppMediaInfo = {
  file_size?: number;
  id?: string;
  mime_type?: string;
  sha256?: string;
  url?: string;
};

export type WhatsAppWebhookChangeValue = {
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  messages?: WhatsAppWebhookMessage[];
  statuses?: unknown[];
};

export type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: WhatsAppWebhookChangeValue;
    }>;
  }>;
};

export function normalizeWhatsAppConfig(
  value: Record<string, unknown> | null | undefined,
) {
  const config = value ?? {};

  return {
    businessAccountId:
      typeof config.businessAccountId === "string"
        ? config.businessAccountId
        : "",
    phoneNumberId:
      typeof config.phoneNumberId === "string" ? config.phoneNumberId : "",
    displayPhoneNumber:
      typeof config.displayPhoneNumber === "string"
        ? config.displayPhoneNumber
        : "",
    businessName:
      typeof config.businessName === "string" ? config.businessName : "",
    accessToken:
      typeof config.accessToken === "string" ? config.accessToken : "",
    appSecret: typeof config.appSecret === "string" ? config.appSecret : "",
    verifyToken:
      typeof config.verifyToken === "string" ? config.verifyToken : "",
  } satisfies Required<WhatsAppChannelConfig>;
}

export function getWhatsAppWebhookUrl() {
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";

  if (!appBaseUrl) {
    return "/api/whatsapp/webhook";
  }

  return `${appBaseUrl.replace(/\/$/, "")}/api/whatsapp/webhook`;
}

export async function getProjectWhatsAppChannel(projectId: number) {
  const [channel] = await db
    .select()
    .from(projectChannels)
    .where(
      and(
        eq(projectChannels.projectId, projectId),
        eq(projectChannels.channelType, "whatsapp"),
      ),
    )
    .limit(1);

  return channel ?? null;
}

export async function upsertProjectWhatsAppChannel(input: {
  projectId: number;
  name: string;
  status: "active" | "disabled";
  config: WhatsAppChannelConfig;
}) {
  const existing = await getProjectWhatsAppChannel(input.projectId);
  const existingConfig = normalizeWhatsAppConfig(existing?.config);
  const mergedConfig: Required<WhatsAppChannelConfig> = {
    businessAccountId: input.config.businessAccountId ?? "",
    phoneNumberId: input.config.phoneNumberId ?? "",
    displayPhoneNumber: input.config.displayPhoneNumber ?? "",
    businessName: input.config.businessName ?? "",
    accessToken: input.config.accessToken || existingConfig.accessToken,
    appSecret: input.config.appSecret || existingConfig.appSecret,
    verifyToken: input.config.verifyToken || existingConfig.verifyToken,
  };

  if (existing) {
    const [channel] = await db
      .update(projectChannels)
      .set({
        name: input.name,
        status: input.status,
        externalId: mergedConfig.phoneNumberId || null,
        config: mergedConfig,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectChannels.id, existing.id),
          eq(projectChannels.projectId, input.projectId),
        ),
      )
      .returning();

    return channel;
  }

  const [channel] = await db
    .insert(projectChannels)
    .values({
      projectId: input.projectId,
      channelType: "whatsapp",
      name: input.name,
      status: input.status,
      externalId: mergedConfig.phoneNumberId || null,
      config: mergedConfig,
    })
    .returning();

  return channel;
}

export async function getActiveWhatsAppChannelByPhoneNumberId(
  phoneNumberId: string,
) {
  const [channel] = await db
    .select({ channel: projectChannels })
    .from(projectChannels)
    .innerJoin(projects, eq(projects.id, projectChannels.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(
      and(
        eq(projectChannels.channelType, "whatsapp"),
        eq(projectChannels.externalId, phoneNumberId),
        eq(projectChannels.status, "active"),
        eq(projects.isArchived, false),
        eq(companies.status, "active"),
      ),
    )
    .limit(1);

  return channel?.channel ?? null;
}

export async function getActiveWhatsAppChannelByVerifyToken(
  verifyToken: string,
) {
  const channels = await db
    .select({ channel: projectChannels })
    .from(projectChannels)
    .innerJoin(projects, eq(projects.id, projectChannels.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(
      and(
        eq(projectChannels.channelType, "whatsapp"),
        eq(projectChannels.status, "active"),
        eq(projects.isArchived, false),
        eq(companies.status, "active"),
      ),
    );

  return (
    channels.find(
      ({ channel }) =>
        normalizeWhatsAppConfig(channel.config).verifyToken === verifyToken,
    )?.channel ?? null
  );
}

export function extractWhatsAppMessageChanges(payload: WhatsAppWebhookPayload) {
  const changes: Array<{
    phoneNumberId: string;
    displayPhoneNumber: string;
    message: WhatsAppWebhookMessage;
  }> = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id ?? "";
      if (!phoneNumberId) {
        continue;
      }
      const displayPhoneNumber = value?.metadata?.display_phone_number ?? "";

      for (const message of value?.messages ?? []) {
        changes.push({
          phoneNumberId,
          displayPhoneNumber,
          message,
        });
      }
    }
  }

  return changes;
}

export function getWhatsAppInboundText(message: WhatsAppWebhookMessage) {
  if (message.text?.body) {
    return message.text.body;
  }

  if (message.order?.product_items?.length) {
    const cartItems = message.order.product_items
      .map((item) => {
        const productRetailerId = item.product_retailer_id?.trim();

        if (!productRetailerId) {
          return null;
        }

        const quantity =
          typeof item.quantity === "number" &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0
            ? item.quantity
            : 1;

        return `${productRetailerId} x ${quantity}`;
      })
      .filter((item): item is string => Boolean(item));

    if (cartItems.length > 0) {
      return cartItems.join(", ");
    }
  }

  if (message.interactive?.button_reply) {
    return (
      message.interactive.button_reply.id ||
      message.interactive.button_reply.title ||
      null
    );
  }

  if (message.interactive?.list_reply) {
    return (
      message.interactive.list_reply.id ||
      message.interactive.list_reply.title ||
      null
    );
  }

  return null;
}

function getWhatsAppMediaPayload(message: WhatsAppWebhookMessage) {
  switch (message.type) {
    case "audio":
      return { media: message.audio, mediaType: "audio" };
    case "document":
      return { media: message.document, mediaType: "file" };
    case "image":
      return { media: message.image, mediaType: "image" };
    case "sticker":
      return { media: message.sticker, mediaType: "image" };
    case "video":
      return { media: message.video, mediaType: "video" };
    default:
      return { media: null, mediaType: "" };
  }
}

export function getWhatsAppInboundMediaReference(
  message: WhatsAppWebhookMessage,
): FlowMediaUploadValue | null {
  const { media, mediaType } = getWhatsAppMediaPayload(message);

  if (!media?.id || !mediaType) {
    return null;
  }

  const originalName =
    "filename" in media && typeof media.filename === "string"
      ? media.filename
      : media.caption || `${message.type}-${media.id}`;

  return {
    mediaAssetId: null,
    mediaType,
    mimeType: media.mime_type || "application/octet-stream",
    originalName,
    provider: "whatsapp",
    providerMediaId: media.id,
    publicPath: null,
    sizeBytes: null,
    metadata: {
      caption: media.caption ?? null,
      sha256: media.sha256 ?? null,
      whatsappMessageId: message.id ?? null,
      whatsappMessageType: message.type ?? null,
    },
  };
}

export function getWhatsAppInboundLocationValue(
  message: WhatsAppWebhookMessage,
): FlowLocationValue | null {
  if (message.type !== "location" || !message.location) {
    return null;
  }

  const latitude = message.location.latitude;
  const longitude = message.location.longitude;

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  return {
    label:
      message.location.name ||
      message.location.address ||
      `${latitude}, ${longitude}`,
    latitude,
    longitude,
    provider: "whatsapp",
    rawText: message.location.address,
  };
}

export function verifyWhatsAppSignature(input: {
  rawBody: string;
  signature: string | null;
  appSecret: string;
}) {
  if (!input.appSecret) {
    return true;
  }

  const expected = `sha256=${createHmac("sha256", input.appSecret)
    .update(input.rawBody)
    .digest("hex")}`;

  if (!input.signature) {
    return false;
  }

  const signatureBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

function getWhatsAppMessageEndpoint(channel: SelectProjectChannel) {
  const config = normalizeWhatsAppConfig(channel.config);
  const phoneNumberId = config.phoneNumberId || channel.externalId || "";
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";

  if (!phoneNumberId || !config.accessToken) {
    throw new Error("WhatsApp phone number id or access token is missing.");
  }

  return {
    accessToken: config.accessToken,
    url: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
  };
}

function getWhatsAppGraphEndpoint(channel: SelectProjectChannel) {
  const config = normalizeWhatsAppConfig(channel.config);
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";

  if (!config.accessToken) {
    throw new Error("WhatsApp access token is missing.");
  }

  return {
    accessToken: config.accessToken,
    baseUrl: `https://graph.facebook.com/${apiVersion}`,
  };
}

async function fetchWhatsAppMediaInfo(input: {
  channel: SelectProjectChannel;
  mediaId: string;
}) {
  const endpoint = getWhatsAppGraphEndpoint(input.channel);
  const response = await fetch(`${endpoint.baseUrl}/${input.mediaId}`, {
    headers: {
      Authorization: `Bearer ${endpoint.accessToken}`,
    },
  });
  const result = (await response
    .json()
    .catch(() => null)) as WhatsAppMediaInfo | null;

  if (!response.ok || !result?.url) {
    throw new Error(`WhatsApp media lookup failed: ${JSON.stringify(result)}`);
  }

  return result;
}

async function downloadWhatsAppMedia(input: {
  channel: SelectProjectChannel;
  mediaInfo: WhatsAppMediaInfo;
}) {
  if (
    typeof input.mediaInfo.file_size === "number" &&
    input.mediaInfo.file_size > MAX_MEDIA_UPLOAD_BYTES
  ) {
    throw new Error("WhatsApp media is too large. Max size is 16 MB.");
  }

  if (!input.mediaInfo.url) {
    throw new Error("WhatsApp media URL is missing.");
  }

  const endpoint = getWhatsAppGraphEndpoint(input.channel);
  const response = await fetch(input.mediaInfo.url, {
    headers: {
      Authorization: `Bearer ${endpoint.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`WhatsApp media download failed: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
    throw new Error("WhatsApp media is too large. Max size is 16 MB.");
  }

  return bytes;
}

export async function importWhatsAppMediaReference(input: {
  media: FlowMediaUploadValue;
  projectId: number;
}) {
  if (input.media.provider !== "whatsapp" || !input.media.providerMediaId) {
    throw new Error("Media is not a WhatsApp media reference.");
  }

  const channel = await getProjectWhatsAppChannel(input.projectId);
  if (!channel || channel.status !== "active") {
    throw new Error("Active WhatsApp channel is not configured.");
  }

  const mediaInfo = await fetchWhatsAppMediaInfo({
    channel,
    mediaId: input.media.providerMediaId,
  });
  const bytes = await downloadWhatsAppMedia({
    channel,
    mediaInfo,
  });
  const mimeType = mediaInfo.mime_type || input.media.mimeType;

  return saveProjectMediaBytes({
    bytes,
    mimeType,
    originalName: input.media.originalName,
    projectId: input.projectId,
    metadata: {
      importedFrom: "whatsapp",
      providerMediaId: input.media.providerMediaId,
      sha256: mediaInfo.sha256 ?? input.media.metadata?.sha256 ?? null,
      sourceMedia: input.media,
      whatsappMediaId: mediaInfo.id ?? input.media.providerMediaId,
      whatsappMessageId: input.media.metadata?.whatsappMessageId ?? null,
    },
  });
}

function truncateWhatsAppText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function getRuntimeReplyOptions(reply: RuntimeReply) {
  const options = reply.payload?.options;

  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option, index): RuntimeReplyOption | null => {
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return null;
      }

      const optionRecord = option as Record<string, unknown>;
      const label =
        typeof optionRecord.label === "string" ? optionRecord.label : "";
      const value =
        typeof optionRecord.value === "string" ? optionRecord.value : "";

      if (!label || !value) {
        return null;
      }

      return {
        description:
          typeof optionRecord.description === "string"
            ? optionRecord.description
            : undefined,
        id:
          typeof optionRecord.id === "string"
            ? optionRecord.id
            : `option-${index + 1}`,
        label,
        value,
      };
    })
    .filter((option): option is RuntimeReplyOption => Boolean(option));
}

function getRuntimeReplyMedia(reply: RuntimeReply) {
  const media = reply.payload?.media;

  if (!media || typeof media !== "object" || Array.isArray(media)) {
    return null;
  }

  const record = media as Partial<RuntimeReplyMedia>;

  if (
    typeof record.id !== "number" ||
    typeof record.mediaType !== "string" ||
    typeof record.mimeType !== "string" ||
    typeof record.originalName !== "string" ||
    typeof record.publicPath !== "string"
  ) {
    return null;
  }

  return record as RuntimeReplyMedia;
}

function getRuntimeReplyTemplate(reply: RuntimeReply) {
  if (reply.type !== "template") {
    return null;
  }

  const template = reply.payload?.template;

  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return null;
  }

  const record = template as Partial<RuntimeReplyTemplate>;

  if (typeof record.name !== "string" || typeof record.language !== "string") {
    return null;
  }

  return {
    body: typeof record.body === "string" ? record.body : null,
    category: record.category,
    language: record.language,
    name: record.name,
    status: record.status,
    variables: Array.isArray(record.variables)
      ? record.variables.filter(
          (variable): variable is string => typeof variable === "string",
        )
      : [],
  } satisfies RuntimeReplyTemplate;
}

function readLastInboundMessageAt(metadata: Record<string, unknown>) {
  const value = metadata[CHANNEL_METADATA_LAST_INBOUND_AT];

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getWhatsAppServiceWindowState(input: {
  lastInboundMessageAt?: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const lastInboundMessageAt = input.lastInboundMessageAt ?? null;

  if (!lastInboundMessageAt) {
    return {
      isOpen: false,
      lastInboundMessageAt,
      windowClosesAt: null,
    };
  }

  const windowClosesAt = new Date(
    lastInboundMessageAt.getTime() + WHATSAPP_SERVICE_WINDOW_MS,
  );

  return {
    isOpen: now.getTime() <= windowClosesAt.getTime(),
    lastInboundMessageAt,
    windowClosesAt,
  };
}

async function getWhatsAppRecipientServiceWindow(input: {
  channel: SelectProjectChannel;
  to: string;
}) {
  const [conversation] = await db
    .select({
      metadata: channelConversations.metadata,
    })
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, input.channel.projectId),
        eq(channelConversations.channelType, "whatsapp"),
        eq(channelConversations.externalConversationId, input.to),
      ),
    )
    .limit(1);

  return getWhatsAppServiceWindowState({
    lastInboundMessageAt: conversation
      ? readLastInboundMessageAt(conversation.metadata)
      : null,
  });
}

function isRuntimeReplyProduct(value: unknown): value is RuntimeReplyProduct {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<RuntimeReplyProduct>;
  return typeof record.id === "number" && typeof record.name === "string";
}

function getRuntimeReplyProductPayload(
  reply: RuntimeReply,
): RuntimeReplyProductPayload | null {
  if (reply.type !== "catalog") {
    return null;
  }

  const payload = reply.payload;
  const catalog = payload?.catalog;
  const mode = payload?.mode;
  const products = payload?.products;

  if (
    mode !== "catalog" &&
    mode !== "single_product" &&
    mode !== "multiple_products"
  ) {
    return null;
  }

  const catalogRecord =
    catalog && typeof catalog === "object" && !Array.isArray(catalog)
      ? (catalog as Record<string, unknown>)
      : null;
  const parsedCatalog =
    catalogRecord &&
    typeof catalogRecord.id === "number" &&
    typeof catalogRecord.name === "string"
      ? {
          externalId:
            typeof catalogRecord.externalId === "string"
              ? catalogRecord.externalId
              : null,
          id: catalogRecord.id,
          name: catalogRecord.name,
          providerType:
            typeof catalogRecord.providerType === "string"
              ? catalogRecord.providerType
              : undefined,
        }
      : null;

  return {
    catalog: parsedCatalog,
    mode,
    products: Array.isArray(products)
      ? products.filter(isRuntimeReplyProduct)
      : [],
  };
}

function getAbsoluteMediaUrl(publicPath: string) {
  if (/^https?:\/\//i.test(publicPath)) {
    return publicPath;
  }

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";

  if (!appBaseUrl || !publicPath.startsWith("/")) {
    return null;
  }

  return `${appBaseUrl.replace(/\/$/, "")}${publicPath}`;
}

function buildWhatsAppTextBody(input: {
  text: string;
  to: string;
}): WhatsAppMessageRequestBody {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "text",
    text: {
      preview_url: false,
      body: input.text,
    },
  };
}

function buildWhatsAppButtonBody(input: {
  options: RuntimeReplyOption[];
  text: string;
  to: string;
}): WhatsAppMessageRequestBody | null {
  if (input.options.length === 0 || input.options.length > 3) {
    return null;
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: truncateWhatsAppText(input.text, 1024),
      },
      action: {
        buttons: input.options.map((option) => ({
          type: "reply",
          reply: {
            id: truncateWhatsAppText(option.value, 256),
            title: truncateWhatsAppText(option.label, 20),
          },
        })),
      },
    },
  };
}

function buildWhatsAppListBody(input: {
  options: RuntimeReplyOption[];
  text: string;
  to: string;
}): WhatsAppMessageRequestBody | null {
  if (input.options.length === 0 || input.options.length > 10) {
    return null;
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: truncateWhatsAppText(input.text, 1024),
      },
      action: {
        button: "Choose",
        sections: [
          {
            title: "Options",
            rows: input.options.map((option) => ({
              id: truncateWhatsAppText(option.value, 200),
              title: truncateWhatsAppText(option.label, 24),
              ...(option.description
                ? {
                    description: truncateWhatsAppText(option.description, 72),
                  }
                : {}),
            })),
          },
        ],
      },
    },
  };
}

function getWhatsAppProductRetailerId(product: RuntimeReplyProduct) {
  return product.whatsappRetailerId?.trim() || product.sku?.trim() || "";
}

function buildWhatsAppProductBody(input: {
  payload: RuntimeReplyProductPayload;
  text: string;
  to: string;
}): WhatsAppMessageRequestBody | null {
  const catalogId = input.payload.catalog?.externalId?.trim();

  if (!catalogId) {
    return null;
  }

  const productItems = input.payload.products
    .map((product) => getWhatsAppProductRetailerId(product))
    .filter(Boolean)
    .map((productRetailerId) => ({
      product_retailer_id: truncateWhatsAppText(productRetailerId, 200),
    }));

  if (input.payload.mode === "single_product") {
    const productItem = productItems[0];

    if (!productItem) {
      return null;
    }

    return {
      interactive: {
        type: "product",
        body: {
          text: truncateWhatsAppText(input.text, 1024),
        },
        action: {
          catalog_id: truncateWhatsAppText(catalogId, 200),
          product_retailer_id: productItem.product_retailer_id,
        },
      },
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "interactive",
    };
  }

  if (productItems.length === 0 || productItems.length > 30) {
    return null;
  }

  return {
    interactive: {
      type: "product_list",
      header: {
        type: "text",
        text: truncateWhatsAppText(
          input.payload.catalog?.name || "Products",
          60,
        ),
      },
      body: {
        text: truncateWhatsAppText(input.text, 1024),
      },
      action: {
        catalog_id: truncateWhatsAppText(catalogId, 200),
        sections: [
          {
            title: truncateWhatsAppText(
              input.payload.catalog?.name || "Products",
              24,
            ),
            product_items: productItems,
          },
        ],
      },
    },
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
  };
}

function buildWhatsAppMediaBody(input: {
  media: RuntimeReplyMedia;
  text: string;
  to: string;
}): WhatsAppMessageRequestBody | null {
  const link = getAbsoluteMediaUrl(input.media.publicPath);

  if (!link) {
    return null;
  }

  const caption = input.text
    ? truncateWhatsAppText(input.text, 1024)
    : undefined;

  switch (input.media.mediaType) {
    case "audio":
      return {
        audio: { link },
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "audio",
      };
    case "file":
      return {
        document: {
          ...(caption ? { caption } : {}),
          filename: truncateWhatsAppText(input.media.originalName, 240),
          link,
        },
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "document",
      };
    case "image":
      return {
        image: {
          ...(caption ? { caption } : {}),
          link,
        },
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "image",
      };
    case "video":
      return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "video",
        video: {
          ...(caption ? { caption } : {}),
          link,
        },
      };
    default:
      return null;
  }
}

function buildWhatsAppTemplateBody(input: {
  template: RuntimeReplyTemplate;
  to: string;
}): WhatsAppMessageRequestBody | null {
  if (
    !input.template.name.trim() ||
    !input.template.language.trim() ||
    input.template.status !== "approved"
  ) {
    return null;
  }

  const parameters = input.template.variables
    .map((variable) => variable.trim())
    .filter(Boolean)
    .map((variable) => ({
      text: truncateWhatsAppText(variable, 1024),
      type: "text",
    }));

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    template: {
      name: truncateWhatsAppText(input.template.name, 512),
      language: {
        code: truncateWhatsAppText(input.template.language, 20),
      },
      ...(parameters.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters,
              },
            ],
          }
        : {}),
    },
    to: input.to,
    type: "template",
  };
}

async function sendWhatsAppMessageBody(input: {
  channel: SelectProjectChannel;
  body: WhatsAppMessageRequestBody;
}) {
  const endpoint = getWhatsAppMessageEndpoint(input.channel);

  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
  });

  const result = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`WhatsApp send failed: ${JSON.stringify(result)}`);
  }

  return result;
}

export async function sendWhatsAppTextMessage(input: {
  channel: SelectProjectChannel;
  to: string;
  text: string;
}) {
  return sendWhatsAppMessageBody({
    channel: input.channel,
    body: buildWhatsAppTextBody({
      text: input.text,
      to: input.to,
    }),
  });
}

export async function sendWhatsAppRuntimeReply(input: {
  channel: SelectProjectChannel;
  reply: RuntimeReply;
  to: string;
}): Promise<WhatsAppReplySendResult> {
  const fallbackText = getRuntimeReplyText(input.reply);
  const options = getRuntimeReplyOptions(input.reply);
  const media = getRuntimeReplyMedia(input.reply);
  const template = getRuntimeReplyTemplate(input.reply);
  const productPayload = getRuntimeReplyProductPayload(input.reply);
  const interactiveBody =
    input.reply.type === "buttons"
      ? buildWhatsAppButtonBody({
          options,
          text: input.reply.text,
          to: input.to,
        })
      : input.reply.type === "list"
        ? buildWhatsAppListBody({
            options,
            text: input.reply.text,
            to: input.to,
          })
        : null;
  const productBody = productPayload
    ? buildWhatsAppProductBody({
        payload: productPayload,
        text: input.reply.text,
        to: input.to,
      })
    : null;
  const mediaBody =
    input.reply.type === "media" && media
      ? buildWhatsAppMediaBody({
          media,
          text: input.reply.text,
          to: input.to,
        })
      : null;
  const templateBody = template
    ? buildWhatsAppTemplateBody({
        template,
        to: input.to,
      })
    : null;
  const serviceWindow = await getWhatsAppRecipientServiceWindow({
    channel: input.channel,
    to: input.to,
  });

  if (templateBody) {
    const result = await sendWhatsAppMessageBody({
      channel: input.channel,
      body: templateBody,
    });

    return {
      deliveryMode: "template",
      messageType: "template",
      result,
      text: fallbackText,
    };
  }

  if (!serviceWindow.isOpen) {
    throw new Error(
      "WhatsApp service window is closed. Send an approved template message before sending regular flow replies.",
    );
  }

  if (productBody) {
    const result = await sendWhatsAppMessageBody({
      channel: input.channel,
      body: productBody,
    });

    return {
      deliveryMode: "interactive",
      messageType:
        productPayload?.mode === "single_product" ? "product" : "product_list",
      result,
      text: input.reply.text,
    };
  }

  if (interactiveBody) {
    const result = await sendWhatsAppMessageBody({
      channel: input.channel,
      body: interactiveBody,
    });

    return {
      deliveryMode: "interactive",
      messageType: input.reply.type,
      result,
      text: input.reply.text,
    };
  }

  if (mediaBody) {
    const result = await sendWhatsAppMessageBody({
      channel: input.channel,
      body: mediaBody,
    });

    return {
      deliveryMode: "media",
      messageType: mediaBody.type,
      result,
      text: fallbackText,
    };
  }

  const result = await sendWhatsAppTextMessage({
    channel: input.channel,
    to: input.to,
    text: fallbackText,
  });

  return {
    deliveryMode: "text",
    messageType: "text",
    result,
    text: fallbackText,
  };
}
