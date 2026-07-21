import type { ActionStepType } from "@/lib/action-flow-constants";
import type { FlowComponentChannel } from "@/lib/flow-components";
import { listEnabledStepFlowComponents } from "@/lib/flow-components";

export const CERTIFICATION_CHANNELS = [
  "project_chat",
  "widget",
  "whatsapp",
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
  address: "input",
  catalog_message: "catalog_reply",
  choice: "choice_reply",
  collect_input: "input",
  confirmation: "choice_reply",
  connect_flow: "routing",
  date: "input",
  date_range: "input",
  display_result: "text_reply",
  email: "input",
  file_upload: "input",
  handoff: "handoff",
  location: "input",
  media: "media_reply",
  message: "text_reply",
  multiple_products: "product_reply",
  number: "input",
  operation: "side_effect",
  phone: "input",
  product_selection: "choice_reply",
  set_attribute: "state_mutation",
  single_product: "product_reply",
  submit: "terminal",
  template_message: "template_reply",
  time: "input",
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

function toComponentChannel(
  channel: CertificationChannel,
): FlowComponentChannel {
  return channel === "reference_future" ? "future" : channel;
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
