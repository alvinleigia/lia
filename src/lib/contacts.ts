import { and, asc, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  actionSubmissions,
  channelConversations,
  channelMessages,
  contactAttributes,
  contacts,
  contactTagAssignments,
  contactTags,
  projectActions,
  type SelectContact,
} from "@/lib/db-schema";

type ContactIdentityInput = {
  channelType: string;
  externalConversationId: string;
  externalUserId?: string | null;
};

type ResolveContactInput = ContactIdentityInput & {
  displayName?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown>;
  phone?: string | null;
  projectId: number;
};

export type SetContactAttributeInput = {
  contactId: number;
  key: string;
  projectId: number;
  source?: string;
  value: unknown;
};

export type AddContactTagInput = {
  color?: string | null;
  contactId: number;
  name: string;
  projectId: number;
  source?: string;
};

function normalizeContactAttributeKey(key: string) {
  return key.trim();
}

function normalizeTagName(name: string) {
  return name.trim();
}

function getPrimaryExternalId(input: ContactIdentityInput) {
  return input.externalUserId?.trim() || input.externalConversationId.trim();
}

function inferPhone(input: ResolveContactInput) {
  if (input.phone) {
    return input.phone;
  }

  if (input.channelType !== "whatsapp" || !input.externalUserId) {
    return null;
  }

  const normalized = input.externalUserId.replace(/[^\d+]/g, "");
  return normalized || null;
}

export async function getContact(projectId: number, contactId: number) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.projectId, projectId), eq(contacts.id, contactId)))
    .limit(1);

  return contact ?? null;
}

export async function listProjectContacts(projectId: number) {
  return db
    .select()
    .from(contacts)
    .where(eq(contacts.projectId, projectId))
    .orderBy(
      desc(contacts.lastSeenAt),
      desc(contacts.createdAt),
      asc(contacts.id),
    );
}

export async function listContactConversations(
  projectId: number,
  contactId: number,
) {
  return db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, projectId),
        eq(channelConversations.contactId, contactId),
      ),
    )
    .orderBy(
      desc(channelConversations.lastMessageAt),
      desc(channelConversations.updatedAt),
      asc(channelConversations.id),
    );
}

export async function listContactMessages(
  projectId: number,
  contactId: number,
  limit = 50,
) {
  return db
    .select({
      conversation: channelConversations,
      message: channelMessages,
    })
    .from(channelMessages)
    .innerJoin(
      channelConversations,
      eq(channelConversations.id, channelMessages.conversationId),
    )
    .where(
      and(
        eq(channelMessages.projectId, projectId),
        eq(channelConversations.projectId, projectId),
        eq(channelConversations.contactId, contactId),
      ),
    )
    .orderBy(desc(channelMessages.createdAt), desc(channelMessages.id))
    .limit(limit);
}

function getSubmissionSourceForChannel(channelType: string) {
  if (channelType === "widget") {
    return "widget_chat";
  }

  if (channelType === "whatsapp") {
    return "whatsapp_chat";
  }

  return channelType;
}

export async function listContactSubmissions(
  projectId: number,
  contactId: number,
) {
  const conversations = await listContactConversations(projectId, contactId);
  const filters: SQL[] = [];

  for (const conversation of conversations) {
    const filter = and(
      eq(actionSubmissions.conversationId, conversation.externalConversationId),
      eq(
        actionSubmissions.source,
        getSubmissionSourceForChannel(conversation.channelType),
      ),
    );

    if (filter) {
      filters.push(filter);
    }
  }

  if (filters.length === 0) {
    return [];
  }

  const conversationFilter = filters.length === 1 ? filters[0] : or(...filters);

  return db
    .select({
      submission: actionSubmissions,
      action: projectActions,
    })
    .from(actionSubmissions)
    .innerJoin(
      projectActions,
      eq(projectActions.id, actionSubmissions.actionId),
    )
    .where(
      and(
        eq(actionSubmissions.projectId, projectId),
        eq(projectActions.projectId, projectId),
        conversationFilter,
      ),
    )
    .orderBy(desc(actionSubmissions.createdAt), desc(actionSubmissions.id));
}

