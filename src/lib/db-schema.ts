import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("companies_owner_idx").on(table.ownerUserId),
    index("companies_status_idx").on(table.status),
  ],
);

export const companyMemberships = pgTable(
  "company_memberships",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("COMPANY_OWNER"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("company_memberships_company_idx").on(table.companyId),
    index("company_memberships_user_idx").on(table.userId),
    index("company_memberships_status_idx").on(table.status),
    uniqueIndex("company_memberships_company_user_unique").on(
      table.companyId,
      table.userId,
    ),
  ],
);

export const companyInvitations = pgTable(
  "company_invitations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    invitedByUserId: integer("invited_by_user_id").references(() => users.id),
    acceptedByUserId: integer("accepted_by_user_id").references(() => users.id),
    email: text("email").notNull(),
    role: text("role").notNull().default("COMPANY_OWNER"),
    status: text("status").notNull().default("pending"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("company_invitations_company_idx").on(table.companyId),
    index("company_invitations_email_idx").on(table.email),
    index("company_invitations_status_idx").on(table.status),
    index("company_invitations_expires_at_idx").on(table.expiresAt),
    uniqueIndex("company_invitations_token_hash_unique").on(table.tokenHash),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workspaces_company_idx").on(table.companyId),
    index("workspaces_owner_idx").on(table.ownerUserId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
    index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("projects_workspace_idx").on(table.workspaceId),
    index("projects_owner_idx").on(table.ownerUserId),
  ],
);

export const projectWidgetKeys = pgTable(
  "project_widget_keys",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    tokenHash: text("token_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    allowedDomains: text("allowed_domains"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_widget_keys_project_unique").on(table.projectId),
    uniqueIndex("project_widget_keys_token_hash_unique").on(table.tokenHash),
  ],
);

export const integrationProviders = pgTable(
  "integration_providers",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    status: text("status").notNull().default("active"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("integration_providers_project_idx").on(table.projectId),
    index("integration_providers_provider_type_idx").on(table.providerType),
    index("integration_providers_status_idx").on(table.status),
  ],
);

export const operations = pgTable(
  "operations",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    providerId: integer("provider_id")
      .notNull()
      .references(() => integrationProviders.id),
    name: text("name").notNull(),
    operationType: text("operation_type").notNull(),
    status: text("status").notNull().default("active"),
    inputMapping: jsonb("input_mapping")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    outputMapping: jsonb("output_mapping")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    successStepId: integer("success_step_id"),
    failureStepId: integer("failure_step_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("operations_project_idx").on(table.projectId),
    index("operations_provider_idx").on(table.providerId),
    index("operations_operation_type_idx").on(table.operationType),
    index("operations_status_idx").on(table.status),
  ],
);

export const projectActions = pgTable(
  "project_actions",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    triggerPhrases: jsonb("trigger_phrases")
      .$type<string[]>()
      .notNull()
      .default([]),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    publishedVersionId: integer("published_version_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("project_actions_project_idx").on(table.projectId),
    index("project_actions_status_idx").on(table.status),
    index("project_actions_published_version_idx").on(table.publishedVersionId),
  ],
);

export const actionFlowSteps = pgTable(
  "action_flow_steps",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    actionId: integer("action_id")
      .notNull()
      .references(() => projectActions.id),
    sortOrder: integer("sort_order").notNull(),
    stepType: text("step_type").notNull(),
    fieldKey: text("field_key"),
    label: text("label"),
    prompt: text("prompt"),
    inputType: text("input_type"),
    isRequired: boolean("is_required").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(true),
    options: jsonb("options").$type<unknown[]>().notNull().default([]),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    nextStepId: integer("next_step_id"),
    operationId: integer("operation_id").references(() => operations.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("action_flow_steps_project_idx").on(table.projectId),
    index("action_flow_steps_action_idx").on(table.actionId),
    index("action_flow_steps_enabled_idx").on(table.isEnabled),
    uniqueIndex("action_flow_steps_action_sort_unique").on(
      table.actionId,
      table.sortOrder,
    ),
  ],
);

export const actionFlowBranchRules = pgTable(
  "action_flow_branch_rules",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    actionId: integer("action_id")
      .notNull()
      .references(() => projectActions.id),
    sourceStepId: integer("source_step_id")
      .notNull()
      .references(() => actionFlowSteps.id),
    sourceFieldKey: text("source_field_key").notNull(),
    operator: text("operator").notNull(),
    comparisonValue: text("comparison_value"),
    targetStepId: integer("target_step_id")
      .notNull()
      .references(() => actionFlowSteps.id),
    sortOrder: integer("sort_order").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("action_flow_branch_rules_project_idx").on(table.projectId),
    index("action_flow_branch_rules_action_idx").on(table.actionId),
    index("action_flow_branch_rules_source_step_idx").on(table.sourceStepId),
    index("action_flow_branch_rules_target_step_idx").on(table.targetStepId),
    index("action_flow_branch_rules_enabled_idx").on(table.isEnabled),
    uniqueIndex("action_flow_branch_rules_source_sort_unique").on(
      table.sourceStepId,
      table.sortOrder,
    ),
  ],
);

