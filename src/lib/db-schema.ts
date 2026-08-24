import { sql } from "drizzle-orm";
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
    timeZone: text("time_zone").notNull().default("UTC"),
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
    role: text("role").notNull().default("COMPANY_MEMBER"),
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
    role: text("role").notNull().default("COMPANY_MEMBER"),
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
    aiSettings: jsonb("ai_settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("projects_workspace_idx").on(table.workspaceId),
    index("projects_owner_idx").on(table.ownerUserId),
  ],
);

export const conversationProjectPolicies = pgTable(
  "conversation_project_policies",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    schemaVersion: integer("schema_version").notNull().default(1),
    definition: jsonb("definition")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversation_project_policies_project_unique").on(
      table.projectId,
    ),
  ],
);

export const conversationalTasks = pgTable(
  "conversational_tasks",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    schemaVersion: integer("schema_version").notNull().default(1),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    description: text("description"),
    definition: jsonb("definition")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_tasks_project_idx").on(table.projectId),
    index("conversational_tasks_project_archived_idx").on(
      table.projectId,
      table.isArchived,
    ),
  ],
);

export const conversationalTaskVersions = pgTable(
  "conversational_task_versions",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: integer("task_id")
      .notNull()
      .references(() => conversationalTasks.id),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    publishedByUserId: integer("published_by_user_id").references(
      () => users.id,
    ),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_versions_project_idx").on(table.projectId),
    index("conversational_task_versions_task_idx").on(table.taskId),
    uniqueIndex("conversational_task_versions_task_version_unique").on(
      table.taskId,
      table.versionNumber,
    ),
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

export const providerSecrets = pgTable(
  "provider_secrets",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    providerId: integer("provider_id")
      .notNull()
      .references(() => integrationProviders.id),
    secretName: text("secret_name").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    ciphertext: text("ciphertext").notNull(),
    initializationVector: text("initialization_vector").notNull(),
    authenticationTag: text("authentication_tag").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("provider_secrets_project_idx").on(table.projectId),
    index("provider_secrets_provider_idx").on(table.providerId),
    uniqueIndex("provider_secrets_provider_name_unique").on(
      table.providerId,
      table.secretName,
    ),
  ],
);

export const hostedVoiceDeployments = pgTable(
  "hosted_voice_deployments",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    providerId: integer("provider_id")
      .notNull()
      .references(() => integrationProviders.id),
    definitionKey: text("definition_key").notNull(),
    status: text("status").notNull().default("draft"),
    remoteAssistantId: text("remote_assistant_id"),
    mainRemoteVersionId: text("main_remote_version_id"),
    candidateRemoteVersionId: text("candidate_remote_version_id"),
    rollbackRemoteVersionId: text("rollback_remote_version_id"),
    mainManagedHash: text("main_managed_hash"),
    candidateManagedHash: text("candidate_managed_hash"),
    observedManagedHash: text("observed_managed_hash"),
    revision: integer("revision").notNull().default(0),
    lastInspectedAt: timestamp("last_inspected_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("hosted_voice_deployments_project_idx").on(table.projectId),
    index("hosted_voice_deployments_provider_idx").on(table.providerId),
    index("hosted_voice_deployments_status_idx").on(table.status),
    uniqueIndex("hosted_voice_deployments_scope_unique").on(
      table.projectId,
      table.providerId,
      table.definitionKey,
    ),
  ],
);

export const hostedVoiceDeploymentVersions = pgTable(
  "hosted_voice_deployment_versions",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => hostedVoiceDeployments.id),
    definitionHash: text("definition_hash"),
    definition: jsonb("definition").$type<Record<string, unknown>>(),
    managedConfig: jsonb("managed_config")
      .$type<Record<string, unknown>>()
      .notNull(),
    managedHash: text("managed_hash").notNull(),
    observedManagedHash: text("observed_managed_hash").notNull(),
    remoteVersionId: text("remote_version_id").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull().default("lia"),
    promotedAt: timestamp("promoted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("hosted_voice_deployment_versions_project_idx").on(table.projectId),
    index("hosted_voice_deployment_versions_deployment_idx").on(
      table.deploymentId,
    ),
    index("hosted_voice_deployment_versions_status_idx").on(table.status),
    uniqueIndex("hosted_voice_deployment_versions_remote_unique").on(
      table.deploymentId,
      table.remoteVersionId,
    ),
  ],
);

