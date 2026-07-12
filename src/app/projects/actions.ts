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
  createProjectForWorkspace,
  getProjectForWorkspaceById,
  listActiveProjectsForWorkspace,
  setProjectArchivedForWorkspace,
  setProjectUnarchivedForWorkspace,
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

const projectIdSchema = z.coerce.number().int().positive();
const deleteDocumentSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceDocumentId: z.coerce.number().int().positive(),
});

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
    redirect("/projects?error=Project%20not%20found.");
  }
  if (project.isArchived) {
    redirect("/projects?error=Project%20is%20already%20archived.");
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
    redirect(
      "/projects?error=Create%20or%20unarchive%20another%20project%20before%20archiving%20this%20one.",
    );
  }

  const archived = await setProjectArchivedForWorkspace(
    project.id,
    context.workspace.id,
  );
  if (!archived) {
    redirect("/projects?error=Failed%20to%20archive%20project.");
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
  revalidatePath("/", "layout");
  redirect("/projects?archived=1");
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
    redirect("/projects?error=Project%20not%20found.");
  }
  if (!project.isArchived) {
    redirect("/projects?error=Project%20is%20already%20available.");
  }

  const unarchived = await setProjectUnarchivedForWorkspace(
    project.id,
    context.workspace.id,
  );
  if (!unarchived) {
    redirect("/projects?error=Failed%20to%20unarchive%20project.");
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
  revalidatePath("/", "layout");
  redirect("/projects?unarchived=1");
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
