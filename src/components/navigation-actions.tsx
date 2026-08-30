"use client";

import {
  BarChart3,
  Bot,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ContactRound,
  FileImage,
  FolderKanban,
  IdCard,
  LayoutTemplate,
  ListTodo,
  LogIn,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PhoneCall,
  PlugZap,
  Plus,
  ScanSearch,
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
import { signOut } from "next-auth/react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type NavigationActionsProps = {
  canManageMembers: boolean;
  canViewAudit: boolean;
  isPlatformAdmin: boolean;
  isSignedIn: boolean;
  mobileSelectors?: ReactNode;
  signedInUserEmail: string | null;
  signedInUserImage: string | null;
  signedInUserName: string | null;
};

type NavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

const projectNavigationGroups: NavigationItem[][] = [
  [
    { href: "/projects", icon: FolderKanban, label: "All Projects" },
    { href: "/projects/new", icon: Plus, label: "New Project" },
  ],
  [
    { href: "/projects/chat", icon: MessageSquare, label: "Chat" },
    { href: "/projects/documents", icon: Upload, label: "Documents" },
    { href: "/projects/media", icon: FileImage, label: "Media Library" },
    {
      href: "/projects/catalog",
      icon: ShoppingBag,
      label: "Product Catalog",
    },
    { href: "/projects/widget", icon: WandSparkles, label: "Widget" },
    {
      href: "/projects/channels/whatsapp",
      icon: Smartphone,
      label: "WhatsApp",
    },
    {
      href: "/projects/channels/telnyx",
      icon: PhoneCall,
      label: "Telnyx Voice",
    },
    {
      href: "/projects/answer-tests",
      icon: ClipboardCheck,
      label: "Answer Tests",
    },
    { href: "/projects/analytics", icon: BarChart3, label: "Analytics" },
    { href: "/projects/operations", icon: PlugZap, label: "Operations" },
  ],
];

const automationNavigationGroups: NavigationItem[][] = [
  [
    { href: "/projects/tasks", icon: ListTodo, label: "Tasks" },
    { href: "/projects/actions", icon: Bot, label: "Actions" },
    { href: "/projects/actions/new", icon: Plus, label: "New Action" },
    {
      href: "/projects/templates",
      icon: LayoutTemplate,
      label: "Templates",
    },
  ],
  [
    { href: "/projects/contacts", icon: ContactRound, label: "Contacts" },
    {
      href: "/projects/diagnostics",
      icon: ScanSearch,
      label: "Conversation Diagnostics",
    },
    {
      href: "/projects/submissions",
      icon: ClipboardList,
      label: "Submissions",
    },
    { href: "/projects/handoffs", icon: UserCheck, label: "Handoff Queue" },
  ],
];

function DropdownNavigationItems({ groups }: { groups: NavigationItem[][] }) {
  return groups.map((group, groupIndex) => (
    <Fragment key={group[0]?.href ?? groupIndex}>
      {groupIndex > 0 && <DropdownMenuSeparator />}
      {group.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem asChild key={item.href}>
            <Link href={item.href}>
              <Icon className="mr-2 size-4" />
              {item.label}
            </Link>
          </DropdownMenuItem>
        );
      })}
    </Fragment>
  ));
}

function MobileNavigationLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;

  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        className="hover:bg-accent flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
      >
        <Icon className="size-4 shrink-0" />
        {item.label}
      </Link>
    </SheetClose>
  );
}

function MobileNavigationSection({
  groups,
  title,
}: {
  groups: NavigationItem[][];
  title: string;
}) {
  return (
    <section className="space-y-1">
      <h2 className="text-muted-foreground px-3 text-xs font-semibold uppercase tracking-wide">
        {title}
      </h2>
      {groups.flat().map((item) => (
        <MobileNavigationLink item={item} key={item.href} />
      ))}
    </section>
  );
}