export const hostedVoiceToolBindings = pgTable(
  "hosted_voice_tool_bindings",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => hostedVoiceDeployments.id),
    deploymentVersionId: integer("deployment_version_id")
      .notNull()
      .references(() => hostedVoiceDeploymentVersions.id),
    provider: text("provider").notNull(),
    credentialHash: text("credential_hash").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("hosted_voice_tool_bindings_project_idx").on(table.projectId),
    index("hosted_voice_tool_bindings_deployment_idx").on(table.deploymentId),
    index("hosted_voice_tool_bindings_version_idx").on(
      table.deploymentVersionId,
    ),
    uniqueIndex("hosted_voice_tool_bindings_credential_unique").on(
      table.credentialHash,
    ),
    uniqueIndex("hosted_voice_tool_bindings_version_provider_unique").on(
      table.deploymentVersionId,
      table.provider,
    ),
  ],
);

export const hostedVoiceToolCalls = pgTable(
  "hosted_voice_tool_calls",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    bindingId: integer("binding_id")
      .notNull()
      .references(() => hostedVoiceToolBindings.id),
    providerCallId: text("provider_call_id").notNull(),
    providerConversation: jsonb("provider_conversation").$type<
      Record<string, unknown>
    >(),
    providerConversationHash: text("provider_conversation_hash"),
    toolId: text("tool_id").notNull(),
    toolVersion: integer("tool_version").notNull(),
    phase: text("phase").notNull(),
    access: text("access").notNull(),
    canonicalInput: jsonb("canonical_input")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    canonicalInputHash: text("canonical_input_hash").notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    commitTokenHash: text("commit_token_hash"),
    commitExpiresAt: timestamp("commit_expires_at"),
    committedAt: timestamp("committed_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    latencyMs: integer("latency_ms"),
    outcome: text("outcome"),
    interruptedAt: timestamp("interrupted_at"),
    continuationStatus: text("continuation_status"),
    continuationErrorCode: text("continuation_error_code"),
    continuationSentAt: timestamp("continuation_sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("hosted_voice_tool_calls_project_idx").on(table.projectId),
    index("hosted_voice_tool_calls_binding_idx").on(table.bindingId),
    index("hosted_voice_tool_calls_status_idx").on(table.status),
    index("hosted_voice_tool_calls_conversation_idx").on(
      table.projectId,
      table.providerConversationHash,
    ),
    uniqueIndex("hosted_voice_tool_calls_provider_unique").on(
      table.bindingId,
      table.providerCallId,
    ),
  ],
);

export const hostedVoiceCallObservations = pgTable(
  "hosted_voice_call_observations",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => hostedVoiceDeployments.id),
    deploymentVersionId: integer("deployment_version_id").references(
      () => hostedVoiceDeploymentVersions.id,
    ),
    versionAttribution: text("version_attribution").notNull(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    providerConversationHash: text("provider_conversation_hash").notNull(),
    endedAt: timestamp("ended_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    endReason: text("end_reason").notNull(),
    llmModel: text("llm_model").notNull(),
    sttModel: text("stt_model").notNull(),
    ttsProvider: text("tts_provider").notNull(),
    ttsModel: text("tts_model").notNull(),
    toolOutcomeCounts: jsonb("tool_outcome_counts")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    toolLatencyP50Ms: integer("tool_latency_p50_ms"),
    toolLatencyP95Ms: integer("tool_latency_p95_ms"),
    toolLatencyP99Ms: integer("tool_latency_p99_ms"),
    toolInterruptionCount: integer("tool_interruption_count")
      .notNull()
      .default(0),
    transferred: boolean("transferred").notNull().default(false),
    costRateMicrounitsPerMinute: integer(
      "cost_rate_microunits_per_minute",
    ).notNull(),
    estimatedCostMicrounits: integer("estimated_cost_microunits").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("hosted_voice_call_observations_project_idx").on(table.projectId),
    index("hosted_voice_call_observations_deployment_idx").on(
      table.deploymentId,
    ),
    index("hosted_voice_call_observations_expires_idx").on(table.expiresAt),
    uniqueIndex("hosted_voice_call_observations_event_unique").on(
      table.deploymentId,
      table.providerEventId,
    ),
  ],
);

export const googleCalendarAppointments = pgTable(
  "google_calendar_appointments",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    providerId: integer("provider_id")
      .notNull()
      .references(() => integrationProviders.id),
    reference: text("reference").notNull(),
    remoteEventId: text("remote_event_id").notNull(),
    remoteEtag: text("remote_etag").notNull(),
    identityHash: text("identity_hash").notNull(),
    operationKeyHash: text("operation_key_hash").notNull(),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("google_calendar_appointments_project_idx").on(table.projectId),
    index("google_calendar_appointments_identity_idx").on(
      table.projectId,
      table.providerId,
      table.identityHash,
      table.status,
    ),
    index("google_calendar_appointments_start_idx").on(
      table.projectId,
      table.providerId,
      table.startAt,
    ),
    uniqueIndex("google_calendar_appointments_reference_unique").on(
      table.projectId,
      table.providerId,
      table.reference,
    ),
    uniqueIndex("google_calendar_appointments_remote_unique").on(
      table.providerId,
      table.remoteEventId,
    ),
    uniqueIndex("google_calendar_appointments_operation_unique").on(
      table.providerId,
      table.operationKeyHash,
    ),
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
    actionVersionId: integer("action_version_id").references(
      () => actionFlowVersions.id,
    ),
    currentStepId: integer("current_step_id"),
    conversationId: text("conversation_id"),
    traceId: text("trace_id"),
    source: text("source").notNull().default("chat_widget"),
    status: text("status").notNull().default("in_progress"),
    revision: integer("revision").notNull().default(0),
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
    index("action_submissions_action_version_idx").on(table.actionVersionId),
    index("action_submissions_status_idx").on(table.status),
    index("action_submissions_trace_idx").on(table.traceId),
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
    traceId: text("trace_id"),
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
    index("action_submission_events_trace_idx").on(table.traceId),
    index("action_submission_events_created_at_idx").on(table.createdAt),
  ],
);

