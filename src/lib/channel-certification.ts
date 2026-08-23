import type { ActionStepType } from "@/lib/action-flow-constants";
import {
  type ChannelCapabilitySupport,
  type ChannelReplyCapability,
  getChannelAdapterProfile,
} from "@/lib/channel-adapter-contract";
import {
  CHANNEL_INBOUND_KINDS,
  type ChannelInboundKind,
} from "@/lib/channel-inbound-contract";
import type { FlowComponentChannel } from "@/lib/flow-components";
import { listEnabledStepFlowComponents } from "@/lib/flow-components";
import {
  RUNTIME_REPLY_INTENTS,
  type RuntimeReplyIntent,
} from "@/lib/runtime-replies";

export const CERTIFICATION_CHANNELS = [
  "project_chat",
  "widget",
  "whatsapp",
  "telnyx_voice",
  "reference_future",
] as const;

export type CertificationChannel = (typeof CERTIFICATION_CHANNELS)[number];

export const FLOW_CERTIFICATION_FAMILIES = [
  "text_reply",
  "choice_reply",
  "media_reply",
  "template_reply",
  "catalog_reply",
  "product_reply",
  "input",
  "state_mutation",
  "side_effect",
  "routing",
  "terminal",
  "handoff",
  "durable_pause",
] as const;

export type FlowCertificationFamily =
  (typeof FLOW_CERTIFICATION_FAMILIES)[number];

export const FLOW_STEP_CERTIFICATION_FAMILIES = {
  add_tag: "state_mutation",
  assign_agent: "state_mutation",
  assign_team: "state_mutation",
  address: "input",
  boolean: "choice_reply",
  catalog_message: "catalog_reply",
  choice: "choice_reply",
  collect_input: "input",
  conversational_task: "routing",
  confirmation: "choice_reply",
  connect_flow: "routing",
  date: "input",
  date_range: "input",
  display_result: "text_reply",
  email: "input",
  file_upload: "input",
  handoff: "handoff",
  knowledge_conversation: "text_reply",
  location: "input",
  media: "media_reply",
  message: "text_reply",
  multiple_products: "product_reply",
  number: "input",
  operation: "side_effect",
  phone: "input",
  product_selection: "choice_reply",
  remove_tag: "state_mutation",
  set_attribute: "state_mutation",
  single_product: "product_reply",
  submit: "terminal",
  subscribe: "state_mutation",
  template_message: "template_reply",
  time: "input",
  unsubscribe: "state_mutation",
  wait: "durable_pause",
} as const satisfies Record<ActionStepType, FlowCertificationFamily>;

export type ChannelCertificationCell = {
  automatedContract: true;
  channel: CertificationChannel;
  componentKey: string;
  expectation: "runtime" | "transport" | "unavailable";
  family: FlowCertificationFamily;
  label: string;
  liveSignOffRequired: boolean;
  stepType: ActionStepType;
};

export type TaskReplyCertificationCell = {
  channel: CertificationChannel;
  capability: ChannelReplyCapability;
  intent: RuntimeReplyIntent;
  support: ChannelCapabilitySupport;
};

export type InboundCertificationCell = {
  channel: CertificationChannel;
  kind: ChannelInboundKind;
  normalized: boolean;
};

const TASK_INTENT_CAPABILITIES = {
  choices: "buttons",
  confirmation: "buttons",
  content: "text",
  handoff: "handoff",
  media: "media",
  outcome: "text",
  question: "text",
} as const satisfies Record<RuntimeReplyIntent, ChannelReplyCapability>;

function getCertificationProfile(channel: CertificationChannel) {
  return channel === "reference_future"
    ? null
    : getChannelAdapterProfile(channel);
}

export function buildTaskReplyCertificationMatrix(): TaskReplyCertificationCell[] {
  return RUNTIME_REPLY_INTENTS.flatMap((intent) =>
    CERTIFICATION_CHANNELS.map((channel) => {
      const capability = TASK_INTENT_CAPABILITIES[intent];
      const profile = getCertificationProfile(channel);

      return {
        capability,
        channel,
        intent,
        support: profile ? profile.replies[capability] : "native",
      };
    }),
  );
}

export function buildInboundCertificationMatrix(): InboundCertificationCell[] {
  return CHANNEL_INBOUND_KINDS.flatMap((kind) =>
    CERTIFICATION_CHANNELS.map((channel) => {
      const profile = getCertificationProfile(channel);
      const normalized =
        !profile ||
        (kind === "text" && profile.inbound.text) ||
        (kind === "selection" && profile.inbound.interactiveSelection) ||
        (kind === "media" && profile.inbound.media) ||
        (kind === "location" && profile.inbound.location) ||
        (kind === "product_selection" && profile.inbound.productSelection);

      return { channel, kind, normalized };
    }),
  );
}

function toComponentChannel(
  channel: CertificationChannel,
): FlowComponentChannel {
  return channel === "reference_future" || channel === "telnyx_voice"
    ? "future"
    : channel;
}

function isTransportFamily(family: FlowCertificationFamily) {
  return [
    "catalog_reply",
    "choice_reply",
    "handoff",
    "input",
    "media_reply",
    "product_reply",
    "template_reply",
    "text_reply",
  ].includes(family);
}

export function buildChannelCertificationMatrix(): ChannelCertificationCell[] {
  return listEnabledStepFlowComponents().flatMap((component) => {
    const family = FLOW_STEP_CERTIFICATION_FAMILIES[component.stepType];

    return CERTIFICATION_CHANNELS.map((channel) => {
      const isAvailable = component.channels.includes(
        toComponentChannel(channel),
      );

      return {
        automatedContract: true,
        channel,
        componentKey: component.key,
        expectation: !isAvailable
          ? "unavailable"
          : isTransportFamily(family)
            ? "transport"
            : "runtime",
        family,
        label: component.label,
        liveSignOffRequired: isAvailable && channel !== "reference_future",
        stepType: component.stepType,
      } satisfies ChannelCertificationCell;
    });
  });
}