function MobileNavigation({
  canManageMembers,
  canViewAudit,
  isPlatformAdmin,
  selectors,
}: {
  canManageMembers: boolean;
  canViewAudit: boolean;
  isPlatformAdmin: boolean;
  selectors?: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          aria-label="Open navigation menu"
          size="icon"
          type="button"
          variant="outline"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        className="w-[min(20rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-0"
        side="left"
      >
        <SheetHeader className="border-b pr-12 text-left">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>
            Switch projects and open a workspace area.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 py-5">
          {selectors && (
            <section className="space-y-2">
              <h2 className="text-muted-foreground px-1 text-xs font-semibold uppercase tracking-wide">
                Current workspace
              </h2>
              <div className="space-y-2">{selectors}</div>
            </section>
          )}

          <MobileNavigationSection
            groups={projectNavigationGroups}
            title="Projects"
          />
          <MobileNavigationSection
            groups={automationNavigationGroups}
            title="Automation"
          />

          {(canManageMembers || canViewAudit || isPlatformAdmin) && (
            <section className="space-y-1">
              <h2 className="text-muted-foreground px-3 text-xs font-semibold uppercase tracking-wide">
                Admin
              </h2>
              {canManageMembers && (
                <>
                  <MobileNavigationLink
                    item={{
                      href: "/company/settings",
                      icon: Clock3,
                      label: "Company Settings",
                    }}
                  />
                  <MobileNavigationLink
                    item={{ href: "/team", icon: Users, label: "Team" }}
                  />
                  <MobileNavigationLink
                    item={{
                      href: "/team/invite",
                      icon: UserPlus,
                      label: "Invite Member",
                    }}
                  />
                </>
              )}
              {canViewAudit && (
                <MobileNavigationLink
                  item={{
                    href: "/projects/audit",
                    icon: ShieldCheck,
                    label: "Audit Logs",
                  }}
                />
              )}
              {isPlatformAdmin && (
                <MobileNavigationLink
                  item={{
                    href: "/platform",
                    icon: ShieldCheck,
                    label: "Tenants",
                  }}
                />
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function getAccountInitials(name: string | null, email: string | null) {
  const nameParts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (nameParts.length > 0) {
    return nameParts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return email?.trim().charAt(0).toUpperCase() || "A";
}

export function NavigationActions({
  canManageMembers,
  canViewAudit,
  isPlatformAdmin,
  isSignedIn,
  mobileSelectors,
  signedInUserEmail,
  signedInUserImage,
  signedInUserName,
}: NavigationActionsProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div className="flex items-center gap-2" />;
  }

  return (
    <div className="flex items-center gap-2">
      {isSignedIn && (
        <>
          <div className="lg:hidden">
            <MobileNavigation
              canManageMembers={canManageMembers}
              canViewAudit={canViewAudit}
              isPlatformAdmin={isPlatformAdmin}
              selectors={mobileSelectors}
            />
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={buttonVariants({ variant: "ghost" })}
                  type="button"
                >
                  <FolderKanban className="size-4" />
                  Projects
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Project Workspace</DropdownMenuLabel>
                <DropdownNavigationItems groups={projectNavigationGroups} />
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={buttonVariants({ variant: "ghost" })}
                  type="button"
                >
                  <Bot className="size-4" />
                  Automation
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Flows & Records</DropdownMenuLabel>
                <DropdownNavigationItems groups={automationNavigationGroups} />
              </DropdownMenuContent>
            </DropdownMenu>

            {(canManageMembers || canViewAudit || isPlatformAdmin) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={buttonVariants({ variant: "ghost" })}
                    type="button"
                  >
                    <MoreHorizontal className="size-4" />
                    Admin
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {(canManageMembers || canViewAudit) && (
                    <>
                      <DropdownMenuLabel>Account Admin</DropdownMenuLabel>
                      {canManageMembers && (
                        <>
                          <DropdownMenuItem asChild>
                            <Link href="/company/settings">
                              <Clock3 className="mr-2 size-4" />
                              Company Settings
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href="/team">
                              <Users className="mr-2 size-4" />
                              Team
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href="/team/invite">
                              <UserPlus className="mr-2 size-4" />
                              Invite Member
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                      {canViewAudit && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href="/projects/audit">
                              <ShieldCheck className="mr-2 size-4" />
                              Audit Logs
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                    </>
                  )}
                  {isPlatformAdmin && (
                    <>
                      {(canManageMembers || canViewAudit) && (
                        <DropdownMenuSeparator />
                      )}
                      <DropdownMenuLabel>Platform</DropdownMenuLabel>
                      <DropdownMenuItem asChild>
                        <Link href="/platform">
                          <ShieldCheck className="mr-2 size-4" />
                          Tenants
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </>
      )}

      {isSignedIn ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Open account menu for ${signedInUserName ?? signedInUserEmail ?? "account"}`}
              className={buttonVariants({
                variant: "outline",
                size: "icon",
                className:
                  "rounded-full bg-white text-slate-950 hover:bg-slate-50 hover:text-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-50 dark:hover:text-slate-950",
              })}
              title={signedInUserName ?? signedInUserEmail ?? "Account"}
              type="button"
            >
              <Avatar className="size-7">
                {signedInUserImage && (
                  <AvatarImage
                    alt=""
                    referrerPolicy="no-referrer"
                    src={signedInUserImage}
                  />
                )}
                <AvatarFallback className="bg-slate-900 text-xs font-semibold text-white">
                  {getAccountInitials(signedInUserName, signedInUserEmail)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <span className="block truncate">
                {signedInUserName ?? "Signed in"}
              </span>
              {signedInUserEmail && (
                <span className="text-muted-foreground block truncate text-xs font-normal">
                  {signedInUserEmail}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <UserCircle className="mr-2 size-4" />
                Manage Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile#demographics">
                <IdCard className="mr-2 size-4" />
                Demographic Info
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild variant="destructive">
              <button
                className="w-full"
                type="button"
                onClick={() => signOut({ redirectTo: "/" })}
              >
                <LogOut className="mr-2 size-4" />
                Sign Out
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button asChild variant="ghost">
            <Link href="/sign-in">
              <LogIn className="size-4" />
              Sign In
            </Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">
              <UserPlus className="size-4" />
              Sign Up
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