export const flowRuntimeCommands = pgTable(
  "flow_runtime_commands",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    source: text("source").notNull(),
    conversationId: text("conversation_id").notNull(),
    commandId: text("command_id").notNull(),
    traceId: text("trace_id"),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("processing"),
    response: jsonb("response").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("flow_runtime_commands_project_idx").on(table.projectId),
    index("flow_runtime_commands_status_idx").on(table.status),
    index("flow_runtime_commands_trace_idx").on(table.traceId),
    uniqueIndex("flow_runtime_commands_scope_unique").on(
      table.projectId,
      table.source,
      table.conversationId,
      table.commandId,
    ),
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

export const conversationDiagnosticFindings = pgTable(
  "conversation_diagnostic_findings",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => channelConversations.id),
    authorUserId: integer("author_user_id")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversation_diagnostic_findings_project_idx").on(table.projectId),
    index("conversation_diagnostic_findings_conversation_idx").on(
      table.conversationId,
    ),
    index("conversation_diagnostic_findings_created_at_idx").on(
      table.createdAt,
    ),
  ],
);

export const conversationRegressionCases = pgTable(
  "conversation_regression_cases",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    sourceFindingId: integer("source_finding_id")
      .notNull()
      .references(() => conversationDiagnosticFindings.id),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    syntheticInput: text("synthetic_input").notNull(),
    expectedBehavior: text("expected_behavior").notNull(),
    evaluationCategory: text("evaluation_category")
      .notNull()
      .default("completion"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversation_regression_cases_project_idx").on(table.projectId),
    index("conversation_regression_cases_status_idx").on(table.status),
    uniqueIndex("conversation_regression_cases_source_finding_unique").on(
      table.sourceFindingId,
    ),
  ],
);

