#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

function normalize(value) {
  return value.replace(/\r\n/g, "\n");
}

function assertIncludes(relPath, snippet, label) {
  const content = normalize(read(relPath));
  if (!content.includes(snippet)) {
    failures.push(`${label}: ${relPath} is missing ${JSON.stringify(snippet)}`);
  }
}

function assertCountAtLeast(relPath, snippet, minimum, label) {
  const content = normalize(read(relPath));
  const count = content.split(snippet).length - 1;
  if (count < minimum) {
    failures.push(
      `${label}: ${relPath} has ${count} occurrence(s) of ${JSON.stringify(
        snippet,
      )}; expected at least ${minimum}`,
    );
  }
}

function tableBlock(schema, tableName) {
  const marker = `export const ${tableName} = pgTable(`;
  const start = schema.indexOf(marker);
  if (start === -1) {
    failures.push(`Schema: missing table declaration ${tableName}`);
    return "";
  }

  const next = schema.indexOf("\nexport const ", start + marker.length);
  return schema.slice(start, next === -1 ? undefined : next);
}

function assertTableHasColumns(schema, tableName, columns) {
  const block = tableBlock(schema, tableName);
  for (const column of columns) {
    if (!block.includes(`${column}:`)) {
      failures.push(
        `Schema: ${tableName} is missing required column ${column}`,
      );
    }
  }
}

function listSourceFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

function rel(fullPath) {
  return path.relative(root, fullPath).replaceAll(path.sep, "/");
}

function statementAround(content, index) {
  const functionStart = Math.max(
    content.lastIndexOf("export async function ", index),
    content.lastIndexOf("async function ", index),
    content.lastIndexOf("export function ", index),
    content.lastIndexOf("function ", index),
  );
  const start =
    functionStart === -1 ? content.lastIndexOf(";", index) : functionStart;
  const end = content.indexOf(";", index);
  return content.slice(
    start === -1 ? 0 : start + 1,
    end === -1 ? undefined : end,
  );
}

const schema = normalize(read("src/lib/db-schema.ts"));

const schemaScopeChecks = [
  ["workspaces", ["companyId"]],
  ["companyMemberships", ["companyId", "userId"]],
  ["companyInvitations", ["companyId", "email", "tokenHash"]],
  ["projects", ["workspaceId", "ownerUserId"]],
  ["projectWidgetKeys", ["projectId"]],
  ["integrationProviders", ["projectId"]],
  ["operations", ["projectId", "providerId"]],
  ["projectActions", ["projectId"]],
  ["actionFlowSteps", ["projectId", "actionId", "operationId"]],
  [
    "actionFlowBranchRules",
    ["projectId", "actionId", "sourceStepId", "targetStepId"],
  ],
  ["actionFlowVersions", ["projectId", "actionId"]],
  ["actionSubmissions", ["projectId", "actionId"]],
  ["actionSubmissionEvents", ["projectId", "submissionId"]],
  ["projectChannels", ["projectId"]],
  ["channelConversations", ["projectId", "channelType", "contactId"]],
  ["channelMessages", ["projectId", "conversationId"]],
  ["mediaAssets", ["projectId"]],
  ["productCatalogs", ["projectId"]],
  ["catalogProducts", ["projectId", "catalogId"]],
  ["contacts", ["projectId", "primaryChannelType", "primaryExternalId"]],
  ["contactAttributes", ["projectId", "contactId", "key"]],
  ["contactTags", ["projectId", "name"]],
  ["contactTagAssignments", ["projectId", "contactId", "tagId"]],
  ["operationAttempts", ["projectId", "operationId", "providerId"]],
  ["chatRequestLogs", ["projectId"]],
  ["auditLogs", ["companyId", "workspaceId", "projectId"]],
  ["sourceDocuments", ["projectId"]],
  ["uploadJobs", ["projectId", "sourceDocumentId"]],
  ["documents", ["projectId", "sourceDocumentId"]],
];

for (const [tableName, columns] of schemaScopeChecks) {
  assertTableHasColumns(schema, tableName, columns);
}

assertIncludes(
  "src/lib/auth-project.ts",
  "getProjectForWorkspaceById(\n      targetProjectId,\n      workspace.id,",
  "Tenant resolver",
);
assertCountAtLeast(
  "src/lib/projects.ts",
  "eq(projects.workspaceId, workspaceId)",
  5,
  "Project access",
);
assertIncludes(
  "src/lib/documents.ts",
  "eq(sourceDocuments.projectId, projectId)",
  "Document access",
);
assertIncludes(
  "src/lib/documents.ts",
  "eq(documents.projectId, projectId)",
  "Document chunk access",
);
assertIncludes(
  "src/lib/action-flows.ts",
  "eq(projectActions.projectId, projectId)",
  "Action access",
);
assertIncludes(
  "src/lib/action-flows.ts",
  "eq(actionFlowSteps.projectId, projectId)",
  "Action flow access",
);
assertIncludes(
  "src/lib/action-flows.ts",
  "eq(actionSubmissions.projectId, projectId)",
  "Submission access",
);
assertIncludes(
  "src/lib/action-flows.ts",
  "eq(actionSubmissionEvents.projectId, projectId)",
  "Submission event access",
);
assertIncludes(
  "src/lib/search.ts",
  "eq(documents.projectId, projectId)",
  "Knowledge search access",
);
assertIncludes(
  "src/lib/chat-analytics.ts",
  "eq(chatRequestLogs.projectId, projectId)",
  "Analytics access",
);
assertIncludes(
  "src/lib/audit.ts",
  "eq(auditLogs.companyId, companyId)",
  "Audit access",
);
assertIncludes(
  "src/app/api/chat/route.ts",
  "resolveUserAndProject(projectId)",
  "Admin chat API",
);
assertIncludes(
  "src/app/api/actions/submissions/route.ts",
  "resolveUserAndProject()",
  "Admin submission API",
);
assertIncludes(
  "src/app/api/widget/actions/submissions/route.ts",
  "resolveWidgetTokenAccessForRequest",
  "Widget submission API",
);
assertIncludes(
  "src/app/api/widget/actions/submissions/route.ts",
  "getProjectAction(\n      widgetAccess.projectId,",
  "Widget submission action access",
);
assertIncludes(
  "src/app/api/projects/widget-token/route.ts",
  "resolveStrictUserAndProject(parsed.data.projectId)",
  "Widget admin API",
);
assertIncludes(
  "src/app/api/projects/widget-token/route.ts",
  'assertPermission(context.membership, "company.widget.manage")',
  "Widget admin permission",
);