export async function getOrCreateContactForConversation(
  input: ResolveContactInput,
) {
  const now = new Date();
  const primaryExternalId = getPrimaryExternalId(input);
  const metadata = {
    ...(input.metadata ?? {}),
    channelType: input.channelType,
    externalConversationId: input.externalConversationId,
    externalUserId: input.externalUserId ?? null,
  };

  const [contact] = await db
    .insert(contacts)
    .values({
      projectId: input.projectId,
      displayName: input.displayName ?? null,
      email: input.email ?? null,
      phone: inferPhone(input),
      primaryChannelType: input.channelType,
      primaryExternalId,
      metadata,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        contacts.projectId,
        contacts.primaryChannelType,
        contacts.primaryExternalId,
      ],
      set: {
        lastSeenAt: now,
        metadata,
        updatedAt: now,
      },
    })
    .returning();

  return contact;
}

export async function listContactAttributes(
  projectId: number,
  contactId: number,
) {
  return db
    .select()
    .from(contactAttributes)
    .where(
      and(
        eq(contactAttributes.projectId, projectId),
        eq(contactAttributes.contactId, contactId),
      ),
    )
    .orderBy(asc(contactAttributes.key));
}

export async function setContactAttribute(input: SetContactAttributeInput) {
  const key = normalizeContactAttributeKey(input.key);
  if (!key) {
    throw new Error("Contact attribute key is required.");
  }

  if (input.value === undefined) {
    throw new Error("Contact attribute value must be valid JSON.");
  }

  const contact = await getContact(input.projectId, input.contactId);
  if (!contact) {
    return null;
  }

  const now = new Date();
  const [attribute] = await db
    .insert(contactAttributes)
    .values({
      projectId: input.projectId,
      contactId: contact.id,
      key,
      value: input.value,
      source: input.source ?? "flow",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [contactAttributes.contactId, contactAttributes.key],
      set: {
        source: input.source ?? "flow",
        updatedAt: now,
        value: input.value,
      },
    })
    .returning();

  return attribute;
}

export async function listContactTags(projectId: number, contactId: number) {
  return db
    .select({ assignment: contactTagAssignments, tag: contactTags })
    .from(contactTagAssignments)
    .innerJoin(contactTags, eq(contactTags.id, contactTagAssignments.tagId))
    .where(
      and(
        eq(contactTagAssignments.projectId, projectId),
        eq(contactTagAssignments.contactId, contactId),
        eq(contactTags.projectId, projectId),
      ),
    )
    .orderBy(asc(contactTags.name));
}

export async function addContactTag(input: AddContactTagInput) {
  const name = normalizeTagName(input.name);
  if (!name) {
    throw new Error("Contact tag name is required.");
  }

  const contact = await getContact(input.projectId, input.contactId);
  if (!contact) {
    return null;
  }

  const now = new Date();
  const [tag] = await db
    .insert(contactTags)
    .values({
      projectId: input.projectId,
      name,
      color: input.color ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [contactTags.projectId, contactTags.name],
      set: {
        color: input.color ?? sql`${contactTags.color}`,
        status: "active",
        updatedAt: now,
      },
    })
    .returning();

  const [assignment] = await db
    .insert(contactTagAssignments)
    .values({
      projectId: input.projectId,
      contactId: contact.id,
      tagId: tag.id,
      source: input.source ?? "flow",
    })
    .onConflictDoUpdate({
      target: [contactTagAssignments.contactId, contactTagAssignments.tagId],
      set: {
        source: input.source ?? "flow",
      },
    })
    .returning();

  return { assignment, tag };
}

export function getContactLabel(contact: SelectContact) {
  return (
    contact.displayName ||
    contact.email ||
    contact.phone ||
    `${contact.primaryChannelType}:${contact.primaryExternalId}`
  );
}
