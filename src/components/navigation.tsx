import Link from "next/link";
import { auth } from "@/auth";
import { CompanySelectorModal } from "@/components/company-selector-modal";
import { NavigationActions } from "@/components/navigation-actions";
import { ProjectSelectorModal } from "@/components/project-selector-modal";
import {
  getActiveProjectIdCookie,
  resolveUserAndWorkspace,
} from "@/lib/auth-project";
import { listActiveCompaniesForUser } from "@/lib/companies";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import {
  getFirstProjectForWorkspace,
  getProjectForWorkspaceById,
  listActiveProjectsForWorkspace,
} from "@/lib/projects";

export const Navigation = async () => {
  const session = await auth();
  const isSignedIn = Boolean(session?.user);
  let selectedProjectLabel: string | null = null;
  let selectedProjectId: number | null = null;
  let selectableProjects: { id: number; name: string }[] = [];
  let selectedCompanyLabel: string | null = null;
  let selectedCompanyId: number | null = null;
  let selectableCompanies: { id: number; name: string; role: string }[] = [];
  let isPlatformAdmin = false;
  let signedInUserName = session?.user?.name ?? null;
  let signedInUserEmail = session?.user?.email ?? null;

  if (isSignedIn) {
    isPlatformAdmin = await isCurrentUserPlatformAdmin();

    try {
      const { user, company, workspace } = await resolveUserAndWorkspace();
      signedInUserName = user.name;
      signedInUserEmail = user.email;
      selectedCompanyLabel = `${company.name} (#${company.id})`;
      selectedCompanyId = company.id;
      selectableCompanies = (await listActiveCompaniesForUser(user.id)).map(
        (row) => ({
          id: row.company.id,
          name: row.company.name,
          role: row.membership.role,
        }),
      );
      selectableProjects = (
        await listActiveProjectsForWorkspace(workspace.id)
      ).map((item) => ({
        id: item.id,
        name: item.name,
      }));
      const activeProjectId = await getActiveProjectIdCookie();
      const cookieProject =
        activeProjectId !== null
          ? await getProjectForWorkspaceById(activeProjectId, workspace.id)
          : null;
      const selectedProject =
        cookieProject ?? (await getFirstProjectForWorkspace(workspace.id));

      if (selectedProject) {
        selectedProjectLabel = `${selectedProject.name} (#${selectedProject.id})`;
        selectedProjectId = selectedProject.id;
      }
    } catch {
      selectedProjectLabel = null;
      selectedProjectId = null;
      selectableProjects = [];
      selectedCompanyLabel = null;
      selectedCompanyId = null;
      selectableCompanies = [];
    }
  }

  return (
    <nav className="border-b border-[var(--foreground)]/10">
      <div className="flex container h-16 items-center justify-between px-4  mx-auto">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xl font-semibold">
            Lia AI
          </Link>
          {selectedCompanyLabel &&
            selectedCompanyId &&
            selectableCompanies.length > 1 && (
              <CompanySelectorModal
                selectedCompanyId={selectedCompanyId}
                selectedCompanyLabel={selectedCompanyLabel}
                companies={selectableCompanies}
              />
            )}
          {selectedProjectLabel &&
            selectedProjectId &&
            selectableProjects.length > 0 && (
              <ProjectSelectorModal
                selectedProjectId={selectedProjectId}
                selectedProjectLabel={selectedProjectLabel}
                projects={selectableProjects}
              />
            )}
        </div>

        <NavigationActions
          isPlatformAdmin={isPlatformAdmin}
          isSignedIn={isSignedIn}
          signedInUserEmail={signedInUserEmail}
          signedInUserName={signedInUserName}
        />
      </div>
    </nav>
  );
};
