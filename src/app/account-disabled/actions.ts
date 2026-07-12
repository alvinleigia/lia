"use server";

import { signOut } from "@/auth";

export async function signOutFromDisabledAccountAction() {
  await signOut({ redirectTo: "/" });
}
