import { compare } from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { createUser, getUserByEmail } from "@/lib/users";
import { getOrCreateDefaultWorkspaceForUser } from "@/lib/workspaces";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    Credentials({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(8),
          })
          .safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const user = await getUserByEmail(parsed.data.email);
        if (!user) {
          return null;
        }
        if (!user.passwordHash.startsWith("$2")) {
          return null;
        }

        const isValidPassword = await compare(
          parsed.data.password,
          user.passwordHash,
        );

        if (!isValidPassword) {
          return null;
        }

        return {
          id: String(user.id),
          email: user.email,
          name: user.name ?? undefined,
        };
      },
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    signIn: async ({ account, user }) => {
      if (account?.provider !== "google") {
        return true;
      }

      const email = user.email;
      if (!email) {
        return false;
      }

      const existingUser = await getUserByEmail(email);
      const appUser =
        existingUser ??
        (await createUser({
          email,
          name: user.name ?? undefined,
          passwordHash: "oauth:google",
        }));

      await getOrCreateDefaultWorkspaceForUser(appUser);

      return true;
    },
  },
});
