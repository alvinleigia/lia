import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { CompanyRole } from "@/lib/companies";
import { db } from "@/lib/db-config";
import {
  companies,
  companyInvitations,
  companyMemberships,
  users,
} from "@/lib/db-schema";
import { sendEmail } from "@/lib/email";

export const COMPANY_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "cancelled",
  "expired",
] as const;
export type CompanyInvitationStatus =
  (typeof COMPANY_INVITATION_STATUSES)[number];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateInviteToken() {
  return `invite_${crypto.randomBytes(32).toString("base64url")}`;
}

function getDefaultInviteExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt;
}

export function buildInviteAcceptUrl(token: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    "http://localhost:3000";

  return `${baseUrl}/invite/accept?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendCompanyInvitationEmail(input: {
  acceptUrl: string;
  companyName: string;
  email: string;
  invitedByName?: string | null;
}) {
  const senderName = input.invitedByName?.trim() || "A team member";
  const companyName = input.companyName.trim() || "Lia AI";

  await sendEmail({
    to: input.email,
    subject: `You're invited to ${companyName}`,
    textBody: [
      `${senderName} invited you to join ${companyName} on Lia AI.`,
      "",
      `Accept your invitation here: ${input.acceptUrl}`,
      "",
      "This link expires in 7 days. If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
    htmlBody: `
      <p>${escapeHtml(senderName)} invited you to join ${escapeHtml(companyName)} on Lia AI.</p>
      <p><a href="${escapeHtml(input.acceptUrl)}">Accept invitation</a></p>
      <p>This link expires in 7 days. If you were not expecting this invitation, you can ignore this email.</p>
    `,
  });
}

export async function createCompanyInvitation(input: {
  companyId: number;
  invitedByUserId: number;
  email: string;
  role?: CompanyRole;
}) {
  const token = generateInviteToken();
  const tokenHash = sha256Hex(token);
  const email = normalizeEmail(input.email);

  const [invitation] = await db
    .insert(companyInvitations)
    .values({
      companyId: input.companyId,
      invitedByUserId: input.invitedByUserId,
      email,
      role: input.role ?? "COMPANY_OWNER",
      status: "pending",
      tokenHash,
      expiresAt: getDefaultInviteExpiry(),
      updatedAt: new Date(),
    })
    .returning();

  return { invitation, token, acceptUrl: buildInviteAcceptUrl(token) };
}

export async function listCompanyInvitations(companyId: number) {
  return db
    .select({
      invitation: companyInvitations,
      invitedBy: {
        email: users.email,
        name: users.name,
      },
    })
    .from(companyInvitations)
    .leftJoin(users, eq(users.id, companyInvitations.invitedByUserId))
    .where(eq(companyInvitations.companyId, companyId))
    .orderBy(asc(companyInvitations.createdAt), asc(companyInvitations.id));
}

export async function listCompanyMembers(companyId: number) {
  return db
    .select({
      membership: companyMemberships,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
      },
    })
    .from(companyMemberships)
    .innerJoin(users, eq(users.id, companyMemberships.userId))
    .where(eq(companyMemberships.companyId, companyId))
    .orderBy(asc(companyMemberships.createdAt), asc(companyMemberships.id));
}

export async function updateCompanyMembershipStatus(input: {
  companyId: number;
  membershipId: number;
  status: "active" | "disabled";
}) {
  const [membership] = await db
    .update(companyMemberships)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(companyMemberships.companyId, input.companyId),
        eq(companyMemberships.id, input.membershipId),
      ),
    )
    .returning();

  return membership ?? null;
}

export async function cancelCompanyInvitation(input: {
  companyId: number;
  invitationId: number;
}) {
  const [invitation] = await db
    .update(companyInvitations)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(companyInvitations.companyId, input.companyId),
        eq(companyInvitations.id, input.invitationId),
        eq(companyInvitations.status, "pending"),
      ),
    )
    .returning();

  return invitation ?? null;
}

export async function getCompanyInvitationByToken(token: string) {
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({
      invitation: companyInvitations,
      company: companies,
    })
    .from(companyInvitations)
    .innerJoin(companies, eq(companies.id, companyInvitations.companyId))
    .where(eq(companyInvitations.tokenHash, tokenHash))
    .limit(1);

  return row ?? null;
}

export async function acceptCompanyInvitation(input: {
  token: string;
  user: { id: number; email: string };
}) {
  const inviteContext = await getCompanyInvitationByToken(input.token);
  if (!inviteContext) {
    throw new Error("Invitation not found.");
  }

  const { invitation, company } = inviteContext;
  const now = new Date();

  if (company.status !== "active") {
    throw new Error("This account is not active.");
  }

  if (invitation.status !== "pending") {
    throw new Error("This invitation is no longer pending.");
  }

  if (invitation.expiresAt <= now) {
    await db
      .update(companyInvitations)
      .set({ status: "expired", updatedAt: now })
      .where(eq(companyInvitations.id, invitation.id));
    throw new Error("This invitation has expired.");
  }

  if (normalizeEmail(input.user.email) !== invitation.email) {
    throw new Error("This invitation is for a different email address.");
  }

  return db.transaction(async (tx) => {
    const [membership] = await tx
      .insert(companyMemberships)
      .values({
        companyId: invitation.companyId,
        userId: input.user.id,
        role: invitation.role,
        status: "active",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [companyMemberships.companyId, companyMemberships.userId],
        set: {
          role: invitation.role,
          status: "active",
          updatedAt: now,
        },
      })
      .returning();

    const [acceptedInvitation] = await tx
      .update(companyInvitations)
      .set({
        status: "accepted",
        acceptedByUserId: input.user.id,
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(companyInvitations.id, invitation.id))
      .returning();

    return { invitation: acceptedInvitation, membership, company };
  });
}
