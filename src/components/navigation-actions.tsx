"use client";

import {
  BarChart3,
  Bot,
  ChevronDown,
  ClipboardCheck,
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
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavigationActionsProps = {
  canManageMembers: boolean;
  canViewAudit: boolean;
  isPlatformAdmin: boolean;
  isSignedIn: boolean;
  signedInUserEmail: string | null;
  signedInUserName: string | null;
};

export function NavigationActions({
  canManageMembers,
  canViewAudit,
  isPlatformAdmin,
  isSignedIn,
  signedInUserEmail,
  signedInUserName,
}: NavigationActionsProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div className="flex gap-2 items-center" />;
  }

  return (
    <div className="flex gap-2 items-center">
      {isSignedIn && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={buttonVariants({ variant: "ghost" })}
                type="button"
              >
                <FolderKanban className="h-4 w-4" />
                Projects
              </button>
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
                <Link href="/projects/answer-tests">
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  Answer Tests
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
              <button
                className={buttonVariants({ variant: "ghost" })}
                type="button"
              >
                <Bot className="h-4 w-4" />
                Automation
              </button>
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

          {(canManageMembers || canViewAudit || isPlatformAdmin) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={buttonVariants({ variant: "ghost" })}
                  type="button"
                >
                  <MoreHorizontal className="h-4 w-4" />
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
                      </>
                    )}
                    {canViewAudit && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href="/projects/audit">
                            <ShieldCheck className="h-4 w-4 mr-2" />
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
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        Tenants
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}

      {isSignedIn ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={buttonVariants({
                variant: "outline",
                className:
                  "bg-white text-slate-950 hover:bg-slate-50 hover:text-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-50 dark:hover:text-slate-950",
              })}
              type="button"
            >
              <UserCircle className="h-4 w-4" />
              {signedInUserName ?? signedInUserEmail ?? "Account"}
              <ChevronDown className="h-4 w-4" />
            </button>
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
            <DropdownMenuItem asChild variant="destructive">
              <button
                className="w-full"
                type="button"
                onClick={() => signOut({ redirectTo: "/" })}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </button>
            </DropdownMenuItem>
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
  );
}
