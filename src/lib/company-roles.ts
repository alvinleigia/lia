export const COMPANY_ROLES = ["COMPANY_OWNER", "COMPANY_MEMBER"] as const;
export const COMPANY_MEMBERSHIP_STATUSES = ["active", "disabled"] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];
export type CompanyMembershipStatus =
  (typeof COMPANY_MEMBERSHIP_STATUSES)[number];

export function formatCompanyRole(role: string) {
  return role.replaceAll("_", " ");
}
