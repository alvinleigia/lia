import {
  BarChart3,
  Bot,
  ChevronDown,
  ClipboardList,
  ContactRound,
  FileImage,
  FolderKanban,
  IdCard,
  LayoutTemplate,
  LogIn,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PlugZap,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Upload,
  UserCheck,
  UserCircle,
  UserPlus,
  Users,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { CompanySelectorModal } from "@/components/company-selector-modal";
import { ProjectSelectorModal } from "@/components/project-selector-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

        <div className="flex gap-2 items-center">
          {isSignedIn && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" type="button">
                    <FolderKanban className="h-4 w-4" />
                    Projects
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Project Workspace</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/projects">
                      <FolderKanban className="h-4 w-4 mr-2" />
                      All Projects
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/new">
                      <Plus className="h-4 w-4 mr-2" />
                      New Project
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/projects/chat">
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Chat
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/documents">
                      <Upload className="h-4 w-4 mr-2" />
                      Documents
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/media">
                      <FileImage className="h-4 w-4 mr-2" />
                      Media Library
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/catalog">
                      <ShoppingBag className="h-4 w-4 mr-2" />
                      Product Catalog
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/widget">
                      <WandSparkles className="h-4 w-4 mr-2" />
                      Widget
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/channels/whatsapp">
                      <Smartphone className="h-4 w-4 mr-2" />
                      WhatsApp
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/analytics">
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Analytics
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" type="button">
                    <Bot className="h-4 w-4" />
                    Automation
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Flows & Records</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/actions">
                      <Bot className="h-4 w-4 mr-2" />
                      Actions
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/actions/new">
                      <Plus className="h-4 w-4 mr-2" />
                      New Action
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/templates">
                      <LayoutTemplate className="h-4 w-4 mr-2" />
                      Templates
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/projects/operations">
                      <PlugZap className="h-4 w-4 mr-2" />
                      Operations
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/contacts">
                      <ContactRound className="h-4 w-4 mr-2" />
                      Contacts
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/submissions">
                      <ClipboardList className="h-4 w-4 mr-2" />
                      Submissions
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/projects/handoffs">
                      <UserCheck className="h-4 w-4 mr-2" />
                      Handoff Queue
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" type="button">
                    <MoreHorizontal className="h-4 w-4" />
                    Admin
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Account Admin</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/team">
                      <Users className="h-4 w-4 mr-2" />
                      Team
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/team/invite">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Invite Member
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/projects/audit">
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      Audit Logs
                    </Link>
                  </DropdownMenuItem>
                  {isPlatformAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Platform</DropdownMenuLabel>
                      <DropdownMenuItem asChild>
                        <Link href="/platform">
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          Tenants
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {isSignedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" type="button">
                  <UserCircle className="h-4 w-4" />
                  {signedInUserName ?? signedInUserEmail ?? "Account"}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <span className="block truncate">
                    {signedInUserName ?? "Signed in"}
                  </span>
                  {signedInUserEmail && (
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {signedInUserEmail}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserCircle className="h-4 w-4 mr-2" />
                    Manage Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/profile#demographics">
                    <IdCard className="h-4 w-4 mr-2" />
                    Demographic Info
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                >
                  <DropdownMenuItem asChild variant="destructive">
                    <button type="submit" className="w-full">
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign Out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/sign-in">
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Link>
              </Button>
              <Button asChild>
                <Link href="/sign-up">
                  <UserPlus className="h-4 w-4" />
                  Sign Up
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};