const scopedReadRequirements = new Map([
  ["projects", ["projects.workspaceId", "projects.ownerUserId"]],
  ["projectWidgetKeys", ["projectWidgetKeys.projectId"]],
  ["integrationProviders", ["integrationProviders.projectId"]],
  ["operations", ["operations.projectId"]],
  ["projectActions", ["projectActions.projectId"]],
  ["actionFlowSteps", ["actionFlowSteps.projectId"]],
  ["actionFlowBranchRules", ["actionFlowBranchRules.projectId"]],
  ["actionFlowVersions", ["actionFlowVersions.projectId"]],
  ["actionSubmissions", ["actionSubmissions.projectId"]],
  ["actionSubmissionEvents", ["actionSubmissionEvents.projectId"]],
  ["projectChannels", ["projectChannels.projectId"]],
  ["channelConversations", ["channelConversations.projectId"]],
  ["channelMessages", ["channelMessages.projectId"]],
  ["mediaAssets", ["mediaAssets.projectId"]],
  ["productCatalogs", ["productCatalogs.projectId"]],
  ["catalogProducts", ["catalogProducts.projectId"]],
  ["contacts", ["contacts.projectId"]],
  ["contactAttributes", ["contactAttributes.projectId"]],
  ["contactTags", ["contactTags.projectId"]],
  ["contactTagAssignments", ["contactTagAssignments.projectId"]],
  ["operationAttempts", ["operationAttempts.projectId"]],
  ["chatRequestLogs", ["chatRequestLogs.projectId"]],
  ["auditLogs", ["auditLogs.companyId"]],
  ["companyInvitations", ["companyInvitations.companyId"]],
  ["sourceDocuments", ["sourceDocuments.projectId"]],
  ["uploadJobs", ["uploadJobs.projectId"]],
  ["documents", ["documents.projectId"]],
]);

const allowedUnscopedStatements = [
  {
    file: "src/lib/invitations.ts",
    table: "companyInvitations",
    reason:
      "invitation accept flow resolves the company boundary from a one-time token hash",
  },
  {
    file: "src/lib/widget-keys.ts",
    table: "projectWidgetKeys",
    reason:
      "public widget token lookup resolves the project boundary from a token hash",
  },
  {
    file: "src/lib/widget-keys.ts",
    table: "projects",
    reason:
      "public widget token lookup checks archived state for the resolved project id",
  },
  {
    file: "src/lib/whatsapp.ts",
    table: "projectChannels",
    reason:
      "public WhatsApp webhook resolves the project boundary from Meta phone number id or verify token",
  },
  {
    file: "src/lib/upload-queue.ts",
    table: "uploadJobs",
    reason:
      "background queue worker claims global queued jobs, then carries project_id forward",
  },
  {
    file: "src/lib/upload-queue.ts",
    table: "sourceDocuments",
    reason:
      "background queue worker updates the source document attached to a claimed job",
  },
  {
    file: "src/lib/chat-logs.ts",
    table: "chatRequestLogs",
    reason: "log retention and error logging can operate across projects",
  },
];

const accessPattern = /\.(from|update|delete)\(\s*([A-Za-z0-9_]+)\s*\)/g;
for (const fullPath of listSourceFiles(path.join(root, "src"))) {
  const file = rel(fullPath);
  if (file === "src/lib/db-schema.ts") {
    continue;
  }

  const content = normalize(readFileSync(fullPath, "utf8"));

  while (true) {
    const match = accessPattern.exec(content);
    if (match === null) {
      break;
    }

    const [, operation, table] = match;
    const requirements = scopedReadRequirements.get(table);
    if (!requirements) {
      continue;
    }

    const statement = statementAround(content, match.index);
    const isScoped = requirements.some((snippet) =>
      statement.includes(snippet),
    );
    const allowed = allowedUnscopedStatements.find(
      (item) => item.file === file && item.table === table,
    );

    if (!isScoped && !allowed) {
      failures.push(
        `Data access: ${file} uses .${operation}(${table}) without ${requirements.join(
          " or ",
        )}`,
      );
    }

    if (!isScoped && allowed) {
      warnings.push(`Allowed exception: ${file} ${table} - ${allowed.reason}`);
    }
  }
}

if (warnings.length > 0) {
  console.log("Tenant scope check warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
  console.log("");
}

if (failures.length > 0) {
  console.error("Tenant scope check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Tenant scope check passed.");
console.log(`- Schema checks: ${schemaScopeChecks.length}`);
console.log("- Critical resolver/API/helper checks passed.");
console.log("- Direct scoped table access scan passed.");
