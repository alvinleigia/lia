import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  conversationDiagnosticFindings,
  conversationRegressionCases,
  users,
} from "@/lib/db-schema";

export async function listConversationDiagnosticFindings(
  projectId: number,
  conversationId: number,
) {
  return db
    .select({
      finding: conversationDiagnosticFindings,
      author: {
        name: users.name,
        email: users.email,
      },
      regressionCase: conversationRegressionCases,
    })
    .from(conversationDiagnosticFindings)
    .innerJoin(users, eq(users.id, conversationDiagnosticFindings.authorUserId))
    .leftJoin(
      conversationRegressionCases,
      eq(
        conversationRegressionCases.sourceFindingId,
        conversationDiagnosticFindings.id,
      ),
    )
    .where(
      and(
        eq(conversationDiagnosticFindings.projectId, projectId),
        eq(conversationDiagnosticFindings.conversationId, conversationId),
      ),
    )
    .orderBy(desc(conversationDiagnosticFindings.createdAt));
}

export async function createConversationDiagnosticFinding(input: {
  authorUserId: number;
  category: string;
  conversationId: number;
  note: string;
  projectId: number;
}) {
  const [conversation] = await db
    .select({ id: channelConversations.id })
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.id, input.conversationId),
        eq(channelConversations.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!conversation) {
    throw new Error(
      "The selected conversation does not belong to this project.",
    );
  }

  const [finding] = await db
    .insert(conversationDiagnosticFindings)
    .values(input)
    .returning();

  if (!finding) throw new Error("The tester finding could not be recorded.");
  return finding;
}

export async function createConversationRegressionCase(input: {
  conversationId: number;
  createdByUserId: number;
  expectedBehavior: string;
  findingId: number;
  projectId: number;
  syntheticInput: string;
  title: string;
}) {
  const finding = await db
    .select({ id: conversationDiagnosticFindings.id })
    .from(conversationDiagnosticFindings)
    .where(
      and(
        eq(conversationDiagnosticFindings.id, input.findingId),
        eq(conversationDiagnosticFindings.projectId, input.projectId),
        eq(conversationDiagnosticFindings.conversationId, input.conversationId),
      ),
    )
    .limit(1);

  if (!finding[0]) {
    throw new Error(
      "The selected finding does not belong to this conversation.",
    );
  }

  const [existing] = await db
    .select({ id: conversationRegressionCases.id })
    .from(conversationRegressionCases)
    .where(eq(conversationRegressionCases.sourceFindingId, input.findingId))
    .limit(1);

  if (existing) throw new Error("This finding is already a regression case.");

  const [regressionCase] = await db
    .insert(conversationRegressionCases)
    .values({
      projectId: input.projectId,
      sourceFindingId: input.findingId,
      createdByUserId: input.createdByUserId,
      title: input.title,
      syntheticInput: input.syntheticInput,
      expectedBehavior: input.expectedBehavior,
    })
    .returning();

  if (!regressionCase)
    throw new Error("The regression case could not be created.");
  return regressionCase;
}