export const actionFlowVersions = pgTable(
  "action_flow_versions",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    actionId: integer("action_id")
      .notNull()
      .references(() => projectActions.id),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("published"),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    publishedByUserId: integer("published_by_user_id").references(
      () => users.id,
    ),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("action_flow_versions_project_idx").on(table.projectId),
    index("action_flow_versions_action_idx").on(table.actionId),
    index("action_flow_versions_status_idx").on(table.status),
    index("action_flow_versions_published_at_idx").on(table.publishedAt),
    uniqueIndex("action_flow_versions_action_number_unique").on(
      table.actionId,
      table.versionNumber,
    ),
  ],
);

export const actionSubmissions = pgTable(
  "action_submissions",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    actionId: integer("action_id")
      .notNull()
      .references(() => projectActions.id),
    currentStepId: integer("current_step_id"),
    conversationId: text("conversation_id"),
    source: text("source").notNull().default("chat_widget"),
    status: text("status").notNull().default("in_progress"),
    fields: jsonb("fields")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("action_submissions_project_idx").on(table.projectId),
    index("action_submissions_action_idx").on(table.actionId),
    index("action_submissions_status_idx").on(table.status),
    index("action_submissions_created_at_idx").on(table.createdAt),
  ],
);

export const actionSubmissionEvents = pgTable(
  "action_submission_events",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => actionSubmissions.id),
    eventType: text("event_type").notNull(),
    message: text("message"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("action_submission_events_project_idx").on(table.projectId),
    index("action_submission_events_submission_idx").on(table.submissionId),
    index("action_submission_events_created_at_idx").on(table.createdAt),
  ],
);

export const projectChannels = pgTable(
  "project_channels",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    channelType: text("channel_type").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    externalId: text("external_id"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("project_channels_project_idx").on(table.projectId),
    index("project_channels_type_idx").on(table.channelType),
    index("project_channels_status_idx").on(table.status),
    uniqueIndex("project_channels_project_type_external_unique").on(
      table.projectId,
      table.channelType,
      table.externalId,
    ),
  ],
);

