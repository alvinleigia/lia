import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import postgres from "postgres";
import {
  assertSanitizedConfiguration,
  buildActionSnapshot,
  buildTaskSnapshot,
  remapOperationReferences,
  remapTaskSnapshotProjectIds,
  remapTaskWrapperSettings,
} from "./lib/phase14-staging-fixture.mjs";

const SOURCE_PROJECT_NAME = "Ewissen Infra";
const SOURCE_TASK_NAME = "Book a Spa Service";
const SOURCE_TASK_VERSION = 4;
const SOURCE_ACTION_NAME = "Phase 13 Booking Parity UAT";
const TARGET_PROJECT_NAME = "Phase 14 Release UAT";
const TARGET_ACTION_NAME = "Book a Spa Service";
const TARGET_ACTION_DESCRIPTION =
  "Runs the published booking task through Project Chat, Widget, and WhatsApp.";
const TARGET_TRIGGER_PHRASES = [
  "book a spa service",
  "book spa",
  "spa appointment",
];

const CONFIGURATION_TABLES = new Set([
  "action_flow_branch_rules",
  "action_flow_steps",
  "action_flow_versions",
  "catalog_products",
  "conversation_project_policies",
  "conversational_task_versions",
  "conversational_tasks",
  "integration_providers",
  "operations",
  "product_catalogs",
  "project_actions",
]);

function getLocalDatabaseUrl() {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) {
    return null;
  }

  return parse(fs.readFileSync(envPath)).DATABASE_URL ?? null;
}

function requiredValue(name, value) {
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function parseDatabaseUrl(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(`${name} must use postgres:// or postgresql://.`);
  }
  if (!parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error(`${name} must contain a host, user, and password.`);
  }

  return parsed;
}

function databaseIdentity(url) {
  return [url.hostname, url.port || "5432", url.pathname, url.username].join(
    "|",
  );
}

function expectExactlyOne(rows, label) {
  if (rows.length !== 1) {
    throw new Error(`${label} expected exactly one row; found ${rows.length}.`);
  }
  return rows[0];
}

function sanitizedAiSettings(sourceSettings) {
  return {
    ...structuredClone(sourceSettings),
    businessName: TARGET_PROJECT_NAME,
    fallbackEmail: "phase14.release@example.com",
    fallbackPhone: "+919876543211",
  };
}