export const conversationEvaluationPolicies = pgTable(
  "conversation_evaluation_policies",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    minimumPassRate: integer("minimum_pass_rate").notNull().default(95),
    maximumSafetyFailures: integer("maximum_safety_failures")
      .notNull()
      .default(0),
    requiredCategories: jsonb("required_categories")
      .$type<string[]>()
      .notNull()
      .default([
        "extraction",
        "correction",
        "clarification",
        "safety",
        "completion",
      ]),
    updatedByUserId: integer("updated_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversation_evaluation_policies_project_unique").on(
      table.projectId,
    ),
  ],
);

export const conversationEvaluationResults = pgTable(
  "conversation_evaluation_results",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    regressionCaseId: integer("regression_case_id")
      .notNull()
      .references(() => conversationRegressionCases.id),
    candidateLabel: text("candidate_label").notNull(),
    passed: boolean("passed").notNull(),
    observedBehavior: text("observed_behavior").notNull(),
    evaluatedByUserId: integer("evaluated_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversation_evaluation_results_project_idx").on(table.projectId),
    index("conversation_evaluation_results_case_idx").on(
      table.regressionCaseId,
    ),
    index("conversation_evaluation_results_candidate_idx").on(
      table.projectId,
      table.candidateLabel,
    ),
  ],
);

export const reusableFieldDefinitions = pgTable(
  "reusable_field_definitions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    projectId: integer("project_id").references(() => projects.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    definition: jsonb("definition")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("active"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("reusable_field_definitions_company_idx").on(table.companyId),
    index("reusable_field_definitions_project_idx").on(table.projectId),
    index("reusable_field_definitions_status_idx").on(table.status),
  ],
);

export const reusableTemplates = pgTable(
  "reusable_templates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    projectId: integer("project_id").references(() => projects.id),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("reusable_templates_company_idx").on(table.companyId),
    index("reusable_templates_project_idx").on(table.projectId),
    index("reusable_templates_kind_idx").on(table.kind),
    index("reusable_templates_status_idx").on(table.status),
  ],
);

export const reusableTemplateVersions = pgTable(
  "reusable_template_versions",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => reusableTemplates.id),
    versionNumber: integer("version_number").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    compatibility: jsonb("compatibility")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: integer("approved_by_user_id").references(() => users.id),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("reusable_template_versions_template_idx").on(table.templateId),
    uniqueIndex("reusable_template_versions_template_number_unique").on(
      table.templateId,
      table.versionNumber,
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
    externalMessageId: text("external_message_id"),
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
    uniqueIndex("channel_messages_provider_message_unique").on(
      table.projectId,
      table.conversationId,
      table.direction,
      table.externalMessageId,
    ),
  ],
);

export const conversationalTaskRuns = pgTable(
  "conversational_task_runs",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => channelConversations.id),
    taskId: integer("task_id")
      .notNull()
      .references(() => conversationalTasks.id),
    taskVersionId: integer("task_version_id")
      .notNull()
      .references(() => conversationalTaskVersions.id),
    status: text("status").notNull().default("active"),
    currentStage: text("current_stage").notNull().default("extraction"),
    outcomeKey: text("outcome_key"),
    lastRequestedFieldKey: text("last_requested_field_key"),
    suspendedReturnTarget: jsonb("suspended_return_target").$type<
      Record<string, unknown>
    >(),
    revision: integer("revision").notNull().default(0),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    pausedAt: timestamp("paused_at"),
    resumeAt: timestamp("resume_at"),
    expiresAt: timestamp("expires_at"),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    abandonedAt: timestamp("abandoned_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_runs_project_idx").on(table.projectId),
    index("conversational_task_runs_conversation_idx").on(table.conversationId),
    index("conversational_task_runs_task_idx").on(table.taskId),
    index("conversational_task_runs_version_idx").on(table.taskVersionId),
    index("conversational_task_runs_status_idx").on(table.status),
    index("conversational_task_runs_expires_idx").on(table.expiresAt),
    uniqueIndex("conversational_task_runs_active_unique")
      .on(table.projectId, table.conversationId)
      .where(
        sql`${table.status} in ('active', 'paused', 'waiting', 'handoff')`,
      ),
  ],
);