export const channelConversations = pgTable(
  "channel_conversations",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    channelId: integer("channel_id").references(() => projectChannels.id),
    contactId: integer("contact_id").references(() => contacts.id),
    channelType: text("channel_type").notNull(),
    externalConversationId: text("external_conversation_id").notNull(),
    externalUserId: text("external_user_id"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("channel_conversations_project_idx").on(table.projectId),
    index("channel_conversations_channel_idx").on(table.channelId),
    index("channel_conversations_contact_idx").on(table.contactId),
    index("channel_conversations_type_idx").on(table.channelType),
    index("channel_conversations_status_idx").on(table.status),
    uniqueIndex("channel_conversations_project_channel_external_unique").on(
      table.projectId,
      table.channelType,
      table.externalConversationId,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    status: text("status").notNull().default("active"),
    primaryChannelType: text("primary_channel_type").notNull(),
    primaryExternalId: text("primary_external_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("contacts_project_idx").on(table.projectId),
    index("contacts_status_idx").on(table.status),
    index("contacts_email_idx").on(table.email),
    index("contacts_phone_idx").on(table.phone),
    uniqueIndex("contacts_project_channel_external_unique").on(
      table.projectId,
      table.primaryChannelType,
      table.primaryExternalId,
    ),
  ],
);

export const contactAttributes = pgTable(
  "contact_attributes",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    source: text("source").notNull().default("flow"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("contact_attributes_project_idx").on(table.projectId),
    index("contact_attributes_contact_idx").on(table.contactId),
    index("contact_attributes_key_idx").on(table.key),
    uniqueIndex("contact_attributes_contact_key_unique").on(
      table.contactId,
      table.key,
    ),
  ],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    color: text("color"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("contact_tags_project_idx").on(table.projectId),
    index("contact_tags_status_idx").on(table.status),
    uniqueIndex("contact_tags_project_name_unique").on(
      table.projectId,
      table.name,
    ),
  ],
);

export const contactTagAssignments = pgTable(
  "contact_tag_assignments",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id),
    tagId: integer("tag_id")
      .notNull()
      .references(() => contactTags.id),
    source: text("source").notNull().default("flow"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contact_tag_assignments_project_idx").on(table.projectId),
    index("contact_tag_assignments_contact_idx").on(table.contactId),
    index("contact_tag_assignments_tag_idx").on(table.tagId),
    uniqueIndex("contact_tag_assignments_contact_tag_unique").on(
      table.contactId,
      table.tagId,
    ),
  ],
);

export const channelMessages = pgTable(
  "channel_messages",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => channelConversations.id),
    direction: text("direction").notNull(),
    messageType: text("message_type").notNull().default("text"),
    text: text("text"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("channel_messages_project_idx").on(table.projectId),
    index("channel_messages_conversation_idx").on(table.conversationId),
    index("channel_messages_direction_idx").on(table.direction),
    index("channel_messages_created_at_idx").on(table.createdAt),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    fileName: text("file_name").notNull(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    publicPath: text("public_path").notNull(),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("media_assets_project_idx").on(table.projectId),
    index("media_assets_media_type_idx").on(table.mediaType),
    index("media_assets_status_idx").on(table.status),
    index("media_assets_created_at_idx").on(table.createdAt),
    uniqueIndex("media_assets_storage_key_unique").on(table.storageKey),
  ],
);

export const productCatalogs = pgTable(
  "product_catalogs",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    providerType: text("provider_type").notNull().default("internal"),
    externalId: text("external_id"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("product_catalogs_project_idx").on(table.projectId),
    index("product_catalogs_status_idx").on(table.status),
    index("product_catalogs_provider_type_idx").on(table.providerType),
    uniqueIndex("product_catalogs_project_name_unique").on(
      table.projectId,
      table.name,
    ),
  ],
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    catalogId: integer("catalog_id")
      .notNull()
      .references(() => productCatalogs.id),
    sku: text("sku"),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    productUrl: text("product_url"),
    priceAmount: integer("price_amount"),
    currency: text("currency"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("catalog_products_project_idx").on(table.projectId),
    index("catalog_products_catalog_idx").on(table.catalogId),
    index("catalog_products_status_idx").on(table.status),
    index("catalog_products_sku_idx").on(table.sku),
  ],
);

export const operationAttempts = pgTable(
  "operation_attempts",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    operationId: integer("operation_id")
      .notNull()
      .references(() => operations.id),
    providerId: integer("provider_id")
      .notNull()
      .references(() => integrationProviders.id),
    actionId: integer("action_id").references(() => projectActions.id),
    submissionId: integer("submission_id").references(
      () => actionSubmissions.id,
    ),
    status: text("status").notNull().default("pending"),
    requestPayload: jsonb("request_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    responsePayload: jsonb("response_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("operation_attempts_project_idx").on(table.projectId),
    index("operation_attempts_operation_idx").on(table.operationId),
    index("operation_attempts_provider_idx").on(table.providerId),
    index("operation_attempts_action_idx").on(table.actionId),
    index("operation_attempts_submission_idx").on(table.submissionId),
    index("operation_attempts_status_idx").on(table.status),
    index("operation_attempts_created_at_idx").on(table.createdAt),
  ],
);

export const widgetRateLimits = pgTable(
  "widget_rate_limits",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    clientIp: text("client_ip").notNull(),
    windowStart: timestamp("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("widget_rate_limits_unique_window").on(
      table.tokenHash,
      table.clientIp,
      table.windowStart,
    ),
    index("widget_rate_limits_token_hash_idx").on(table.tokenHash),
    index("widget_rate_limits_updated_at_idx").on(table.updatedAt),
  ],
);

