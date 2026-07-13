"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveProjectIdCookie,
  resolveUserAndProject,
  resolveUserAndWorkspace,
  setActiveProjectCookie,
} from "@/lib/auth-project";
import {
  deleteAllDocumentsFromProject,
  deleteSourceDocumentFromProject,
} from "@/lib/documents";
import {
  AI_ANSWER_LENGTHS,
  AI_ASSISTANT_ROLES,
  AI_EXTRA_HELP_POLICIES,
  AI_FOLLOW_UP_POLICIES,
  AI_TONES,
  compactProjectAiSettings,
  normalizeProjectAiSettings,
} from "@/lib/project-ai-settings";
import {
  createProjectForWorkspace,
  getProjectForWorkspaceById,
  listActiveProjectsForWorkspace,
  setProjectArchivedForWorkspace,
  setProjectUnarchivedForWorkspace,
  updateProjectAiSettingsForWorkspace,
  updateProjectNameForWorkspace,
} from "@/lib/projects";
import { updateProjectWidgetTokenStatus } from "@/lib/widget-keys";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
const renameProjectSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(120),
});
const updateProjectAiSettingsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  assistantName: z.string().trim().max(80),
  businessName: z.string().trim().max(120),
  role: z.enum(AI_ASSISTANT_ROLES),
  tone: z.enum(AI_TONES),
  answerLength: z.enum(AI_ANSWER_LENGTHS),
  followUpPolicy: z.enum(AI_FOLLOW_UP_POLICIES),
  extraHelpPolicy: z.enum(AI_EXTRA_HELP_POLICIES),
  fallbackPhone: z.string().trim().max(80),
  fallbackEmail: z
    .string()
    .trim()
    .max(160)
    .refine((value) => !value || z.string().email().safeParse(value).success),
  fallbackMessage: z.string().trim().max(240),
});

const projectIdSchema = z.coerce.number().int().positive();
const deleteDocumentSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceDocumentId: z.coerce.number().int().positive(),
});

function getProjectMutationReturnPath(formData: FormData, projectId: number) {
  const redirectTo = formData.get("redirectTo");
  const settingsPath = `/projects/${projectId}/settings`;

  return redirectTo === settingsPath ? settingsPath : "/projects";
}

function redirectWithProjectMutationError(
  formData: FormData,
  projectId: number,
  message: string,
): never {
  const returnPath = getProjectMutationReturnPath(formData, projectId);
  redirect(`${returnPath}?error=${encodeURIComponent(message)}`);
}

function redirectWithProjectMutationSuccess(
  formData: FormData,
  projectId: number,
  key: "archived" | "unarchived",
): never {
  const returnPath = getProjectMutationReturnPath(formData, projectId);
  redirect(`${returnPath}?${key}=1`);
}

export async function createProjectAction(formData: FormData) {
  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    redirect(
      "/projects/new?error=Please%20provide%20a%20valid%20project%20name.",
    );
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");
  const project = await createProjectForWorkspace(
    context.workspace.id,
    context.user.id,
    parsed.data.name,
  );
  await writeAuditLog({
    ...context,
    project,
    action: "project.created",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name },
  });

  await setActiveProjectCookie(project.id);
  revalidatePath("/projects");
  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/", "layout");
  redirect(`/projects/${project.id}?created=1`);
}

