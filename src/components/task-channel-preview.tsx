import { MessageCircle, Monitor, Smartphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";

const channels = [
  {
    key: "project_chat",
    label: "Project Chat",
    icon: Monitor,
    note: "Full task controls and diagnostic testing are available.",
  },
  {
    key: "widget",
    label: "Widget",
    icon: MessageCircle,
    note: "Visitor-facing web chat uses the same published task version.",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: Smartphone,
    note: "Replies are adapted to WhatsApp while task fields stay unchanged.",
  },
] as const;

export function TaskChannelPreview({
  definition,
}: {
  definition: ConversationalTaskDefinitionV1;
}) {
  const firstRequiredField = definition.fields.find((field) => field.required);

  return (
    <Tabs defaultValue="project_chat">
      <TabsList className="grid h-auto w-full grid-cols-3">
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
            <div className="mt-4 max-w-md space-y-3 rounded-md border bg-white p-4">
              <p className="text-sm font-medium">Lia</p>
              <p className="rounded-md bg-gray-100 px-3 py-2 text-sm">
                {firstRequiredField?.prompt ||
                  firstRequiredField?.label ||
                  "How can I help you today?"}
              </p>
              <p className="text-xs text-muted-foreground">
                {definition.fields.length} field
                {definition.fields.length === 1 ? "" : "s"} /{" "}
                {definition.outcomes.length} outcome
                {definition.outcomes.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
