import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  getFirstActiveCompanyForUser,
  getFirstCompanyForUser,
} from "@/lib/companies";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getUserByEmail } from "@/lib/users";

export default async function PostLoginPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (await isCurrentUserPlatformAdmin()) {
    redirect("/platform");
  }

  const user = await getUserByEmail(session.user.email);
  if (!user) {
    redirect("/sign-in");
  }

  const activeCompany = await getFirstActiveCompanyForUser(user.id);
  if (!activeCompany) {
    const existingCompany = await getFirstCompanyForUser(user.id);
    if (existingCompany) {
      redirect("/account-disabled");
    }
  }

  redirect("/projects");
}
