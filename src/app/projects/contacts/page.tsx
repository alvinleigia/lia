import {
  ClipboardList,
  ContactRound,
  Mail,
  MessageSquare,
  Phone,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { FlowMediaPayloadCards } from "@/components/flow-media-value-card";
import { NoProjectState } from "@/components/no-project-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getActiveProjectIdCookie,
  resolveOptionalUserAndProject,
} from "@/lib/auth-project";
import {
  getContactLabel,
  listContactAttributes,
  listContactConversations,
  listContactMessages,
  listContactSubmissions,
  listContactTags,
  listProjectContacts,
} from "@/lib/contacts";

type ContactsPageProps = {
  searchParams: Promise<{
    contactId?: string;
  }>;
};

function formatDate(value: Date | null) {
  return value ? value.toLocaleString() : "Not recorded";
}

function formatValue(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

export default async function ContactsPage({
  searchParams,
}: ContactsPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Contacts need a project" />;
  }

  const { project } = context;
  const contacts = await listProjectContacts(project.id);
  const requestedContactId = params.contactId
    ? Number.parseInt(params.contactId, 10)
    : null;
  const selectedContact =
    contacts.find((contact) => contact.id === requestedContactId) ??
    contacts[0] ??
    null;

  const [attributes, tagRows, conversations, submissions, messages] =
    selectedContact
      ? await Promise.all([
          listContactAttributes(project.id, selectedContact.id),
          listContactTags(project.id, selectedContact.id),
          listContactConversations(project.id, selectedContact.id),
          listContactSubmissions(project.id, selectedContact.id),
          listContactMessages(project.id, selectedContact.id),
        ])
      : [[], [], [], [], []];

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <ContactRound className="h-6 w-6" />
              Contacts: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Contacts are created from channel conversations and can collect
              attributes, tags, and submitted flow data across widget, WhatsApp,
              and future channels.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total Contacts
                </p>
                <p className="text-xl font-semibold">{contacts.length}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Contact
                </p>
                <p className="text-xl font-semibold">
                  {selectedContact ? `#${selectedContact.id}` : "None"}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Conversations
                </p>
                <p className="text-xl font-semibold">{conversations.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact List</CardTitle>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No contacts have been captured yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((contact) => {
                    const isSelected = contact.id === selectedContact?.id;

                    return (
                      <Link
                        key={contact.id}
                        href={`/projects/contacts?contactId=${contact.id}`}
                        className={`block rounded-md border px-4 py-3 ${
                          isSelected
                            ? "border-foreground bg-white"
                            : "bg-white hover:bg-accent/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="truncate font-medium">
                              {getContactLabel(contact)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {contact.primaryChannelType}
                            </p>
                          </div>
                          <span className="rounded-md border px-2 py-1 text-xs capitalize">
                            {contact.status}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Last seen: {formatDate(contact.lastSeenAt)}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Profile</CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedContact ? (
                  <p className="text-sm text-muted-foreground">
                    Select a contact after one is captured.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xl font-semibold">
                          {getContactLabel(selectedContact)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Contact #{selectedContact.id}
                        </p>
                      </div>
                      <span className="w-fit rounded-md border px-2 py-1 text-xs capitalize">
                        {selectedContact.primaryChannelType}
                      </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border bg-white p-3">
                        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <Mail className="h-4 w-4" />
                          Email
                        </p>
                        <p className="mt-1 break-words text-sm font-medium">
                          {selectedContact.email || "Not captured"}
                        </p>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <Phone className="h-4 w-4" />
                          Phone
                        </p>
                        <p className="mt-1 break-words text-sm font-medium">
                          {selectedContact.phone || "Not captured"}
                        </p>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          First Seen
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {formatDate(selectedContact.firstSeenAt)}
                        </p>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Last Seen
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {formatDate(selectedContact.lastSeenAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Tags className="h-5 w-5" />
                    Tags
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {tagRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No tags have been assigned.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tagRows.map(({ assignment, tag }) => (
                        <span
                          key={assignment.id}
                          className="rounded-md border bg-white px-2 py-1 text-sm"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Attributes</CardTitle>
                </CardHeader>
                <CardContent>
                  {attributes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No attributes have been captured.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {attributes.map((attribute) => (
                        <div
                          key={attribute.id}
                          className="rounded-md border bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium">{attribute.key}</p>
                            <span className="rounded-md border px-2 py-1 text-xs">
                              {attribute.source}
                            </span>
                          </div>
                          <p className="mt-2 break-words text-sm text-muted-foreground">
                            {formatValue(attribute.value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MessageSquare className="h-5 w-5" />
                  Conversations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {conversations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No conversations are linked to this contact.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className="rounded-md border bg-white px-4 py-3"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <p className="font-medium">
                              {conversation.channelType}
                            </p>
                            <p className="break-all text-sm text-muted-foreground">
                              {conversation.externalConversationId}
                            </p>
                          </div>
                          <span className="w-fit rounded-md border px-2 py-1 text-xs capitalize">
                            {conversation.status}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Last message: {formatDate(conversation.lastMessageAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MessageSquare className="h-5 w-5" />
                  Channel Transcript
                </CardTitle>
              </CardHeader>
              <CardContent>
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No channel messages are linked to this contact.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {messages.map(({ conversation, message }) => (
                      <div
                        key={message.id}
                        className="rounded-md border bg-white p-4"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <p className="font-medium capitalize">
                              {message.direction}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {conversation.channelType} / {message.messageType}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {message.createdAt.toLocaleString()}
                          </p>
                        </div>

                        {message.text ? (
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                            {message.text}
                          </p>
                        ) : (
                          <p className="mt-3 text-sm text-muted-foreground">
                            No text body recorded.
                          </p>
                        )}

                        <div className="mt-3 space-y-3">
                          <FlowMediaPayloadCards payload={message.payload} />
                        </div>

                        <p className="mt-3 break-all text-xs text-muted-foreground">
                          Conversation: {conversation.externalConversationId}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ClipboardList className="h-5 w-5" />
                  Flow Submissions
                </CardTitle>
              </CardHeader>
              <CardContent>
                {submissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No flow submissions are linked to this contact.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {submissions.map(({ submission, action }) => (
                      <Link
                        key={submission.id}
                        href={`/projects/submissions/${submission.id}`}
                        className="block rounded-md border bg-white px-4 py-3 hover:bg-accent/40"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <p className="font-medium">
                              #{submission.id} {action.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Source: {submission.source}
                            </p>
                          </div>
                          <span className="w-fit rounded-md border px-2 py-1 text-xs capitalize">
                            {submission.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Created: {submission.createdAt.toLocaleString()}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button asChild variant="outline">
              <Link href="/projects/submissions">View All Submissions</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