export const conversationExecutionStates = pgTable(
  "conversation_execution_states",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => channelConversations.id),
    responseOwner: text("response_owner").notNull().default("knowledge"),
    executionMode: text("execution_mode").notNull().default("knowledge"),
    activeTaskRunId: integer("active_task_run_id").references(
      () => conversationalTaskRuns.id,
    ),
    activeTaskVersionId: integer("active_task_version_id").references(
      () => conversationalTaskVersions.id,
    ),
    activeActionVersionId: integer("active_action_version_id").references(
      () => actionFlowVersions.id,
    ),
    activeNodeId: text("active_node_id"),
    suspendedReturnTarget: jsonb("suspended_return_target").$type<
      Record<string, unknown>
    >(),
    anonymousVisitorId: text("anonymous_visitor_id"),
    sessionId: text("session_id").notNull(),
    identityKind: text("identity_kind").notNull().default("anonymous"),
    channelIdentity: jsonb("channel_identity")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    verifiedContactId: integer("verified_contact_id").references(
      () => contacts.id,
    ),
    authenticatedUserId: integer("authenticated_user_id").references(
      () => users.id,
    ),
    sessionExpiresAt: timestamp("session_expires_at"),
    sessionRotatedAt: timestamp("session_rotated_at"),
    lastProviderSequence: integer("last_provider_sequence"),
    lastEventOccurredAt: timestamp("last_event_occurred_at"),
    status: text("status").notNull().default("active"),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversation_execution_states_project_idx").on(table.projectId),
    index("conversation_execution_states_conversation_idx").on(
      table.conversationId,
    ),
    index("conversation_execution_states_active_run_idx").on(
      table.activeTaskRunId,
    ),
    index("conversation_execution_states_active_action_version_idx").on(
      table.activeActionVersionId,
    ),
    index("conversation_execution_states_owner_idx").on(table.responseOwner),
    index("conversation_execution_states_session_expires_idx").on(
      table.sessionExpiresAt,
    ),
    uniqueIndex("conversation_execution_states_conversation_unique").on(
      table.projectId,
      table.conversationId,
    ),
  ],
);

export const conversationalTaskFieldValues = pgTable(
  "conversational_task_field_values",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskRunId: integer("task_run_id")
      .notNull()
      .references(() => conversationalTaskRuns.id),
    fieldId: text("field_id").notNull(),
    fieldKey: text("field_key").notNull(),
    fieldType: text("field_type").notNull(),
    state: text("state").notNull().default("missing"),
    isRequired: boolean("is_required").notNull().default(false),
    sensitivity: text("sensitivity").notNull().default("standard"),
    naturalValue: jsonb("natural_value").$type<unknown>(),
    canonicalValue: jsonb("canonical_value").$type<unknown>(),
    candidates: jsonb("candidates").$type<unknown[]>().notNull().default([]),
    provenance: jsonb("provenance")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    validation: jsonb("validation")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attemptCount: integer("attempt_count").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    lastRequestedAt: timestamp("last_requested_at"),
    validatedAt: timestamp("validated_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_fields_project_idx").on(table.projectId),
    index("conversational_task_fields_run_idx").on(table.taskRunId),
    index("conversational_task_fields_state_idx").on(table.state),
    index("conversational_task_fields_expires_idx").on(table.expiresAt),
    uniqueIndex("conversational_task_fields_run_key_unique").on(
      table.taskRunId,
      table.fieldKey,
    ),
  ],
);

