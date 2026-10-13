import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/lib/db-config";
import {
  companies,
  projectChannels,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { isEncryptedSecretEnvelope } from "../../src/lib/encrypted-secrets";
import {
  getProjectWhatsAppChannel,
  normalizeWhatsAppConfig,
  upsertProjectWhatsAppChannel,
} from "../../src/lib/whatsapp";

test("phone claims are serialized across tenants and reconnect preserves encrypted credentials", async () => {
  test.setTimeout(60_000);
  const suffix = randomUUID();
  let userId: number | undefined;
  const companyIds: number[] = [];
  const workspaceIds: number[] = [];
  const projectIds: number[] = [];
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `wa-signup-${suffix}@example.test`,
        name: "WhatsApp Signup UAT",
        passwordHash: "test-only",
      })
      .returning();
    userId = user.id;
    for (const label of ["A", "B"]) {
      const [company] = await db
        .insert(companies)
        .values({ name: `WA Signup ${label} ${suffix}`, ownerUserId: user.id })
        .returning();
      companyIds.push(company.id);
      const [workspace] = await db
        .insert(workspaces)
        .values({
          name: "WhatsApp Signup UAT",
          ownerUserId: user.id,
          companyId: company.id,
        })
        .returning();
      workspaceIds.push(workspace.id);
      const [project] = await db
        .insert(projects)
        .values({
          name: `WA Signup ${label}`,
          ownerUserId: user.id,
          workspaceId: workspace.id,
        })
        .returning();
      projectIds.push(project.id);
    }
    const phoneNumberId = `test-${suffix}`;
    const config = {
      phoneNumberId,
      businessAccountId: "test-business",
      accessToken: "test-access-token",
      appSecret: "test-app-secret",
      verifyToken: "test-verify-token",
      apiVersion: "v24.0",
    };
    const claims = await Promise.allSettled(
      projectIds.map((projectId) =>
        upsertProjectWhatsAppChannel({
          projectId,
          name: "Test WhatsApp",
          status: "disabled",
          config,
        }),
      ),
    );
    expect(claims.filter((entry) => entry.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(claims.filter((entry) => entry.status === "rejected")).toHaveLength(
      1,
    );
    const winnerIndex = claims.findIndex(
      (entry) => entry.status === "fulfilled",
    );
    const winner = projectIds[winnerIndex];
    const loser = projectIds[1 - winnerIndex];
    expect(await getProjectWhatsAppChannel(loser)).toBeNull();
    const channel = await getProjectWhatsAppChannel(winner);
    expect(channel).not.toBeNull();
    expect(isEncryptedSecretEnvelope(channel?.config.accessToken)).toBe(true);
    expect(isEncryptedSecretEnvelope(channel?.config.appSecret)).toBe(true);
    expect(JSON.stringify(channel?.config)).not.toContain("test-access-token");
    await upsertProjectWhatsAppChannel({
      projectId: winner,
      name: "Test Reconnect",
      status: "disabled",
      preserveExistingNumber: true,
      config: { phoneNumberId, businessAccountId: "test-business" },
    });
    const updated = await getProjectWhatsAppChannel(winner);
    expect(updated?.id).toBe(channel?.id);
    expect(normalizeWhatsAppConfig(updated?.config).accessToken).toBe(
      "test-access-token",
    );
    expect(normalizeWhatsAppConfig(updated?.config).apiVersion).toBe("v24.0");
    await expect(
      upsertProjectWhatsAppChannel({
        projectId: winner,
        name: "Wrong Number",
        status: "disabled",
        preserveExistingNumber: true,
        config: { ...config, phoneNumberId: `other-${suffix}` },
      }),
    ).rejects.toThrow("different WhatsApp number");
    expect((await getProjectWhatsAppChannel(winner))?.externalId).toBe(
      phoneNumberId,
    );
  } finally {
    if (projectIds.length) {
      await db
        .delete(projectChannels)
        .where(inArray(projectChannels.projectId, projectIds));
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
    if (workspaceIds.length)
      await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (companyIds.length)
      await db.delete(companies).where(inArray(companies.id, companyIds));
    if (userId) await db.delete(users).where(eq(users.id, userId));
  }
});
