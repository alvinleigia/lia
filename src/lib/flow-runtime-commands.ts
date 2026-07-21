import { and, eq } from "drizzle-orm";
import type { BrowserFlowRuntimeResult } from "@/lib/browser-flow-contract";
import { db } from "@/lib/db-config";
import { flowRuntimeCommands } from "@/lib/db-schema";

type ClaimFlowRuntimeCommandInput = {
  commandId: string;
  conversationId: string;
  projectId: number;
  requestHash: string;
  source: string;
};

export type FlowRuntimeCommandClaim =
  | { commandId: number; state: "claimed" }
  | { result: BrowserFlowRuntimeResult; state: "replay" }
  | { state: "conflict" | "failed" | "processing" };

function commandScope(input: ClaimFlowRuntimeCommandInput) {
  return and(
    eq(flowRuntimeCommands.projectId, input.projectId),
    eq(flowRuntimeCommands.source, input.source),
    eq(flowRuntimeCommands.conversationId, input.conversationId),
    eq(flowRuntimeCommands.commandId, input.commandId),
  );
}

export async function claimFlowRuntimeCommand(
  input: ClaimFlowRuntimeCommandInput,
): Promise<FlowRuntimeCommandClaim> {
  const [created] = await db
    .insert(flowRuntimeCommands)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: flowRuntimeCommands.id });

  if (created) {
    return { commandId: created.id, state: "claimed" };
  }

  const [existing] = await db
    .select()
    .from(flowRuntimeCommands)
    .where(commandScope(input))
    .limit(1);

  if (!existing || existing.requestHash !== input.requestHash) {
    return { state: "conflict" };
  }

  if (existing.status === "completed" && existing.response) {
    return {
      result: existing.response as BrowserFlowRuntimeResult,
      state: "replay",
    };
  }

  if (existing.status === "failed") {
    return { state: "failed" };
  }

  return { state: "processing" };
}

export async function completeFlowRuntimeCommand(input: {
  commandId: number;
  projectId: number;
  result: BrowserFlowRuntimeResult;
}) {
  await db
    .update(flowRuntimeCommands)
    .set({
      completedAt: new Date(),
      response: input.result,
      status: "completed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(flowRuntimeCommands.id, input.commandId),
        eq(flowRuntimeCommands.projectId, input.projectId),
      ),
    );
}

export async function failFlowRuntimeCommand(input: {
  commandId: number;
  errorMessage: string;
  projectId: number;
}) {
  await db
    .update(flowRuntimeCommands)
    .set({
      completedAt: new Date(),
      errorMessage: input.errorMessage,
      status: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(flowRuntimeCommands.id, input.commandId),
        eq(flowRuntimeCommands.projectId, input.projectId),
      ),
    );
}