export const conversationalTaskContextValues = pgTable(
  "conversational_task_context_values",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskRunId: integer("task_run_id")
      .notNull()
      .references(() => conversationalTaskRuns.id),
    key: text("key").notNull(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    value: jsonb("value").$type<unknown>(),
    sensitivity: text("sensitivity").notNull().default("standard"),
    modelVisible: boolean("model_visible").notNull().default(false),
    toolVisible: boolean("tool_visible").notNull().default(false),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_context_project_idx").on(table.projectId),
    index("conversational_task_context_run_idx").on(table.taskRunId),
    index("conversational_task_context_expires_idx").on(table.expiresAt),
    uniqueIndex("conversational_task_context_run_key_unique").on(
      table.taskRunId,
      table.key,
    ),
  ],
);

export const conversationInboundEvents = pgTable(
  "conversation_inbound_events",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => channelConversations.id),
    taskRunId: integer("task_run_id").references(
      () => conversationalTaskRuns.id,
    ),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    channelType: text("channel_type").notNull(),
    channelIdentity: jsonb("channel_identity")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    providerSequence: integer("provider_sequence"),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    authentication: jsonb("authentication").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("processing"),
    expectedRevision: integer("expected_revision"),
    appliedRevision: integer("applied_revision"),
    quarantineReason: text("quarantine_reason"),
    occurredAt: timestamp("occurred_at").notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversation_inbound_events_project_idx").on(table.projectId),
    index("conversation_inbound_events_conversation_idx").on(
      table.conversationId,
    ),
    index("conversation_inbound_events_run_idx").on(table.taskRunId),
    index("conversation_inbound_events_status_idx").on(table.status),
    index("conversation_inbound_events_received_idx").on(table.receivedAt),
    uniqueIndex("conversation_inbound_events_scope_unique").on(
      table.projectId,
      table.conversationId,
      table.eventId,
    ),
  ],
);

export const conversationalTaskConfirmations = pgTable(
  "conversational_task_confirmations",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskRunId: integer("task_run_id")
      .notNull()
      .references(() => conversationalTaskRuns.id),
    taskVersionId: integer("task_version_id")
      .notNull()
      .references(() => conversationalTaskVersions.id),
    toolId: text("tool_id").notNull(),
    status: text("status").notNull().default("pending"),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    canonicalInput: jsonb("canonical_input")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    canonicalHash: text("canonical_hash").notNull(),
    confirmationToken: text("confirmation_token").notNull(),
    confirmedBy: jsonb("confirmed_by").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    invalidatedAt: timestamp("invalidated_at"),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_confirmations_project_idx").on(table.projectId),
    index("conversational_task_confirmations_run_idx").on(table.taskRunId),
    index("conversational_task_confirmations_status_idx").on(table.status),
    index("conversational_task_confirmations_expires_idx").on(table.expiresAt),
    uniqueIndex("conversational_task_confirmations_token_unique").on(
      table.projectId,
      table.confirmationToken,
    ),
    uniqueIndex("conversational_task_confirmations_active_unique")
      .on(table.projectId, table.taskRunId, table.toolId)
      .where(
        sql`${table.status} in ('pending', 'confirmed', 'executing', 'outcome_unknown')`,
      ),
  ],
);

export const conversationalTaskToolRequests = pgTable(
  "conversational_task_tool_requests",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskRunId: integer("task_run_id")
      .notNull()
      .references(() => conversationalTaskRuns.id),
    taskVersionId: integer("task_version_id")
      .notNull()
      .references(() => conversationalTaskVersions.id),
    confirmationId: integer("confirmation_id").references(
      () => conversationalTaskConfirmations.id,
    ),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    toolId: text("tool_id").notNull(),
    stage: text("stage").notNull(),
    requestMode: text("request_mode").notNull().default("synchronous"),
    status: text("status").notNull().default("pending"),
    input: jsonb("input")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    outcomeKey: text("outcome_key"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    timeoutAt: timestamp("timeout_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_tools_project_idx").on(table.projectId),
    index("conversational_task_tools_run_idx").on(table.taskRunId),
    index("conversational_task_tools_confirmation_idx").on(
      table.confirmationId,
    ),
    index("conversational_task_tools_status_idx").on(table.status),
    index("conversational_task_tools_timeout_idx").on(table.timeoutAt),
    uniqueIndex("conversational_task_tools_request_unique").on(
      table.projectId,
      table.requestId,
    ),
    uniqueIndex("conversational_task_tools_idempotency_unique").on(
      table.projectId,
      table.idempotencyKey,
    ),
  ],
);

