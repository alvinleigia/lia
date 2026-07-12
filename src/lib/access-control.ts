import type { SelectCompanyMembership } from "@/lib/db-schema";

export const PERMISSIONS = [
  "company.project.manage",
  "company.documents.manage",
  "company.widget.manage",
  "company.operations.manage",
  "company.members.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  COMPANY_OWNER: [...PERMISSIONS],
  COMPANY_MEMBER: PERMISSIONS.filter(
    (permission) =>
      permission !== "company.members.manage" && permission !== "audit.view",
  ),
};

export function canAccess(
  membership: Pick<SelectCompanyMembership, "role" | "status">,
  permission: Permission,
) {
  if (membership.status !== "active") {
    return false;
  }

  return ROLE_PERMISSIONS[membership.role]?.includes(permission) ?? false;
}

export function assertPermission(
  membership: Pick<SelectCompanyMembership, "role" | "status">,
  permission: Permission,
) {
  if (!canAccess(membership, permission)) {
    throw new Error("Forbidden");
  }
}
