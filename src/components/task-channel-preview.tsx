import { MessageCircle, Monitor, RadioTower, Smartphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createBrowserChannelAdapter } from "@/lib/browser-channel-adapter";
import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";
import { createReferenceChannelAdapter } from "@/lib/reference-channel-adapter";
import { createTaskRuntimeInputRequest } from "@/lib/runtime-input-request";
import {
  createTaskRuntimeReply,
  createTextReply,
  type RuntimeReply,
  type RuntimeReplyOption,
} from "@/lib/runtime-replies";
import { createWhatsAppChannelAdapter } from "@/lib/whatsapp";

const channels = [
  {
    key: "project_chat",
    label: "Project Chat",
    icon: Monitor,
    note: "Full browser controls use the universal reply contract.",
  },
  {
    key: "widget",
    label: "Widget",
    icon: MessageCircle,
    note: "The visitor widget uses the same stable values and task state.",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: Smartphone,
    note: "Native interactions are selected within provider limits; otherwise a readable fallback is used.",
  },
  {
    key: "reference_future",
    label: "Future",
    icon: RadioTower,
    note: "The reference adapter proves the definition is not tied to a current provider.",
  },
] as const;

type PreviewChannelKey = (typeof channels)[number]["key"];

function getReplyOptions(payload: Record<string, unknown> | undefined) {
  return Array.isArray(payload?.options)
    ? payload.options.filter((option): option is RuntimeReplyOption =>
        Boolean(
          option &&
            typeof option === "object" &&
            typeof option.label === "string" &&
            typeof option.value === "string",
        ),
      )
    : [];
}

async function adaptPreviewReply(
  channel: PreviewChannelKey,
  reply: RuntimeReply,
) {
  const adapted =
    channel === "project_chat" || channel === "widget"
      ? createBrowserChannelAdapter(channel).adaptReply({
          context: { messageId: `preview-${channel}-${reply.intent}` },
          reply,
        })
      : channel === "whatsapp"
        ? await createWhatsAppChannelAdapter().adaptReply({
            context: { serviceWindowOpen: true, to: "preview-recipient" },
            reply,
          })
        : createReferenceChannelAdapter().adaptReply({
            context: { correlationId: `preview-future-${reply.intent}` },
            reply,
          });

  return {
    capability: adapted.capability,
    mode: adapted.mode,
    warnings: adapted.warnings,
  };
}

export async function TaskChannelPreview({
  definition,
}: {
  definition: ConversationalTaskDefinitionV1;
}) {
  const firstRequiredField = definition.fields.find((field) => field.required);
  const inputRequest = firstRequiredField
    ? createTaskRuntimeInputRequest(firstRequiredField)
    : null;
  const scenarios = [
    {
      label: "Question",
      reply: createTaskRuntimeReply({
        inputRequest,
        nextAction: "ask",
        text:
          firstRequiredField?.prompt ||
          firstRequiredField?.label ||
          "How can I help you today?",
      }),
    },
    {
      label: "Choices",
      reply: createTaskRuntimeReply({
        inputRequest: {
          fieldKey: "phase12Choice",
          inputKind: "choice",
          label: "Phase 12 choice",
          options: [
            { label: "Option Alpha", value: "phase12_alpha" },
            { label: "Option Beta", value: "phase12_beta" },
          ],
          required: true,
        },
        nextAction: "ask",
        text: "Choose one Phase 12 option.",
      }),
    },
    {
      label: "Confirmation",
      reply: createTaskRuntimeReply({
        nextAction: "confirm",
        text: "Confirm the current task details?",
      }),
    },
    {
      label: "Media request",
      reply: createTaskRuntimeReply({
        inputRequest: {
          fieldKey: "phase12Media",
          inputKind: "media",
          label: "Phase 12 media",
          options: [],
          required: true,
        },
        nextAction: "ask",
        text: "Upload the requested Phase 12 media.",
      }),
    },
    {
      label: "Handoff",
      reply: createTaskRuntimeReply({
        nextAction: "handoff",
        text: "A team member will continue this conversation.",
      }),
    },
    {
      label: "Outcome",
      reply: createTaskRuntimeReply({
        nextAction: "complete",
        text: "The task completed successfully.",
      }),
    },
    {
      label: "Content",
      reply: createTextReply(
        "Channel-neutral content remains readable on every adapter.",
      ),
    },
  ];
  const previews = Object.fromEntries(
    await Promise.all(
      channels.map(async (channel) => [
        channel.key,
        await Promise.all(
          scenarios.map(async (scenario) => ({
            ...scenario,
            adapted: await adaptPreviewReply(channel.key, scenario.reply),
          })),
        ),
      ]),
    ),
  ) as Record<
    PreviewChannelKey,
    Array<
      (typeof scenarios)[number] & {
        adapted: Awaited<ReturnType<typeof adaptPreviewReply>>;
      }
    >
  >;

  return (
    <Tabs defaultValue="project_chat">
      <TabsList className="grid h-auto w-full grid-cols-4">
        {channels.map((channel) => {
          const Icon = channel.icon;
          return (
            <TabsTrigger key={channel.key} value={channel.key}>
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{channel.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      {channels.map((channel) => (
        <TabsContent key={channel.key} value={channel.key}>
          <div className="rounded-md border bg-gray-50 p-4">
            <p className="text-sm text-muted-foreground">{channel.note}</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {previews[channel.key].map(({ adapted, label, reply }) => {
                const options = getReplyOptions(reply.payload);

                return (
                  <div
                    className="space-y-3 rounded-md border bg-white p-4"
                    key={label}
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Contract v{reply.schemaVersion}</span>
                      <span>Intent: {reply.intent}</span>
                      <span>Capability: {adapted.capability}</span>
                      <span>Delivery: {adapted.mode}</span>
                    </div>
                    <p className="rounded-md bg-gray-100 px-3 py-2 text-sm">
                      {reply.text}
                    </p>
                    {options.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {options.map((option) => (
                          <span
                            className="rounded-full border bg-white px-3 py-1.5 text-sm"
                            key={option.id}
                          >
                            {option.label}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({option.value})
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                    {adapted.warnings.map((warning) => (
                      <p className="text-xs text-amber-700" key={warning}>
                        {warning}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Universal definition: {definition.fields.length} field
              {definition.fields.length === 1 ? "" : "s"} /{" "}
              {definition.outcomes.length} outcome
              {definition.outcomes.length === 1 ? "" : "s"}
            </p>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