export const conversationalTaskAuditEvents = pgTable(
  "conversational_task_audit_events",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => channelConversations.id),
    taskRunId: integer("task_run_id").references(
      () => conversationalTaskRuns.id,
    ),
    inboundEventId: integer("inbound_event_id").references(
      () => conversationInboundEvents.id,
    ),
    eventType: text("event_type").notNull(),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversational_task_audit_project_idx").on(table.projectId),
    index("conversational_task_audit_conversation_idx").on(
      table.conversationId,
    ),
    index("conversational_task_audit_run_idx").on(table.taskRunId),
    index("conversational_task_audit_created_idx").on(table.createdAt),
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
    taskRunId: integer("task_run_id").references(
      () => conversationalTaskRuns.id,
      { onDelete: "set null" },
    ),
    taskVersionId: integer("task_version_id").references(
      () => conversationalTaskVersions.id,
      { onDelete: "set null" },
    ),
    taskToolRequestId: integer("task_tool_request_id").references(
      () => conversationalTaskToolRequests.id,
      { onDelete: "set null" },
    ),
    taskConfirmationId: integer("task_confirmation_id").references(
      () => conversationalTaskConfirmations.id,
      { onDelete: "set null" },
    ),
    idempotencyKey: text("idempotency_key"),
    traceId: text("trace_id"),
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
    index("operation_attempts_task_run_idx").on(table.taskRunId),
    index("operation_attempts_task_tool_request_idx").on(
      table.taskToolRequestId,
    ),
    index("operation_attempts_task_confirmation_idx").on(
      table.taskConfirmationId,
    ),
    index("operation_attempts_status_idx").on(table.status),
    index("operation_attempts_trace_idx").on(table.traceId),
    index("operation_attempts_created_at_idx").on(table.createdAt),
    uniqueIndex("operation_attempts_idempotency_unique").on(
      table.projectId,
      table.idempotencyKey,
    ),
  ],
);

