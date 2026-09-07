import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db-config";
import { googleCalendarAppointments } from "@/lib/db-schema";
import type {
  GoogleCalendarAppointment,
  GoogleCalendarAppointmentStore,
} from "@/lib/google-calendar";

export const googleCalendarAppointmentStore = {
  async withLocks(keys, work) {
    const ordered = [...new Set(keys)].sort();
    return db.transaction(async (tx) => {
      for (const key of ordered) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
      }
      return work();
    });
  },

  async findByOperationKey({ operationKeyHash, projectId, providerId }) {
    const [row] = await db
      .select()
      .from(googleCalendarAppointments)
      .where(
        and(
          eq(googleCalendarAppointments.projectId, projectId),
          eq(googleCalendarAppointments.providerId, providerId),
          eq(googleCalendarAppointments.operationKeyHash, operationKeyHash),
        ),
      )
      .limit(1);
    return row ? mapAppointment(row) : null;
  },

  async findByReference({
    identityHash,
    lookupIdentityHash,
    lookupIdentityKey,
    projectId,
    providerId,
    reference,
  }) {
    const [row] = await db
      .select()
      .from(googleCalendarAppointments)
      .where(
        and(
          eq(googleCalendarAppointments.projectId, projectId),
          eq(googleCalendarAppointments.providerId, providerId),
          eq(googleCalendarAppointments.reference, reference),
          or(
            and(
              eq(
                googleCalendarAppointments.lookupIdentityKey,
                lookupIdentityKey,
              ),
              eq(
                googleCalendarAppointments.lookupIdentityHash,
                lookupIdentityHash,
              ),
            ),
            and(
              isNull(googleCalendarAppointments.lookupIdentityHash),
              eq(googleCalendarAppointments.identityHash, identityHash),
            ),
          ),
        ),
      )
      .limit(1);
    return row ? mapAppointment(row) : null;
  },

  async listByIdentity({
    identityHash,
    lookupIdentityHash,
    lookupIdentityKey,
    limit,
    maxStart,
    minEnd,
    projectId,
    providerId,
  }) {
    const rows = await db
      .select()
      .from(googleCalendarAppointments)
      .where(
        and(
          eq(googleCalendarAppointments.projectId, projectId),
          eq(googleCalendarAppointments.providerId, providerId),
          or(
            and(
              eq(
                googleCalendarAppointments.lookupIdentityKey,
                lookupIdentityKey,
              ),
              eq(
                googleCalendarAppointments.lookupIdentityHash,
                lookupIdentityHash,
              ),
            ),
            and(
              isNull(googleCalendarAppointments.lookupIdentityHash),
              eq(googleCalendarAppointments.identityHash, identityHash),
            ),
          ),
          eq(googleCalendarAppointments.status, "active"),
          gte(googleCalendarAppointments.endAt, minEnd),
          lte(googleCalendarAppointments.startAt, maxStart),
        ),
      )
      .orderBy(googleCalendarAppointments.startAt)
      .limit(limit);
    return rows.map(mapAppointment);
  },

  async save(input) {
    const [created] = await db
      .insert(googleCalendarAppointments)
      .values(input)
      .onConflictDoNothing()
      .returning();
    if (created) return mapAppointment(created);
    const existing = await this.findByOperationKey({
      operationKeyHash: input.operationKeyHash,
      projectId: input.projectId,
      providerId: input.providerId,
    });
    if (!existing) throw new Error("Google Calendar appointment changed.");
    return existing;
  },

  async update(input) {
    const [updated] = await db
      .update(googleCalendarAppointments)
      .set({
        ...(input.endAt ? { endAt: input.endAt } : {}),
        ...(input.lookupIdentityHash
          ? { lookupIdentityHash: input.lookupIdentityHash }
          : {}),
        ...(input.lookupIdentityKey
          ? { lookupIdentityKey: input.lookupIdentityKey }
          : {}),
        ...(input.remoteEtag ? { remoteEtag: input.remoteEtag } : {}),
        ...(input.startAt ? { startAt: input.startAt } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.verificationIdentityHash
          ? { verificationIdentityHash: input.verificationIdentityHash }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(googleCalendarAppointments.id, input.id),
          eq(googleCalendarAppointments.projectId, input.projectId),
          eq(googleCalendarAppointments.providerId, input.providerId),
        ),
      )
      .returning();
    if (!updated) throw new Error("Google Calendar appointment was not found.");
    return mapAppointment(updated);
  },
} satisfies GoogleCalendarAppointmentStore;

function mapAppointment(
  row: typeof googleCalendarAppointments.$inferSelect,
): GoogleCalendarAppointment {
  return {
    endAt: row.endAt,
    id: row.id,
    identityHash: row.identityHash,
    lookupIdentityHash: row.lookupIdentityHash,
    lookupIdentityKey: row.lookupIdentityKey,
    operationKeyHash: row.operationKeyHash,
    projectId: row.projectId,
    providerId: row.providerId,
    reference: row.reference,
    remoteEtag: row.remoteEtag,
    remoteEventId: row.remoteEventId,
    startAt: row.startAt,
    status: z
      .enum(["active", "cancelled", "outcome_unknown"])
      .parse(row.status),
    verificationIdentityHash: row.verificationIdentityHash,
  };
}