export async function renameProjectAction(formData: FormData) {
  const parsed = renameProjectSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    const projectId = projectIdSchema.safeParse(formData.get("projectId"));
    redirect(
      projectId.success
        ? `/projects/${projectId.data}/settings?error=Please%20provide%20a%20valid%20project%20name.`
        : "/projects?error=Please%20provide%20a%20valid%20project%20name.",
    );
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");
  const project = await updateProjectNameForWorkspace(
    parsed.data.projectId,
    context.workspace.id,
    parsed.data.name,
  );

  if (!project) {
    redirect("/projects?error=Project%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    project,
    action: "project.renamed",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/settings`);
  revalidatePath("/", "layout");
  redirect(`/projects/${project.id}/settings?renamed=1`);
}

export async function updateProjectAiSettingsAction(formData: FormData) {
  const parsed = updateProjectAiSettingsSchema.safeParse({
    projectId: formData.get("projectId"),
    assistantName: formData.get("assistantName"),
    businessName: formData.get("businessName"),
    role: formData.get("role"),
    tone: formData.get("tone"),
    answerLength: formData.get("answerLength"),
    followUpPolicy: formData.get("followUpPolicy"),
    extraHelpPolicy: formData.get("extraHelpPolicy"),
    fallbackPhone: formData.get("fallbackPhone"),
    fallbackEmail: formData.get("fallbackEmail"),
    fallbackMessage: formData.get("fallbackMessage"),
  });

  const fallbackProjectId = projectIdSchema.safeParse(
    formData.get("projectId"),
  );
  const errorPath = fallbackProjectId.success
    ? `/projects/${fallbackProjectId.data}/settings`
    : "/projects";

  if (!parsed.success) {
    redirect(`${errorPath}?error=Please%20check%20the%20AI%20settings.`);
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");

  const project = await updateProjectAiSettingsForWorkspace(
    parsed.data.projectId,
    context.workspace.id,
    compactProjectAiSettings(
      normalizeProjectAiSettings({
        answerLength: parsed.data.answerLength,
        assistantName: parsed.data.assistantName,
        businessName: parsed.data.businessName,
        extraHelpPolicy: parsed.data.extraHelpPolicy,
        fallbackEmail: parsed.data.fallbackEmail,
        fallbackMessage: parsed.data.fallbackMessage,
        fallbackPhone: parsed.data.fallbackPhone,
        followUpPolicy: parsed.data.followUpPolicy,
        role: parsed.data.role,
        tone: parsed.data.tone,
      }),
    ),
  );

  if (!project) {
    redirect(`${errorPath}?error=Project%20not%20found.`);
  }

  await writeAuditLog({
    ...context,
    project,
    action: "project.ai_settings_updated",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name },
  });

  revalidatePath(`/projects/${project.id}/settings`);
  revalidatePath("/", "layout");
  redirect(`/projects/${project.id}/settings?aiSettings=1`);
}

export async function setActiveProjectAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    redirect("/projects?error=Invalid%20project.");
  }

  const { workspace } = await resolveUserAndWorkspace();
  const project = await getProjectForWorkspaceById(parsed.data, workspace.id);
  if (!project) {
    redirect("/projects?error=Project%20not%20found.");
  }

  await setActiveProjectCookie(project.id);
  revalidatePath("/projects");
  revalidatePath("/projects/widget");
  revalidatePath("/projects/analytics");

  const redirectToValue = formData.get("redirectTo");
  const isProjectLandingRedirect =
    typeof redirectToValue === "string" &&
    /^\/projects\/\d+$/.test(redirectToValue);

  const redirectTo =
    (typeof redirectToValue === "string" &&
      ["/projects", "/projects/widget", "/projects/analytics"].includes(
        redirectToValue,
      )) ||
    isProjectLandingRedirect
      ? redirectToValue
      : "/projects";

  if (redirectTo === "/projects") {
    redirect("/projects?switched=1");
  }

  redirect(redirectTo);
}

export async function selectProjectFromHeaderAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    throw new Error("Invalid project.");
  }

  const { workspace } = await resolveUserAndWorkspace();
  const project = await getProjectForWorkspaceById(parsed.data, workspace.id);
  if (!project) {
    throw new Error("Project not found.");
  }

  await setActiveProjectCookie(project.id);
  revalidatePath("/", "layout");
}

export async function createProjectFromHeaderAction(formData: FormData) {
  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    throw new Error("Please provide a valid project name.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");
  const project = await createProjectForWorkspace(
    context.workspace.id,
    context.user.id,
    parsed.data.name,
  );
  await writeAuditLog({
    ...context,
    project,
    action: "project.created",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name, source: "header" },
  });
  await setActiveProjectCookie(project.id);

  revalidatePath("/", "layout");
}

export async function archiveProjectAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    redirect("/projects?error=Invalid%20project.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");
  const project = await getProjectForWorkspaceById(
    parsed.data,
    context.workspace.id,
    true,
  );
  if (!project) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Project not found.",
    );
  }
  if (project.isArchived) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Project is already archived.",
    );
  }

  const selectedProjectId = await getActiveProjectIdCookie();
  const activeProjects = await listActiveProjectsForWorkspace(
    context.workspace.id,
  );
  const fallbackProject =
    activeProjects.find((item) => item.id !== project.id) ?? null;
  const willArchiveSelected = selectedProjectId === project.id;
  const willHaveAlternative = Boolean(fallbackProject);

  if (willArchiveSelected && !willHaveAlternative) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Create or unarchive another project before archiving this one.",
    );
  }

  const archived = await setProjectArchivedForWorkspace(
    project.id,
    context.workspace.id,
  );
  if (!archived) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Failed to archive project.",
    );
  }

  await updateProjectWidgetTokenStatus(project.id, false);
  await writeAuditLog({
    ...context,
    project: archived,
    action: "project.archived",
    targetType: "project",
    targetId: archived.id,
    metadata: { name: archived.name, widgetDisabled: true },
  });

  if (willArchiveSelected && fallbackProject) {
    await setActiveProjectCookie(fallbackProject.id);
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${project.id}/settings`);
  revalidatePath("/", "layout");
  redirectWithProjectMutationSuccess(formData, project.id, "archived");
}

export async function unarchiveProjectAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    redirect("/projects?error=Invalid%20project.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");
  const project = await getProjectForWorkspaceById(
    parsed.data,
    context.workspace.id,
    true,
  );
  if (!project) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Project not found.",
    );
  }
  if (!project.isArchived) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Project is already available.",
    );
  }

  const unarchived = await setProjectUnarchivedForWorkspace(
    project.id,
    context.workspace.id,
  );
  if (!unarchived) {
    redirectWithProjectMutationError(
      formData,
      parsed.data,
      "Failed to unarchive project.",
    );
  }

  // Restore widget availability on unarchive without rotating token,
  // so existing embed snippets keep working.
  await updateProjectWidgetTokenStatus(project.id, true);
  await writeAuditLog({
    ...context,
    project: unarchived,
    action: "project.unarchived",
    targetType: "project",
    targetId: unarchived.id,
    metadata: { name: unarchived.name, widgetEnabled: true },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${project.id}/settings`);
  revalidatePath("/", "layout");
  redirectWithProjectMutationSuccess(formData, project.id, "unarchived");
}

export async function deleteSourceDocumentAction(formData: FormData) {
  const parsed = deleteDocumentSchema.safeParse({
    projectId: formData.get("projectId"),
    sourceDocumentId: formData.get("sourceDocumentId"),
  });
  if (!parsed.success) {
    redirect("/projects?error=Invalid%20document%20delete%20request.");
  }

  const context = await resolveUserAndProject(parsed.data.projectId);
  assertPermission(context.membership, "company.documents.manage");
  await deleteSourceDocumentFromProject(
    context.project.id,
    parsed.data.sourceDocumentId,
  );
  await writeAuditLog({
    ...context,
    action: "document.deleted",
    targetType: "source_document",
    targetId: parsed.data.sourceDocumentId,
  });

  revalidatePath("/projects");
  redirect("/projects?deleted=1");
}

export async function deleteAllDocumentsAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    redirect("/projects?error=Invalid%20project%20for%20delete.");
  }

  const context = await resolveUserAndProject(parsed.data);
  assertPermission(context.membership, "company.documents.manage");
  await deleteAllDocumentsFromProject(context.project.id);
  await writeAuditLog({
    ...context,
    action: "documents.deleted_all",
    targetType: "project",
    targetId: context.project.id,
  });

  revalidatePath("/projects");
  redirect("/projects?deletedAll=1");
}