export const chatRequestLogs = pgTable(
  "chat_request_logs",
  {
    id: serial("id").primaryKey(),
    route: text("route").notNull(),
    projectId: integer("project_id").references(() => projects.id),
    statusCode: integer("status_code").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("chat_request_logs_created_at_idx").on(table.createdAt),
    index("chat_request_logs_route_idx").on(table.route),
    index("chat_request_logs_project_idx").on(table.projectId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").references(() => users.id),
    actorMembershipId: integer("actor_membership_id").references(
      () => companyMemberships.id,
    ),
    companyId: integer("company_id").references(() => companies.id),
    workspaceId: integer("workspace_id").references(() => workspaces.id),
    projectId: integer("project_id").references(() => projects.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_actor_user_idx").on(table.actorUserId),
    index("audit_logs_company_idx").on(table.companyId),
    index("audit_logs_workspace_idx").on(table.workspaceId),
    index("audit_logs_project_idx").on(table.projectId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    fileHash: text("file_hash"),
    processingStatus: text("processing_status").notNull().default("queued"),
    processingError: text("processing_error"),
    processedAt: timestamp("processed_at"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("source_documents_project_idx").on(table.projectId),
    uniqueIndex("source_documents_project_file_hash_unique").on(
      table.projectId,
      table.fileHash,
    ),
  ],
);

export const uploadJobs = pgTable(
  "upload_jobs",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    sourceDocumentId: integer("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id),
    textContent: text("text_content").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("upload_jobs_status_idx").on(table.status),
    index("upload_jobs_source_document_idx").on(table.sourceDocumentId),
    index("upload_jobs_created_at_idx").on(table.createdAt),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").references(() => projects.id),
    sourceDocumentId: integer("source_document_id").references(
      () => sourceDocuments.id,
    ),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }), // text-embedding-3-small
  },
  (table) => [
    index("documents_project_idx").on(table.projectId),
    index("documents_source_document_idx").on(table.sourceDocumentId),
    index("embeddingIndex").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export type InsertDocument = typeof documents.$inferInsert;
export type SelectDocument = typeof documents.$inferSelect;
export type InsertSourceDocument = typeof sourceDocuments.$inferInsert;
export type SelectSourceDocument = typeof sourceDocuments.$inferSelect;
export type InsertUploadJob = typeof uploadJobs.$inferInsert;
export type SelectUploadJob = typeof uploadJobs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
export type SelectAuditLog = typeof auditLogs.$inferSelect;
export type InsertProjectWidgetKey = typeof projectWidgetKeys.$inferInsert;
export type SelectProjectWidgetKey = typeof projectWidgetKeys.$inferSelect;
export type InsertIntegrationProvider =
  typeof integrationProviders.$inferInsert;
export type SelectIntegrationProvider =
  typeof integrationProviders.$inferSelect;
export type InsertOperation = typeof operations.$inferInsert;
export type SelectOperation = typeof operations.$inferSelect;
export type InsertOperationAttempt = typeof operationAttempts.$inferInsert;
export type SelectOperationAttempt = typeof operationAttempts.$inferSelect;
export type InsertProjectAction = typeof projectActions.$inferInsert;
export type SelectProjectAction = typeof projectActions.$inferSelect;
export type InsertActionFlowStep = typeof actionFlowSteps.$inferInsert;
export type SelectActionFlowStep = typeof actionFlowSteps.$inferSelect;
export type InsertActionFlowBranchRule =
  typeof actionFlowBranchRules.$inferInsert;
export type SelectActionFlowBranchRule =
  typeof actionFlowBranchRules.$inferSelect;
export type InsertActionFlowVersion = typeof actionFlowVersions.$inferInsert;
export type SelectActionFlowVersion = typeof actionFlowVersions.$inferSelect;
export type InsertActionSubmission = typeof actionSubmissions.$inferInsert;
export type SelectActionSubmission = typeof actionSubmissions.$inferSelect;
export type InsertActionSubmissionEvent =
  typeof actionSubmissionEvents.$inferInsert;
export type SelectActionSubmissionEvent =
  typeof actionSubmissionEvents.$inferSelect;
export type InsertProjectChannel = typeof projectChannels.$inferInsert;
export type SelectProjectChannel = typeof projectChannels.$inferSelect;
export type InsertChannelConversation =
  typeof channelConversations.$inferInsert;
export type SelectChannelConversation =
  typeof channelConversations.$inferSelect;
export type InsertChannelMessage = typeof channelMessages.$inferInsert;
export type SelectChannelMessage = typeof channelMessages.$inferSelect;
export type InsertMediaAsset = typeof mediaAssets.$inferInsert;
export type SelectMediaAsset = typeof mediaAssets.$inferSelect;
export type InsertProductCatalog = typeof productCatalogs.$inferInsert;
export type SelectProductCatalog = typeof productCatalogs.$inferSelect;
export type InsertCatalogProduct = typeof catalogProducts.$inferInsert;
export type SelectCatalogProduct = typeof catalogProducts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;
export type SelectContact = typeof contacts.$inferSelect;
export type InsertContactAttribute = typeof contactAttributes.$inferInsert;
export type SelectContactAttribute = typeof contactAttributes.$inferSelect;
export type InsertContactTag = typeof contactTags.$inferInsert;
export type SelectContactTag = typeof contactTags.$inferSelect;
export type InsertContactTagAssignment =
  typeof contactTagAssignments.$inferInsert;
export type SelectContactTagAssignment =
  typeof contactTagAssignments.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type SelectProject = typeof projects.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;
export type SelectCompany = typeof companies.$inferSelect;
export type InsertCompanyMembership = typeof companyMemberships.$inferInsert;
export type SelectCompanyMembership = typeof companyMemberships.$inferSelect;
export type InsertCompanyInvitation = typeof companyInvitations.$inferInsert;
export type SelectCompanyInvitation = typeof companyInvitations.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;
export type SelectWorkspace = typeof workspaces.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type SelectPasswordResetToken = typeof passwordResetTokens.$inferSelect;
