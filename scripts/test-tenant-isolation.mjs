#!/usr/bin/env node

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run tenant isolation tests.");
}

const requiredTables = [
  "users",
  "companies",
  "company_memberships",
  "company_invitations",
  "workspaces",
  "projects",
  "source_documents",
  "documents",
  "integration_providers",
  "operations",
  "project_actions",
  "action_flow_steps",
  "action_flow_branch_rules",
  "action_flow_versions",
  "action_submissions",
  "action_submission_events",
  "project_channels",
  "channel_conversations",
  "contacts",
  "contact_attributes",
  "contact_tags",
  "contact_tag_assignments",
  "channel_messages",
  "media_assets",
  "product_catalogs",
  "catalog_products",
  "operation_attempts",
  "audit_logs",
];

const sql = postgres(databaseUrl, { max: 1, prepare: false });

class RollbackTestTransaction extends Error {
  constructor() {
    super("Rollback tenant isolation test transaction");
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function insertOne(query) {
  const [row] = await query;
  assert(row, "Expected insert to return a row.");
  return row;
}

async function assertRequiredTablesExist() {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${requiredTables})
  `;
  const found = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !found.has(table));

  if (missing.length > 0) {
    throw new Error(
      `Tenant isolation tests need current migrations. Missing tables: ${missing.join(
        ", ",
      )}`,
    );
  }
}

async function createTenantFixture(tx, label, suffix) {
  const user = await insertOne(
    tx`
      insert into users (email, password_hash, name)
      values (${`tenant-${label}-${suffix}@example.test`}, 'test_hash', ${`Tenant ${label}`})
      returning id
    `,
  );

  const company = await insertOne(
    tx`
      insert into companies (owner_user_id, name)
      values (${user.id}, ${`Company ${label}`})
      returning id
    `,
  );

  const membership = await insertOne(
    tx`
      insert into company_memberships (company_id, user_id, role, status)
      values (${company.id}, ${user.id}, 'COMPANY_OWNER', 'active')
      returning id
    `,
  );

  const invitation = await insertOne(
    tx`
      insert into company_invitations (
        company_id,
        invited_by_user_id,
        email,
        role,
        status,
        token_hash,
        expires_at
      )
      values (
        ${company.id},
        ${user.id},
        ${`invite-${label}-${suffix}@example.test`},
        'COMPANY_OWNER',
        'pending',
        ${`invite-token-${label}-${suffix}`},
        now() + interval '7 days'
      )
      returning id
    `,
  );

  const workspace = await insertOne(
    tx`
      insert into workspaces (company_id, owner_user_id, name)
      values (${company.id}, ${user.id}, ${`Workspace ${label}`})
      returning id
    `,
  );

  const project = await insertOne(
    tx`
      insert into projects (workspace_id, owner_user_id, name)
      values (${workspace.id}, ${user.id}, ${`Project ${label}`})
      returning id
    `,
  );

  const sourceDocument = await insertOne(
    tx`
      insert into source_documents (project_id, title, file_hash, processing_status)
      values (${project.id}, ${`Document ${label}`}, ${`hash-${label}-${suffix}`}, 'processed')
      returning id
    `,
  );

  const document = await insertOne(
    tx`
      insert into documents (project_id, source_document_id, content)
      values (${project.id}, ${sourceDocument.id}, ${`Knowledge content ${label}`})
      returning id
    `,
  );

  const action = await insertOne(
    tx`
      insert into project_actions (project_id, name, status, trigger_phrases, settings)
      values (${project.id}, ${`Action ${label}`}, 'active', ${tx.json([
        `trigger ${label}`,
      ])}, ${tx.json({})})
      returning id
    `,
  );

  const provider = await insertOne(
    tx`
      insert into integration_providers (
        project_id,
        name,
        provider_type,
        status,
        config
      )
      values (
        ${project.id},
        ${`Manual Review ${label}`},
        'manual_review',
        'active',
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const operation = await insertOne(
    tx`
      insert into operations (
        project_id,
        provider_id,
        name,
        operation_type,
        status,
        input_mapping,
        output_mapping,
        settings
      )
      values (
        ${project.id},
        ${provider.id},
        ${`Operation ${label}`},
        'manual_review',
        'active',
        ${tx.json({ guestName: "name" })},
        ${tx.json({})},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const step = await insertOne(
    tx`
      insert into action_flow_steps (
        project_id,
        action_id,
        sort_order,
        step_type,
        field_key,
        label,
        prompt,
        input_type
      )
      values (
        ${project.id},
        ${action.id},
        1,
        'collect_input',
        'name',
        'Name',
        'What is your name?',
        'text'
      )
      returning id
    `,
  );

  const operationStep = await insertOne(
    tx`
      insert into action_flow_steps (
        project_id,
        action_id,
        sort_order,
        step_type,
        label,
        prompt,
        operation_id
      )
      values (
        ${project.id},
        ${action.id},
        2,
        'operation',
        'Manual review',
        'Queue for manual review.',
        ${operation.id}
      )
      returning id
    `,
  );

  const branchRule = await insertOne(
    tx`
      insert into action_flow_branch_rules (
        project_id,
        action_id,
        source_step_id,
        source_field_key,
        operator,
        comparison_value,
        target_step_id,
        sort_order,
        settings
      )
      values (
        ${project.id},
        ${action.id},
        ${step.id},
        'name',
        'is_not_empty',
        null,
        ${operationStep.id},
        1,
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const flowVersion = await insertOne(
    tx`
      insert into action_flow_versions (
        project_id,
        action_id,
        version_number,
        status,
        snapshot,
        published_by_user_id
      )
      values (
        ${project.id},
        ${action.id},
        1,
        'published',
        ${tx.json({ actionId: action.id, fixture: true })},
        ${user.id}
      )
      returning id
    `,
  );

  const submission = await insertOne(
    tx`
      insert into action_submissions (
        project_id,
        action_id,
        current_step_id,
        source,
        status,
        fields,
        metadata
      )
      values (
        ${project.id},
        ${action.id},
        ${step.id},
        'tenant_test',
        'submitted',
        ${tx.json({ name: `Guest ${label}` })},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const projectChannel = await insertOne(
    tx`
      insert into project_channels (
        project_id,
        channel_type,
        name,
        status,
        external_id,
        config
      )
      values (
        ${project.id},
        'whatsapp',
        ${`WhatsApp ${label}`},
        'active',
        ${`phone-${label}-${suffix}`},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const contact = await insertOne(
    tx`
      insert into contacts (
        project_id,
        display_name,
        email,
        phone,
        primary_channel_type,
        primary_external_id,
        metadata
      )
      values (
        ${project.id},
        ${`Contact ${label}`},
        ${`contact-${label}-${suffix}@example.test`},
        ${`+1555000${label === "A" ? "100" : "200"}`},
        'whatsapp',
        ${`external-contact-${label}-${suffix}`},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const contactAttribute = await insertOne(
    tx`
      insert into contact_attributes (
        project_id,
        contact_id,
        key,
        value,
        source
      )
      values (
        ${project.id},
        ${contact.id},
        'tier',
        ${tx.json(`tier-${label}`)},
        'tenant_test'
      )
      returning id
    `,
  );

  const contactTag = await insertOne(
    tx`
      insert into contact_tags (
        project_id,
        name,
        color,
        status
      )
      values (
        ${project.id},
        ${`VIP ${label}`},
        '#111111',
        'active'
      )
      returning id
    `,
  );

  const contactTagAssignment = await insertOne(
    tx`
      insert into contact_tag_assignments (
        project_id,
        contact_id,
        tag_id,
        source
      )
      values (
        ${project.id},
        ${contact.id},
        ${contactTag.id},
        'tenant_test'
      )
      returning id
    `,
  );

  const channelConversation = await insertOne(
    tx`
      insert into channel_conversations (
        project_id,
        channel_id,
        contact_id,
        channel_type,
        external_conversation_id,
        external_user_id,
        status,
        metadata,
        last_message_at
      )
      values (
        ${project.id},
        ${projectChannel.id},
        ${contact.id},
        'whatsapp',
        ${`conversation-${label}-${suffix}`},
        ${`external-user-${label}-${suffix}`},
        'active',
        ${tx.json({ fixture: true })},
        now()
      )
      returning id
    `,
  );

  const channelMessage = await insertOne(
    tx`
      insert into channel_messages (
        project_id,
        conversation_id,
        direction,
        message_type,
        text,
        payload
      )
      values (
        ${project.id},
        ${channelConversation.id},
        'inbound',
        'text',
        ${`Hello from ${label}`},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const mediaAsset = await insertOne(
    tx`
      insert into media_assets (
        project_id,
        file_name,
        original_name,
        media_type,
        mime_type,
        size_bytes,
        storage_key,
        public_path,
        status,
        metadata
      )
      values (
        ${project.id},
        ${`media-${label}.txt`},
        ${`Media ${label}.txt`},
        'document',
        'text/plain',
        12,
        ${`tenant-test/${suffix}/${label}/media.txt`},
        ${`/uploads/tenant-test/${suffix}/${label}/media.txt`},
        'active',
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const productCatalog = await insertOne(
    tx`
      insert into product_catalogs (
        project_id,
        name,
        description,
        status,
        provider_type,
        external_id,
        settings
      )
      values (
        ${project.id},
        ${`Catalog ${label}`},
        ${`Catalog fixture ${label}`},
        'active',
        'internal',
        ${`catalog-${label}-${suffix}`},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const catalogProduct = await insertOne(
    tx`
      insert into catalog_products (
        project_id,
        catalog_id,
        sku,
        name,
        description,
        price_amount,
        currency,
        status,
        metadata
      )
      values (
        ${project.id},
        ${productCatalog.id},
        ${`SKU-${label}-${suffix}`},
        ${`Product ${label}`},
        ${`Product fixture ${label}`},
        1000,
        'USD',
        'active',
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const operationAttempt = await insertOne(
    tx`
      insert into operation_attempts (
        project_id,
        operation_id,
        provider_id,
        action_id,
        submission_id,
        status,
        request_payload,
        response_payload,
        started_at,
        finished_at
      )
      values (
        ${project.id},
        ${operation.id},
        ${provider.id},
        ${action.id},
        ${submission.id},
        'completed',
        ${tx.json({ fixture: true })},
        ${tx.json({ fixture: true })},
        now(),
        now()
      )
      returning id
    `,
  );

  const event = await insertOne(
    tx`
      insert into action_submission_events (
        project_id,
        submission_id,
        event_type,
        message,
        payload
      )
      values (
        ${project.id},
        ${submission.id},
        'submission.created',
        'Tenant isolation fixture event.',
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  const auditLog = await insertOne(
    tx`
      insert into audit_logs (
        actor_user_id,
        actor_membership_id,
        company_id,
        workspace_id,
        project_id,
        action,
        target_type,
        target_id,
        metadata
      )
      values (
        ${user.id},
        ${membership.id},
        ${company.id},
        ${workspace.id},
        ${project.id},
        'tenant_test.fixture',
        'project',
        ${String(project.id)},
        ${tx.json({ fixture: true })}
      )
      returning id
    `,
  );

  return {
    user,
    company,
    membership,
    invitation,
    workspace,
    project,
    sourceDocument,
    document,
    provider,
    operation,
    action,
    step,
    operationStep,
    branchRule,
    flowVersion,
    submission,
    projectChannel,
    channelConversation,
    contact,
    contactAttribute,
    contactTag,
    contactTagAssignment,
    channelMessage,
    mediaAsset,
    productCatalog,
    catalogProduct,
    operationAttempt,
    event,
    auditLog,
  };
}

async function runIsolationAssertions(tx, tenantA, tenantB) {
  const foreignProjectForWorkspaceA = await tx`
    select id
    from projects
    where id = ${tenantB.project.id}
      and workspace_id = ${tenantA.workspace.id}
      and is_archived = false
  `;
  assert(
    foreignProjectForWorkspaceA.length === 0,
    "Tenant A workspace could read tenant B project.",
  );

  const renameForeignProject = await tx`
    update projects
    set name = 'Cross Tenant Rename'
    where id = ${tenantB.project.id}
      and workspace_id = ${tenantA.workspace.id}
    returning id
  `;
  assert(
    renameForeignProject.length === 0,
    "Tenant A workspace could rename tenant B project.",
  );

  const deleteForeignSourceDocument = await tx`
    delete from source_documents
    where id = ${tenantB.sourceDocument.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    deleteForeignSourceDocument.length === 0,
    "Tenant A project could delete tenant B source document.",
  );

  const deleteForeignDocumentChunk = await tx`
    delete from documents
    where source_document_id = ${tenantB.sourceDocument.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    deleteForeignDocumentChunk.length === 0,
    "Tenant A project could delete tenant B document chunk.",
  );

  const foreignAction = await tx`
    select id
    from project_actions
    where id = ${tenantB.action.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignAction.length === 0,
    "Tenant A project could read tenant B action.",
  );

  const updateForeignAction = await tx`
    update project_actions
    set name = 'Cross Tenant Action'
    where id = ${tenantB.action.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    updateForeignAction.length === 0,
    "Tenant A project could update tenant B action.",
  );

  const updateForeignStep = await tx`
    update action_flow_steps
    set label = 'Cross Tenant Step'
    where id = ${tenantB.step.id}
      and action_id = ${tenantB.action.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    updateForeignStep.length === 0,
    "Tenant A project could update tenant B action flow step.",
  );

  const updateForeignOperationStep = await tx`
    update action_flow_steps
    set label = 'Cross Tenant Operation Step'
    where id = ${tenantB.operationStep.id}
      and action_id = ${tenantB.action.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    updateForeignOperationStep.length === 0,
    "Tenant A project could update tenant B operation flow step.",
  );

  const updateForeignBranchRule = await tx`
    update action_flow_branch_rules
    set comparison_value = 'Cross Tenant Branch'
    where id = ${tenantB.branchRule.id}
      and action_id = ${tenantB.action.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    updateForeignBranchRule.length === 0,
    "Tenant A project could update tenant B action flow branch rule.",
  );

  const foreignFlowVersion = await tx`
    select id
    from action_flow_versions
    where id = ${tenantB.flowVersion.id}
      and action_id = ${tenantB.action.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignFlowVersion.length === 0,
    "Tenant A project could read tenant B action flow version.",
  );

  const foreignProvider = await tx`
    select id
    from integration_providers
    where id = ${tenantB.provider.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignProvider.length === 0,
    "Tenant A project could read tenant B integration provider.",
  );

  const foreignOperation = await tx`
    select id
    from operations
    where id = ${tenantB.operation.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignOperation.length === 0,
    "Tenant A project could read tenant B operation.",
  );

  const updateForeignOperation = await tx`
    update operations
    set name = 'Cross Tenant Operation'
    where id = ${tenantB.operation.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    updateForeignOperation.length === 0,
    "Tenant A project could update tenant B operation.",
  );

  const updateForeignSubmission = await tx`
    update action_submissions
    set status = 'cancelled'
    where id = ${tenantB.submission.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    updateForeignSubmission.length === 0,
    "Tenant A project could update tenant B submission.",
  );

  const foreignSubmissionEvents = await tx`
    select id
    from action_submission_events
    where submission_id = ${tenantB.submission.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignSubmissionEvents.length === 0,
    "Tenant A project could read tenant B submission events.",
  );

  const foreignOperationAttempts = await tx`
    select id
    from operation_attempts
    where submission_id = ${tenantB.submission.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignOperationAttempts.length === 0,
    "Tenant A project could read tenant B operation attempts.",
  );

  const foreignProjectChannel = await tx`
    select id
    from project_channels
    where id = ${tenantB.projectChannel.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignProjectChannel.length === 0,
    "Tenant A project could read tenant B project channel.",
  );

  const foreignConversation = await tx`
    select id
    from channel_conversations
    where id = ${tenantB.channelConversation.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignConversation.length === 0,
    "Tenant A project could read tenant B channel conversation.",
  );

  const foreignContact = await tx`
    select id
    from contacts
    where id = ${tenantB.contact.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignContact.length === 0,
    "Tenant A project could read tenant B contact.",
  );

  const foreignContactAttribute = await tx`
    update contact_attributes
    set value = ${tx.json("cross-tenant")}
    where id = ${tenantB.contactAttribute.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    foreignContactAttribute.length === 0,
    "Tenant A project could update tenant B contact attribute.",
  );

  const foreignContactTag = await tx`
    update contact_tags
    set name = 'Cross Tenant Tag'
    where id = ${tenantB.contactTag.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    foreignContactTag.length === 0,
    "Tenant A project could update tenant B contact tag.",
  );

  const foreignContactTagAssignment = await tx`
    select id
    from contact_tag_assignments
    where id = ${tenantB.contactTagAssignment.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignContactTagAssignment.length === 0,
    "Tenant A project could read tenant B contact tag assignment.",
  );

  const foreignChannelMessage = await tx`
    select id
    from channel_messages
    where id = ${tenantB.channelMessage.id}
      and project_id = ${tenantA.project.id}
  `;
  assert(
    foreignChannelMessage.length === 0,
    "Tenant A project could read tenant B channel message.",
  );

  const foreignMediaAsset = await tx`
    update media_assets
    set status = 'archived'
    where id = ${tenantB.mediaAsset.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    foreignMediaAsset.length === 0,
    "Tenant A project could update tenant B media asset.",
  );

  const foreignProductCatalog = await tx`
    update product_catalogs
    set status = 'archived'
    where id = ${tenantB.productCatalog.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    foreignProductCatalog.length === 0,
    "Tenant A project could update tenant B product catalog.",
  );

  const foreignCatalogProduct = await tx`
    update catalog_products
    set status = 'archived'
    where id = ${tenantB.catalogProduct.id}
      and project_id = ${tenantA.project.id}
    returning id
  `;
  assert(
    foreignCatalogProduct.length === 0,
    "Tenant A project could update tenant B catalog product.",
  );

  const tenantAAuditRows = await tx`
    select id, company_id
    from audit_logs
    where company_id = ${tenantA.company.id}
    order by id
  `;
  assert(
    tenantAAuditRows.every((row) => row.company_id === tenantA.company.id),
    "Company-scoped audit query returned another tenant audit log.",
  );

  const foreignInvitation = await tx`
    select id
    from company_invitations
    where id = ${tenantB.invitation.id}
      and company_id = ${tenantA.company.id}
  `;
  assert(
    foreignInvitation.length === 0,
    "Tenant A company could read tenant B invitation.",
  );

  const cancelForeignInvitation = await tx`
    update company_invitations
    set status = 'cancelled'
    where id = ${tenantB.invitation.id}
      and company_id = ${tenantA.company.id}
    returning id
  `;
  assert(
    cancelForeignInvitation.length === 0,
    "Tenant A company could cancel tenant B invitation.",
  );

  const tenantBStillIntact = await tx`
    select
      p.name as project_name,
      pa.name as action_name,
      s.status as submission_status,
      sd.id as source_document_id,
      d.id as document_id,
      ip.name as provider_name,
      o.name as operation_name,
      oat.status as operation_attempt_status,
      pc.name as channel_name,
      cc.external_conversation_id as conversation_external_id,
      c.display_name as contact_name,
      ct.name as contact_tag_name,
      ma.status as media_asset_status,
      pcat.status as catalog_status,
      cp.status as product_status
    from projects p
    join project_actions pa on pa.project_id = p.id
    join action_flow_branch_rules afbr on afbr.project_id = p.id
    join action_flow_versions afv on afv.project_id = p.id
    join action_submissions s on s.project_id = p.id
    join source_documents sd on sd.project_id = p.id
    join documents d on d.project_id = p.id
    join integration_providers ip on ip.project_id = p.id
    join operations o on o.project_id = p.id
    join operation_attempts oat on oat.project_id = p.id
    join project_channels pc on pc.project_id = p.id
    join channel_conversations cc on cc.project_id = p.id
    join contacts c on c.project_id = p.id
    join contact_attributes ca on ca.project_id = p.id
    join contact_tags ct on ct.project_id = p.id
    join contact_tag_assignments cta on cta.project_id = p.id
    join channel_messages cm on cm.project_id = p.id
    join media_assets ma on ma.project_id = p.id
    join product_catalogs pcat on pcat.project_id = p.id
    join catalog_products cp on cp.project_id = p.id
    join company_invitations ci on ci.company_id = ${tenantB.company.id}
    where p.id = ${tenantB.project.id}
      and pa.id = ${tenantB.action.id}
      and afbr.id = ${tenantB.branchRule.id}
      and afv.id = ${tenantB.flowVersion.id}
      and s.id = ${tenantB.submission.id}
      and sd.id = ${tenantB.sourceDocument.id}
      and d.id = ${tenantB.document.id}
      and ip.id = ${tenantB.provider.id}
      and o.id = ${tenantB.operation.id}
      and oat.id = ${tenantB.operationAttempt.id}
      and pc.id = ${tenantB.projectChannel.id}
      and cc.id = ${tenantB.channelConversation.id}
      and c.id = ${tenantB.contact.id}
      and ca.id = ${tenantB.contactAttribute.id}
      and ct.id = ${tenantB.contactTag.id}
      and cta.id = ${tenantB.contactTagAssignment.id}
      and cm.id = ${tenantB.channelMessage.id}
      and ma.id = ${tenantB.mediaAsset.id}
      and pcat.id = ${tenantB.productCatalog.id}
      and cp.id = ${tenantB.catalogProduct.id}
      and ci.id = ${tenantB.invitation.id}
  `;
  assert(tenantBStillIntact.length === 1, "Tenant B fixture was damaged.");
  assert(
    tenantBStillIntact[0].project_name === "Project B",
    "Tenant B project name changed.",
  );
  assert(
    tenantBStillIntact[0].action_name === "Action B",
    "Tenant B action name changed.",
  );
  assert(
    tenantBStillIntact[0].submission_status === "submitted",
    "Tenant B submission status changed.",
  );
  assert(
    tenantBStillIntact[0].provider_name === "Manual Review B",
    "Tenant B provider name changed.",
  );
  assert(
    tenantBStillIntact[0].operation_name === "Operation B",
    "Tenant B operation name changed.",
  );
  assert(
    tenantBStillIntact[0].operation_attempt_status === "completed",
    "Tenant B operation attempt status changed.",
  );
  assert(
    tenantBStillIntact[0].channel_name === "WhatsApp B",
    "Tenant B project channel changed.",
  );
  assert(
    tenantBStillIntact[0].conversation_external_id.startsWith(
      "conversation-B-",
    ),
    "Tenant B channel conversation changed.",
  );
  assert(
    tenantBStillIntact[0].contact_name === "Contact B",
    "Tenant B contact changed.",
  );
  assert(
    tenantBStillIntact[0].contact_tag_name === "VIP B",
    "Tenant B contact tag changed.",
  );
  assert(
    tenantBStillIntact[0].media_asset_status === "active",
    "Tenant B media asset status changed.",
  );
  assert(
    tenantBStillIntact[0].catalog_status === "active",
    "Tenant B product catalog status changed.",
  );
  assert(
    tenantBStillIntact[0].product_status === "active",
    "Tenant B catalog product status changed.",
  );

  const tenantBInvitation = await tx`
    select status
    from company_invitations
    where id = ${tenantB.invitation.id}
  `;
  assert(
    tenantBInvitation[0]?.status === "pending",
    "Tenant B invitation status changed.",
  );
}

async function main() {
  await assertRequiredTablesExist();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checks = [];

  try {
    await sql.begin(async (tx) => {
      const tenantA = await createTenantFixture(tx, "A", suffix);
      const tenantB = await createTenantFixture(tx, "B", suffix);

      await runIsolationAssertions(tx, tenantA, tenantB);
      checks.push("project read scoping");
      checks.push("project mutation scoping");
      checks.push("document delete scoping");
      checks.push("action, branch rule, and flow version scoping");
      checks.push("operation provider and attempt scoping");
      checks.push("submission and event scoping");
      checks.push("project channel and conversation scoping");
      checks.push("contact, attribute, tag, and assignment scoping");
      checks.push("channel message scoping");
      checks.push("media asset scoping");
      checks.push("product catalog and product scoping");
      checks.push("company invitation scoping");
      checks.push("audit log company scoping");
      checks.push("foreign tenant data remains intact");

      throw new RollbackTestTransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackTestTransaction)) {
      throw error;
    }
  } finally {
    await sql.end();
  }

  console.log("Tenant isolation database tests passed.");
  for (const check of checks) {
    console.log(`- ${check}`);
  }
  console.log("- fixture transaction rolled back");
}

main().catch(async (error) => {
  await sql.end({ timeout: 1 }).catch(() => {});
  console.error("Tenant isolation database tests failed.");
  if (error instanceof Error) {
    console.error(error.stack || error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