export const durableJobs = pgTable(
  "durable_jobs",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    submissionId: integer("submission_id").references(
      () => actionSubmissions.id,
    ),
    operationAttemptId: integer("operation_attempt_id").references(
      () => operationAttempts.id,
    ),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("queued"),
    dedupeKey: text("dedupe_key").notNull(),
    traceId: text("trace_id").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    result: jsonb("result")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("durable_jobs_project_idx").on(table.projectId),
    index("durable_jobs_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    index("durable_jobs_lease_idx").on(table.leaseExpiresAt),
    index("durable_jobs_trace_idx").on(table.traceId),
    uniqueIndex("durable_jobs_dedupe_unique").on(
      table.projectId,
      table.jobType,
      table.dedupeKey,
    ),
  ],
);

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    durableJobId: integer("durable_job_id").references(() => durableJobs.id),
    submissionId: integer("submission_id").references(
      () => actionSubmissions.id,
    ),
    operationAttemptId: integer("operation_attempt_id").references(
      () => operationAttempts.id,
    ),
    topic: text("topic").notNull(),
    destination: text("destination"),
    status: text("status").notNull().default("queued"),
    dedupeKey: text("dedupe_key").notNull(),
    traceId: text("trace_id").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("outbox_messages_project_idx").on(table.projectId),
    index("outbox_messages_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    index("outbox_messages_lease_idx").on(table.leaseExpiresAt),
    index("outbox_messages_trace_idx").on(table.traceId),
    uniqueIndex("outbox_messages_dedupe_unique").on(
      table.projectId,
      table.topic,
      table.dedupeKey,
    ),
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
export type InsertProviderSecret = typeof providerSecrets.$inferInsert;
export type SelectProviderSecret = typeof providerSecrets.$inferSelect;
export type InsertHostedVoiceDeployment =
  typeof hostedVoiceDeployments.$inferInsert;
export type SelectHostedVoiceDeployment =
  typeof hostedVoiceDeployments.$inferSelect;
export type InsertHostedVoiceDeploymentVersion =
  typeof hostedVoiceDeploymentVersions.$inferInsert;
export type SelectHostedVoiceDeploymentVersion =
  typeof hostedVoiceDeploymentVersions.$inferSelect;
export type InsertHostedVoiceToolBinding =
  typeof hostedVoiceToolBindings.$inferInsert;
export type SelectHostedVoiceToolBinding =
  typeof hostedVoiceToolBindings.$inferSelect;
export type InsertHostedVoiceToolCall =
  typeof hostedVoiceToolCalls.$inferInsert;
export type SelectHostedVoiceToolCall =
  typeof hostedVoiceToolCalls.$inferSelect;
export type InsertHostedVoiceCallObservation =
  typeof hostedVoiceCallObservations.$inferInsert;
export type SelectHostedVoiceCallObservation =
  typeof hostedVoiceCallObservations.$inferSelect;
export type InsertGoogleCalendarAppointment =
  typeof googleCalendarAppointments.$inferInsert;
export type SelectGoogleCalendarAppointment =
  typeof googleCalendarAppointments.$inferSelect;
export type InsertOperation = typeof operations.$inferInsert;
export type SelectOperation = typeof operations.$inferSelect;
export type InsertOperationAttempt = typeof operationAttempts.$inferInsert;
export type SelectOperationAttempt = typeof operationAttempts.$inferSelect;
export type InsertConversationalTaskConfirmation =
  typeof conversationalTaskConfirmations.$inferInsert;
export type SelectConversationalTaskConfirmation =
  typeof conversationalTaskConfirmations.$inferSelect;
export type InsertDurableJob = typeof durableJobs.$inferInsert;
export type SelectDurableJob = typeof durableJobs.$inferSelect;
export type InsertOutboxMessage = typeof outboxMessages.$inferInsert;
export type SelectOutboxMessage = typeof outboxMessages.$inferSelect;
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
export type InsertFlowRuntimeCommand = typeof flowRuntimeCommands.$inferInsert;
export type SelectFlowRuntimeCommand = typeof flowRuntimeCommands.$inferSelect;
export type InsertProjectChannel = typeof projectChannels.$inferInsert;
export type SelectProjectChannel = typeof projectChannels.$inferSelect;
export type InsertChannelConversation =
  typeof channelConversations.$inferInsert;
export type SelectChannelConversation =
  typeof channelConversations.$inferSelect;
export type InsertConversationDiagnosticFinding =
  typeof conversationDiagnosticFindings.$inferInsert;
export type SelectConversationDiagnosticFinding =
  typeof conversationDiagnosticFindings.$inferSelect;
export type InsertConversationRegressionCase =
  typeof conversationRegressionCases.$inferInsert;
export type SelectConversationRegressionCase =
  typeof conversationRegressionCases.$inferSelect;
export type InsertConversationEvaluationPolicy =
  typeof conversationEvaluationPolicies.$inferInsert;
export type SelectConversationEvaluationPolicy =
  typeof conversationEvaluationPolicies.$inferSelect;
export type InsertConversationEvaluationResult =
  typeof conversationEvaluationResults.$inferInsert;
export type SelectConversationEvaluationResult =
  typeof conversationEvaluationResults.$inferSelect;
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
export type InsertConversationalTask = typeof conversationalTasks.$inferInsert;
export type SelectConversationalTask = typeof conversationalTasks.$inferSelect;
export type InsertConversationalTaskVersion =
  typeof conversationalTaskVersions.$inferInsert;
export type SelectConversationalTaskVersion =
  typeof conversationalTaskVersions.$inferSelect;
export type InsertConversationProjectPolicy =
  typeof conversationProjectPolicies.$inferInsert;
export type SelectConversationProjectPolicy =
  typeof conversationProjectPolicies.$inferSelect;
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