async function loadSourceFixture(sql) {
  const project = expectExactlyOne(
    await sql`select id, ai_settings from projects where name = ${SOURCE_PROJECT_NAME} and is_archived = false`,
    `Source project ${SOURCE_PROJECT_NAME}`,
  );
  const task = expectExactlyOne(
    await sql`select * from conversational_tasks where project_id = ${project.id} and name = ${SOURCE_TASK_NAME} and is_archived = false`,
    `Source task ${SOURCE_TASK_NAME}`,
  );
  const taskVersion = expectExactlyOne(
    await sql`select * from conversational_task_versions where project_id = ${project.id} and task_id = ${task.id} and version_number = ${SOURCE_TASK_VERSION}`,
    `Source task ${SOURCE_TASK_NAME} v${SOURCE_TASK_VERSION}`,
  );
  const policy = expectExactlyOne(
    await sql`select * from conversation_project_policies where project_id = ${project.id}`,
    "Source conversation policy",
  );
  const catalog = expectExactlyOne(
    await sql`select * from product_catalogs where project_id = ${project.id} and name = 'Facial' and status = 'active'`,
    "Source Facial catalog",
  );
  const product = expectExactlyOne(
    await sql`select * from catalog_products where project_id = ${project.id} and catalog_id = ${catalog.id} and name = 'Classic Facial' and status = 'active'`,
    "Source Classic Facial product",
  );
  const provider = expectExactlyOne(
    await sql`select * from integration_providers where project_id = ${project.id} and provider_type = 'manual_review' and name = 'Manual Review'`,
    "Source Manual Review provider",
  );
  const operation = expectExactlyOne(
    await sql`select * from operations where project_id = ${project.id} and provider_id = ${provider.id} and operation_type = 'manual_review' and name = 'Manual Review'`,
    "Source Manual Review operation",
  );
  const action = expectExactlyOne(
    await sql`select * from project_actions where project_id = ${project.id} and name = ${SOURCE_ACTION_NAME}`,
    `Source action ${SOURCE_ACTION_NAME}`,
  );
  if (!action.published_version_id) {
    throw new Error("Source action has no published version.");
  }
  const actionVersion = expectExactlyOne(
    await sql`select * from action_flow_versions where project_id = ${project.id} and action_id = ${action.id} and id = ${action.published_version_id} and status = 'published'`,
    "Source action published version",
  );
  const actionSteps =
    await sql`select * from action_flow_steps where project_id = ${project.id} and action_id = ${action.id} order by sort_order`;
  if (
    actionSteps.length !== 1 ||
    actionSteps[0].step_type !== "conversational_task"
  ) {
    throw new Error("Source action must contain one conversational-task step.");
  }
  const actionRules =
    await sql`select id from action_flow_branch_rules where project_id = ${project.id} and action_id = ${action.id}`;
  if (actionRules.length !== 0) {
    throw new Error("Source action unexpectedly contains branch rules.");
  }

  const fixture = {
    project,
    task,
    taskVersion,
    policy,
    catalog,
    product,
    provider,
    operation,
    action,
    actionVersion,
    actionStep: actionSteps[0],
  };

  assertSanitizedConfiguration(
    "Project AI settings",
    sanitizedAiSettings(project.ai_settings),
  );
  assertSanitizedConfiguration("Conversation policy", policy.definition);
  assertSanitizedConfiguration("Task definition", task.definition);
  assertSanitizedConfiguration("Task snapshot", taskVersion.snapshot);
  assertSanitizedConfiguration("Catalog settings", catalog.settings);
  assertSanitizedConfiguration("Product metadata", product.metadata);
  assertSanitizedConfiguration("Manual Review provider", provider.config);
  assertSanitizedConfiguration(
    "Manual Review operation input",
    operation.input_mapping,
  );
  assertSanitizedConfiguration(
    "Manual Review operation output",
    operation.output_mapping,
  );
  assertSanitizedConfiguration(
    "Manual Review operation settings",
    operation.settings,
  );
  assertSanitizedConfiguration("Action settings", action.settings);
  assertSanitizedConfiguration("Action step settings", actionSteps[0].settings);
  assertSanitizedConfiguration("Action snapshot", actionVersion.snapshot);

  return fixture;
}

async function assertNoRuntimeRows(tx, projectId) {
  const tables = await tx`
    select distinct table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'project_id'
    order by table_name
  `;

  for (const { table_name: tableName } of tables) {
    if (tableName === "projects" || CONFIGURATION_TABLES.has(tableName)) {
      continue;
    }
    const [{ count }] = await tx`
      select count(*)::integer as count
      from ${tx(tableName)}
      where project_id = ${projectId}
    `;
    if (count > 0) {
      throw new Error(
        `Target project already contains ${count} row(s) in ${tableName}; refusing to mix the fixture with existing data.`,
      );
    }
  }
}

async function findTargetWorkspace(tx, ownerEmail) {
  const owner = expectExactlyOne(
    await tx`select id from users where lower(email) = ${ownerEmail}`,
    "Staging owner account",
  );
  const memberships = await tx`
    select w.id as workspace_id
    from company_memberships cm
    inner join companies c on c.id = cm.company_id
    inner join workspaces w on w.company_id = c.id
    where cm.user_id = ${owner.id}
      and cm.status = 'active'
      and c.status = 'active'
    order by cm.id, w.id
  `;
  if (memberships.length === 0) {
    throw new Error("Staging owner has no active workspace.");
  }

  return { ownerId: owner.id, workspaceId: memberships[0].workspace_id };
}

async function getConfigurationCounts(tx, projectId) {
  const rows = await Promise.all(
    [...CONFIGURATION_TABLES].map(async (tableName) => {
      const [{ count }] = await tx`
        select count(*)::integer as count
        from ${tx(tableName)}
        where project_id = ${projectId}
      `;
      return [tableName, count];
    }),
  );
  return Object.fromEntries(rows);
}

