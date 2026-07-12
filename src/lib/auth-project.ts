import { cookies } from "next/headers";
import { auth } from "@/auth";
import {
  getActiveCompanyForUserById,
  getOrCreateDefaultCompanyForUser,
  INACTIVE_ACCOUNT_ERROR_MESSAGE,
} from "@/lib/companies";
import {
  getFirstProjectForWorkspace,
  getProjectForWorkspaceById,
} from "@/lib/projects";
import { getUserByEmail } from "@/lib/users";
import { getOrCreateDefaultWorkspaceForCompany } from "@/lib/workspaces";

const ACTIVE_COMPANY_COOKIE = "active_company_id";
const ACTIVE_PROJECT_COOKIE = "active_project_id";
const NO_AVAILABLE_PROJECT_ERROR =
  "No available project found. Create or unarchive a project.";

export async function resolveUserAndWorkspace() {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    throw new Error("Unauthorized");
  }

  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("User not found");
  }

  const activeCompanyId = await getActiveCompanyIdCookie();
  const selectedCompany =
    activeCompanyId !== null
      ? await getActiveCompanyForUserById(activeCompanyId, user.id)
      : null;
  const { company, membership } =
    selectedCompany ?? (await getOrCreateDefaultCompanyForUser(user));
  const workspace = await getOrCreateDefaultWorkspaceForCompany({
    companyId: company.id,
    companyName: company.name,
    userId: user.id,
    user,
  });

  return { user, company, membership, workspace };
}

export async function resolveUserAndProject(projectIdInput?: unknown) {
  return resolveUserAndProjectWithOptions(projectIdInput);
}

export async function resolveStrictUserAndProject(projectIdInput: unknown) {
  return resolveUserAndProjectWithOptions(projectIdInput, {
    allowProjectFallback: false,
  });
}

async function resolveUserAndProjectWithOptions(
  projectIdInput?: unknown,
  options: { allowProjectFallback?: boolean } = {},
) {
  const { user, company, membership, workspace } =
    await resolveUserAndWorkspace();
  const allowProjectFallback = options.allowProjectFallback ?? true;

  const parsedProjectId =
    typeof projectIdInput === "number"
      ? projectIdInput
      : typeof projectIdInput === "string" && projectIdInput.trim() !== ""
        ? Number(projectIdInput)
        : undefined;

  const cookieStore = await cookies();
  const cookieProjectId = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;
  const parsedCookieProjectId =
    typeof cookieProjectId === "string" && cookieProjectId.trim() !== ""
      ? Number(cookieProjectId)
      : undefined;

  const targetProjectId = parsedProjectId ?? parsedCookieProjectId;

  if (
    targetProjectId !== undefined &&
    Number.isInteger(targetProjectId) &&
    targetProjectId > 0
  ) {
    const project = await getProjectForWorkspaceById(
      targetProjectId,
      workspace.id,
    );
    if (project) {
      return { user, company, membership, workspace, project };
    }

    if (!allowProjectFallback) {
      throw new Error("Project not found.");
    }
  }

  const defaultProject = await getFirstProjectForWorkspace(workspace.id);
  if (!defaultProject) {
    throw new Error(NO_AVAILABLE_PROJECT_ERROR);
  }

  return { user, company, membership, workspace, project: defaultProject };
}

export function isNoAvailableProjectError(error: unknown) {
  return error instanceof Error && error.message === NO_AVAILABLE_PROJECT_ERROR;
}

export function isInactiveAccountError(error: unknown) {
  return (
    error instanceof Error && error.message === INACTIVE_ACCOUNT_ERROR_MESSAGE
  );
}

export async function resolveOptionalUserAndProject(projectIdInput?: unknown) {
  try {
    return await resolveUserAndProject(projectIdInput);
  } catch (error) {
    if (isNoAvailableProjectError(error)) {
      return null;
    }

    throw error;
  }
}

export async function setActiveCompanyCookie(companyId: number) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, String(companyId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getActiveCompanyIdCookie() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value;
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function setActiveProjectCookie(projectId: number) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PROJECT_COOKIE, String(projectId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getActiveProjectIdCookie() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function clearActiveProjectCookie() {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PROJECT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
