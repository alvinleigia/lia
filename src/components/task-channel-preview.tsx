import { MessageCircle, Monitor, RadioTower, Smartphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createBrowserChannelAdapter } from "@/lib/browser-channel-adapter";
import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";
import { createReferenceChannelAdapter } from "@/lib/reference-channel-adapter";
import { createTaskRuntimeInputRequest } from "@/lib/runtime-input-request";
import {
  createTaskRuntimeReply,
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

export async function TaskChannelPreview({
  definition,
}: {
  definition: ConversationalTaskDefinitionV1;
}) {
  const firstRequiredField = definition.fields.find((field) => field.required);
  const inputRequest = firstRequiredField
    ? createTaskRuntimeInputRequest(firstRequiredField)
    : null;
  const reply = createTaskRuntimeReply({
    inputRequest,
    nextAction: "ask",
    text:
      firstRequiredField?.prompt ||
      firstRequiredField?.label ||
      "How can I help you today?",
  });
  const previewByChannel = {
    project_chat: createBrowserChannelAdapter("project_chat").adaptReply({
      context: { messageId: "preview-project-chat" },
      reply,
    }),
    widget: createBrowserChannelAdapter("widget").adaptReply({
      context: { messageId: "preview-widget" },
      reply,
    }),
    whatsapp: await createWhatsAppChannelAdapter().adaptReply({
      context: { serviceWindowOpen: true, to: "preview-recipient" },
      reply,
    }),
    reference_future: createReferenceChannelAdapter().adaptReply({
      context: { correlationId: "preview-future" },
      reply,
    }),
  };
  const options = getReplyOptions(reply.payload);

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
      {channels.map((channel) => {
        const preview = previewByChannel[channel.key];

        return (
          <TabsContent key={channel.key} value={channel.key}>
            <div className="rounded-md border bg-gray-50 p-4">
              <p className="text-sm text-muted-foreground">{channel.note}</p>
              <div className="mt-4 max-w-xl space-y-3 rounded-md border bg-white p-4">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Contract v{reply.schemaVersion}</span>
                  <span>Intent: {reply.intent}</span>
                  <span>Capability: {preview.capability}</span>
                  <span>Delivery: {preview.mode}</span>
                </div>
                <p className="text-sm font-medium">Lia</p>
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
                {preview.warnings.map((warning) => (
                  <p className="text-xs text-amber-700" key={warning}>
                    {warning}
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  {definition.fields.length} field
                  {definition.fields.length === 1 ? "" : "s"} /{" "}
                  {definition.outcomes.length} outcome
                  {definition.outcomes.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