async function fixtureAlreadyExists(tx, projectId) {
  const fixtureRows = await tx`
    select
      t.id as task_id,
      tv.id as task_version_id,
      a.id as action_id,
      av.id as action_version_id,
      s.id as step_id
    from conversational_tasks t
    inner join conversational_task_versions tv
      on tv.task_id = t.id and tv.project_id = t.project_id
    inner join project_actions a
      on a.project_id = t.project_id and a.name = ${TARGET_ACTION_NAME}
    inner join action_flow_versions av
      on av.id = a.published_version_id and av.action_id = a.id
    inner join action_flow_steps s
      on s.project_id = a.project_id and s.action_id = a.id
    where t.project_id = ${projectId}
      and t.name = ${SOURCE_TASK_NAME}
      and t.is_archived = false
      and tv.version_number = ${SOURCE_TASK_VERSION}
      and a.status = 'active'
      and av.status = 'published'
      and s.step_type = 'conversational_task'
  `;
  if (fixtureRows.length !== 1) {
    return false;
  }

  const requiredCounts = await tx`
    select
      (select count(*)::integer from conversation_project_policies where project_id = ${projectId}) as policies,
      (select count(*)::integer from product_catalogs where project_id = ${projectId} and name = 'Facial' and status = 'active') as catalogs,
      (select count(*)::integer from catalog_products where project_id = ${projectId} and name = 'Classic Facial' and status = 'active') as products,
      (select count(*)::integer from integration_providers where project_id = ${projectId} and provider_type = 'manual_review') as providers,
      (select count(*)::integer from operations where project_id = ${projectId} and operation_type = 'manual_review') as operations,
      (select count(*)::integer from action_flow_branch_rules where project_id = ${projectId} and action_id = ${fixtureRows[0].action_id}) as branch_rules
  `;
  const counts = requiredCounts[0];
  return (
    counts.policies === 1 &&
    counts.catalogs === 1 &&
    counts.products === 1 &&
    counts.providers === 1 &&
    counts.operations === 1 &&
    counts.branch_rules === 0
  );
}

async function repairExistingFixture(tx, projectId, sourceProjectId) {
  const version = expectExactlyOne(
    await tx`
      select tv.id, tv.snapshot
      from conversational_task_versions tv
      inner join conversational_tasks t
        on t.id = tv.task_id and t.project_id = tv.project_id
      where tv.project_id = ${projectId}
        and t.name = ${SOURCE_TASK_NAME}
        and tv.version_number = ${SOURCE_TASK_VERSION}
    `,
    "Existing staging task version",
  );
  const snapshot = remapTaskSnapshotProjectIds(
    version.snapshot,
    sourceProjectId,
    projectId,
  );
  if (JSON.stringify(snapshot) === JSON.stringify(version.snapshot)) {
    return false;
  }
  assertSanitizedConfiguration("Repaired task snapshot", snapshot);
  await tx`
    update conversational_task_versions
    set snapshot = ${tx.json(snapshot)}
    where id = ${version.id} and project_id = ${projectId}
  `;
  return true;
}

async function resolveManualReview(tx, projectId, source) {
  const providers = await tx`
    select * from integration_providers
    where project_id = ${projectId} and provider_type = 'manual_review'
    order by id
  `;
  if (providers.length > 1) {
    throw new Error(
      "Target project contains multiple Manual Review providers.",
    );
  }

  let provider = providers[0];
  if (!provider) {
    [provider] = await tx`
      insert into integration_providers (project_id, name, provider_type, status, config)
      values (${projectId}, ${source.provider.name}, ${source.provider.provider_type}, 'active', ${tx.json(source.provider.config)})
      returning *
    `;
  }

  const operations = await tx`
    select * from operations
    where project_id = ${projectId} and provider_id = ${provider.id} and operation_type = 'manual_review'
    order by id
  `;
  if (operations.length > 1) {
    throw new Error(
      "Target project contains multiple Manual Review operations.",
    );
  }

  let operation = operations[0];
  if (!operation) {
    [operation] = await tx`
      insert into operations (
        project_id, provider_id, name, operation_type, status,
        input_mapping, output_mapping, settings
      ) values (
        ${projectId}, ${provider.id}, ${source.operation.name},
        ${source.operation.operation_type}, 'active',
        ${tx.json(source.operation.input_mapping)},
        ${tx.json(source.operation.output_mapping)},
        ${tx.json(source.operation.settings)}
      ) returning *
    `;
  }

  return { provider, operation };
}

