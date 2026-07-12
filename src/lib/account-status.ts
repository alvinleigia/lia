import {
  getFirstActiveCompanyForUser,
  getFirstCompanyForUser,
} from "@/lib/companies";

export const DISABLED_ACCOUNT_SIGN_IN_MESSAGE =
  "This account is currently disabled. Contact the platform administrator to restore access.";

export async function isUserBlockedFromSignIn(userId: number) {
  const activeCompany = await getFirstActiveCompanyForUser(userId);
  if (activeCompany) {
    return false;
  }

  const existingCompany = await getFirstCompanyForUser(userId);
  return Boolean(existingCompany);
}
