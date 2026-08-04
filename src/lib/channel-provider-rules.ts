import { getChannelAdapterProfile } from "@/lib/channel-adapter-contract";
import type { ChannelType } from "@/lib/channels";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media-assets";
import { WHATSAPP_OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox";
import { WHATSAPP_SERVICE_WINDOW_MS } from "@/lib/whatsapp";

export type ChannelProviderRule = {
  behavior: string;
  channel: ChannelType;
  key: string;
  value: boolean | number | string;
};

const whatsappLimits = getChannelAdapterProfile("whatsapp").limits;

export const CHANNEL_PROVIDER_RULES = [
  {
    behavior:
      "Requires an authenticated user with access to the selected project.",
    channel: "project_chat",
    key: "authenticated_project_session",
    value: true,
  },
  {
    behavior: "Requires an active project-scoped widget token.",
    channel: "widget",
    key: "active_project_token",
    value: true,
  },
  {
    behavior:
      "Rejects requests whose Origin or Referer does not match the configured allowlist; an empty allowlist permits all origins.",
    channel: "widget",
    key: "origin_allowlist",
    value: "configured-or-open",
  },
  {
    behavior:
      "Regular replies are allowed only during the customer-service window.",
    channel: "whatsapp",
    key: "service_window_ms",
    value: WHATSAPP_SERVICE_WINDOW_MS,
  },
  {
    behavior:
      "Outside the service window, delivery requires a template marked approved with a name and language.",
    channel: "whatsapp",
    key: "approved_template_outside_window",
    value: true,
  },
  {
    behavior:
      "Choices beyond the native reply-button limit use a readable text fallback.",
    channel: "whatsapp",
    key: "native_button_options",
    value: whatsappLimits.buttonOptions ?? 0,
  },
  {
    behavior:
      "Choices beyond the native list-row limit use a readable text fallback.",
    channel: "whatsapp",
    key: "native_list_options",
    value: whatsappLimits.listOptions ?? 0,
  },
  {
    behavior:
      "Product collections beyond the native product-item limit use a readable text fallback.",
    channel: "whatsapp",
    key: "native_product_items",
    value: whatsappLimits.productItems ?? 0,
  },
  {
    behavior:
      "Inbound media larger than the shared upload limit is rejected before persistence.",
    channel: "whatsapp",
    key: "inbound_media_bytes",
    value: MAX_MEDIA_UPLOAD_BYTES,
  },
  {
    behavior:
      "Outbound media requires an absolute public URL or an application base URL that can resolve its public path; otherwise text fallback is used.",
    channel: "whatsapp",
    key: "outbound_media_public_url",
    value: true,
  },
  {
    behavior:
      "Outbound replies use a deduplicated durable outbox and stop after the bounded attempt count.",
    channel: "whatsapp",
    key: "outbox_max_attempts",
    value: WHATSAPP_OUTBOX_MAX_ATTEMPTS,
  },
] as const satisfies readonly ChannelProviderRule[];

export function listChannelProviderRules(channel: ChannelType) {
  return CHANNEL_PROVIDER_RULES.filter((rule) => rule.channel === channel);
}