async function seedTarget(tx, source, ownerEmail) {
  const { ownerId, workspaceId } = await findTargetWorkspace(tx, ownerEmail);
  const projects = await tx`
    select * from projects
    where workspace_id = ${workspaceId} and name = ${TARGET_PROJECT_NAME}
    order by id
  `;
  if (projects.length > 1) {
    throw new Error(
      `Multiple target projects are named ${TARGET_PROJECT_NAME}.`,
    );
  }

  let project = projects[0];
  if (!project) {
    [project] = await tx`
      insert into projects (workspace_id, owner_user_id, name, ai_settings)
      values (
        ${workspaceId}, ${ownerId}, ${TARGET_PROJECT_NAME},
        ${tx.json(sanitizedAiSettings(source.project.ai_settings))}
      ) returning *
    `;
  } else {
    if (await fixtureAlreadyExists(tx, project.id)) {
      const repaired = await repairExistingFixture(
        tx,
        project.id,
        source.project.id,
      );
      return { projectId: project.id, repaired, seeded: false };
    }
    await assertNoRuntimeRows(tx, project.id);

    const counts = await getConfigurationCounts(tx, project.id);
    const unexpected = Object.entries(counts).filter(
      ([tableName, count]) =>
        count > 0 &&
        !new Set(["integration_providers", "operations"]).has(tableName),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Target project already contains configuration in ${unexpected.map(([name]) => name).join(", ")}.`,
      );
    }
    await tx`
      update projects
      set ai_settings = ${tx.json(sanitizedAiSettings(source.project.ai_settings))}
      where id = ${project.id}
    `;
  }

  const unrelatedProviders = await tx`
    select count(*)::integer as count from integration_providers
    where project_id = ${project.id} and provider_type <> 'manual_review'
  `;
  const unrelatedOperations = await tx`
    select count(*)::integer as count from operations
    where project_id = ${project.id} and operation_type <> 'manual_review'
  `;
  if (unrelatedProviders[0].count > 0 || unrelatedOperations[0].count > 0) {
    throw new Error(
      "Target project contains unrelated providers or operations.",
    );
  }

  const { operation } = await resolveManualReview(tx, project.id, source);
  await tx`
    insert into conversation_project_policies (project_id, schema_version, definition)
    values (${project.id}, ${source.policy.schema_version}, ${tx.json(source.policy.definition)})
  `;

  const [catalog] = await tx`
    insert into product_catalogs (
      project_id, name, description, status, provider_type, external_id, settings
    ) values (
      ${project.id}, ${source.catalog.name}, ${source.catalog.description},
      ${source.catalog.status}, ${source.catalog.provider_type},
      ${source.catalog.external_id}, ${tx.json(source.catalog.settings)}
    ) returning *
  `;
  await tx`
    insert into catalog_products (
      project_id, catalog_id, sku, name, description, image_url, product_url,
      price_amount, currency, status, metadata
    ) values (
      ${project.id}, ${catalog.id}, ${source.product.sku}, ${source.product.name},
      ${source.product.description}, ${source.product.image_url},
      ${source.product.product_url}, ${source.product.price_amount},
      ${source.product.currency}, ${source.product.status},
      ${tx.json(source.product.metadata)}
    )
  `;

  const taskDefinition = remapOperationReferences(
    source.task.definition,
    source.operation.id,
    operation.id,
  );
  const [task] = await tx`
    insert into conversational_tasks (
      project_id, schema_version, name, objective, description, definition,
      is_archived, archived_at
    ) values (
      ${project.id}, ${source.task.schema_version}, ${source.task.name},
      ${source.task.objective}, ${source.task.description},
      ${tx.json(taskDefinition)}, false, null
    ) returning *
  `;
  const taskSnapshot = buildTaskSnapshot({
    snapshot: source.taskVersion.snapshot,
    sourceOperationId: source.operation.id,
    sourceProjectId: source.project.id,
    sourceTaskId: source.task.id,
    targetOperationId: operation.id,
    targetProjectId: project.id,
    targetTaskId: task.id,
  });
  const [taskVersion] = await tx`
    insert into conversational_task_versions (
      project_id, task_id, version_number, snapshot, published_by_user_id
    ) values (
      ${project.id}, ${task.id}, ${SOURCE_TASK_VERSION},
      ${tx.json(taskSnapshot)}, ${ownerId}
    ) returning *
  `;

  const [action] = await tx`
    insert into project_actions (
      project_id, name, description, status, trigger_phrases, settings
    ) values (
      ${project.id}, ${TARGET_ACTION_NAME}, ${TARGET_ACTION_DESCRIPTION},
      'active', ${tx.json(TARGET_TRIGGER_PHRASES)}, ${tx.json({})}
    ) returning *
  `;
  const actionStepSettings = remapTaskWrapperSettings({
    settings: source.actionStep.settings,
    sourceTaskId: source.task.id,
    sourceTaskVersionId: source.taskVersion.id,
    targetTaskId: task.id,
    targetTaskVersionId: taskVersion.id,
  });
  const [actionStep] = await tx`
    insert into action_flow_steps (
      project_id, action_id, sort_order, step_type, field_key, label, prompt,
      input_type, is_required, is_enabled, options, settings, next_step_id,
      operation_id
    ) values (
      ${project.id}, ${action.id}, 1, 'conversational_task', null,
      'Run Phase 14 booking', ${source.actionStep.prompt}, null, false, true,
      ${tx.json([])}, ${tx.json(actionStepSettings)}, null, null
    ) returning *
  `;
  const publishedAt = new Date().toISOString();
  const actionSnapshot = buildActionSnapshot({
    actionDescription: TARGET_ACTION_DESCRIPTION,
    actionName: TARGET_ACTION_NAME,
    actionSnapshot: source.actionVersion.snapshot,
    actionTriggerPhrases: TARGET_TRIGGER_PHRASES,
    publishedAt,
    sourceActionId: source.action.id,
    sourceStepId: source.actionStep.id,
    sourceTaskId: source.task.id,
    sourceTaskVersionId: source.taskVersion.id,
    targetActionId: action.id,
    targetStepId: actionStep.id,
    targetTaskId: task.id,
    targetTaskVersionId: taskVersion.id,
  });
  assertSanitizedConfiguration("Remapped task definition", taskDefinition);
  assertSanitizedConfiguration("Remapped task snapshot", taskSnapshot);
  assertSanitizedConfiguration("Remapped action snapshot", actionSnapshot);

  const [actionVersion] = await tx`
    insert into action_flow_versions (
      project_id, action_id, version_number, status, snapshot,
      published_by_user_id, published_at
    ) values (
      ${project.id}, ${action.id}, 1, 'published',
      ${tx.json(actionSnapshot)}, ${ownerId}, ${publishedAt}
    ) returning *
  `;
  await tx`
    update project_actions
    set published_version_id = ${actionVersion.id}, updated_at = now()
    where id = ${action.id} and project_id = ${project.id}
  `;

  return { projectId: project.id, repaired: false, seeded: true };
}

async function main() {
  const checkSourceOnly = process.argv.includes("--check-source");
  const sourceValue = requiredValue(
    "EXISTING_DATABASE_URL or .env.local DATABASE_URL",
    process.env.EXISTING_DATABASE_URL ?? getLocalDatabaseUrl(),
  );
  const sourceUrl = parseDatabaseUrl("Source database URL", sourceValue);
  if (checkSourceOnly) {
    const source = postgres(sourceValue, { max: 1, prepare: false });
    try {
      await loadSourceFixture(source);
      console.log("Phase 14 source fixture validation passed.");
    } finally {
      await source.end();
    }
    return;
  }

  const targetValue = requiredValue(
    "STAGING_DATABASE_URL",
    process.env.STAGING_DATABASE_URL,
  );
  const ownerEmail = requiredValue(
    "PHASE14_OWNER_EMAIL",
    process.env.PHASE14_OWNER_EMAIL,
  ).toLowerCase();
  const targetUrl = parseDatabaseUrl("Staging database URL", targetValue);
  if (databaseIdentity(sourceUrl) === databaseIdentity(targetUrl)) {
    throw new Error("Source and staging database connections are identical.");
  }

  const source = postgres(sourceValue, { max: 1, prepare: false });
  const target = postgres(targetValue, { max: 1, prepare: false });
  try {
    const fixture = await loadSourceFixture(source);
    const result = await target.begin((tx) =>
      seedTarget(tx, fixture, ownerEmail),
    );
    console.log(
      result.seeded
        ? `Seeded ${TARGET_PROJECT_NAME} as project #${result.projectId}.`
        : result.repaired
          ? `Repaired ${TARGET_PROJECT_NAME} as project #${result.projectId}.`
          : `${TARGET_PROJECT_NAME} is already seeded as project #${result.projectId}.`,
    );
    console.log(
      "Copied configuration: conversation policy, task v4, one catalog product, Manual Review, and one published task wrapper.",
    );
    console.log(
      "Excluded: credentials, users, contacts, conversations, submissions, runs, audit logs, widget keys, documents, media, and channel records.",
    );
  } finally {
    await Promise.allSettled([source.end(), target.end()]);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Staging seed failed.",
  );
  process.exitCode = 1;
});
