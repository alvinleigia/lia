import { z } from "zod";
import type { ChannelType } from "@/lib/channels";

export const CHANNEL_INBOUND_SCHEMA_VERSION = 1 as const;

export const CHANNEL_INBOUND_KINDS = [
  "text",
  "selection",
  "media",
  "location",
  "product_selection",
] as const;

export type ChannelInboundKind = (typeof CHANNEL_INBOUND_KINDS)[number];

export const channelInboundSelectionInputV1Schema = z
  .object({
    id: z.string().trim().min(1).max(240),
    label: z.string().trim().min(1).max(240),
    value: z.string().trim().min(1).max(240),
  })
  .strict();

export type ChannelInboundSelectionInputV1 = z.infer<
  typeof channelInboundSelectionInputV1Schema
>;

export type ChannelInboundSelectionV1 = ChannelInboundSelectionInputV1 & {
  resourceId: number | null;
  resourceType: string | null;
};

export type ChannelInboundProductV1 = {
  quantity: number;
  retailerId: string;
};

export type NormalizedChannelInboundV1<
  TChannelType extends string = ChannelType,
> = {
  channelType: TChannelType;
  kind: ChannelInboundKind;
  location: Record<string, unknown> | null;
  media: Record<string, unknown> | null;
  products: ChannelInboundProductV1[];
  schemaVersion: typeof CHANNEL_INBOUND_SCHEMA_VERSION;
  selection: ChannelInboundSelectionV1 | null;
  text: string | null;
};

function getStableResource(value: string) {
  const match = /^([a-z][a-z0-9_]*):(\d+)$/i.exec(value.trim());
  if (!match) {
    return { resourceId: null, resourceType: null };
  }

  return {
    resourceId: Number(match[2]),
    resourceType: match[1].toLowerCase(),
  };
}

export function normalizeChannelInboundV1<
  TChannelType extends string = ChannelType,
>(input: {
  channelType: TChannelType;
  location?: Record<string, unknown> | null;
  media?: Record<string, unknown> | null;
  products?: ChannelInboundProductV1[];
  selection?: ChannelInboundSelectionInputV1 | null;
  text?: string | null;
}): NormalizedChannelInboundV1<TChannelType> {
  const selection = input.selection
    ? {
        ...input.selection,
        ...getStableResource(input.selection.value),
      }
    : null;
  const products = input.products ?? [];
  const kind: ChannelInboundKind = input.media
    ? "media"
    : input.location
      ? "location"
      : products.length > 0
        ? "product_selection"
        : selection
          ? "selection"
          : "text";

  return {
    channelType: input.channelType,
    kind,
    location: input.location ?? null,
    media: input.media ?? null,
    products,
    schemaVersion: CHANNEL_INBOUND_SCHEMA_VERSION,
    selection,
    text: input.text?.trim() || null,
  };
}

export function getNormalizedChannelInboundRuntimeValue(
  inbound: NormalizedChannelInboundV1<string>,
) {
  if (inbound.selection) {
    return inbound.selection.value;
  }
  if (inbound.products.length > 0) {
    return inbound.products
      .map((product) => `${product.retailerId} x ${product.quantity}`)
      .join(", ");
  }
  return inbound.text ?? "";
}
