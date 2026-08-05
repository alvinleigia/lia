import Link from "next/link";
import { auth } from "@/auth";
import { CompanySelectorModal } from "@/components/company-selector-modal";
import { NavigationActions } from "@/components/navigation-actions";
import { ProjectSelectorModal } from "@/components/project-selector-modal";
import { canAccess } from "@/lib/access-control";
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
  let canManageMembers = false;
  let canViewAudit = false;
  let signedInUserName = session?.user?.name ?? null;
  let signedInUserEmail = session?.user?.email ?? null;
  const signedInUserImage = session?.user?.image ?? null;

  if (isSignedIn) {
    isPlatformAdmin = await isCurrentUserPlatformAdmin();

    try {
      const {
        user,
        company,
        membership: companyMembership,
        workspace,
      } = await resolveUserAndWorkspace();
      canManageMembers = canAccess(companyMembership, "company.members.manage");
      canViewAudit = canAccess(companyMembership, "audit.view");
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
      <div className="container mx-auto flex h-16 min-w-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="shrink-0 text-xl font-semibold">
            Lia AI
          </Link>
          <div className="hidden min-w-0 items-center gap-3 lg:flex">
            {selectedCompanyLabel &&
              selectedCompanyId &&
              selectableCompanies.length > 1 && (
                <CompanySelectorModal
                  selectedCompanyId={selectedCompanyId}
                  selectedCompanyLabel={selectedCompanyLabel}
                  companies={selectableCompanies}
                  triggerClassName="max-w-64 truncate"
                />
              )}
            {selectedProjectLabel &&
              selectedProjectId &&
              selectableProjects.length > 0 && (
                <ProjectSelectorModal
                  selectedProjectId={selectedProjectId}
                  selectedProjectLabel={selectedProjectLabel}
                  projects={selectableProjects}
                  triggerClassName="max-w-64 truncate"
                />
              )}
          </div>
        </div>

        <NavigationActions
          canManageMembers={canManageMembers}
          canViewAudit={canViewAudit}
          isPlatformAdmin={isPlatformAdmin}
          isSignedIn={isSignedIn}
          mobileSelectors={
            <>
              {selectedCompanyLabel &&
                selectedCompanyId &&
                selectableCompanies.length > 1 && (
                  <CompanySelectorModal
                    selectedCompanyId={selectedCompanyId}
                    selectedCompanyLabel={selectedCompanyLabel}
                    companies={selectableCompanies}
                    triggerClassName="w-full justify-start whitespace-normal text-left"
                  />
                )}
              {selectedProjectLabel &&
                selectedProjectId &&
                selectableProjects.length > 0 && (
                  <ProjectSelectorModal
                    selectedProjectId={selectedProjectId}
                    selectedProjectLabel={selectedProjectLabel}
                    projects={selectableProjects}
                    triggerClassName="w-full justify-start whitespace-normal text-left"
                  />
                )}
            </>
          }
          signedInUserEmail={signedInUserEmail}
          signedInUserImage={signedInUserImage}
          signedInUserName={signedInUserName}
        />
      </div>
    </nav>
  );
};
