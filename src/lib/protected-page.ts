import { redirect } from "next/navigation";
import {
  getActiveProjectIdCookie,
  isInactiveAccountError,
  resolveOptionalUserAndProject,
  resolveStrictUserAndProject,
  resolveUserAndProject,
  resolveUserAndWorkspace,
} from "@/lib/auth-project";

export { getActiveProjectIdCookie };

export function redirectInactiveAccount(error: unknown): never {
  if (isInactiveAccountError(error)) {
    redirect("/account-disabled");
  }

  throw error;
}

export async function resolvePageUserAndWorkspace() {
  try {
    return await resolveUserAndWorkspace();
  } catch (error) {
    redirectInactiveAccount(error);
  }
}

export async function resolvePageUserAndProject(projectIdInput?: unknown) {
  try {
    return await resolveUserAndProject(projectIdInput);
  } catch (error) {
    redirectInactiveAccount(error);
  }
}

export async function resolveStrictPageUserAndProject(projectIdInput: unknown) {
  try {
    return await resolveStrictUserAndProject(projectIdInput);
  } catch (error) {
    redirectInactiveAccount(error);
  }
}

export async function resolveOptionalPageUserAndProject(
  projectIdInput?: unknown,
) {
  try {
    return await resolveOptionalUserAndProject(projectIdInput);
  } catch (error) {
    redirectInactiveAccount(error);
  }
}
