export type HostedVoiceUatToolRef = {
  id: string;
  version: number;
};

export type HostedVoiceUatCall = {
  access: "read" | "write";
  committedAt: Date | null;
  outcome: string | null;
  providerConversationId: string | null;
  status: string;
  toolId: string;
  toolVersion: number;
};

export function evaluateHostedVoiceCandidateUat(input: {
  calls: HostedVoiceUatCall[];
  requiredTools: HostedVoiceUatToolRef[];
}) {
  const requiredTools = [
    ...new Map(
      input.requiredTools.map((tool) => [toolKey(tool.id, tool.version), tool]),
    ).values(),
  ];
  const verifiedKeys = new Set(
    input.calls.flatMap((call) => {
      const isRealCall =
        call.providerConversationId !== null &&
        !call.providerConversationId.startsWith("lia-no-call:");
      const completedSuccessfully =
        call.status === "completed" && call.outcome === "success";
      const completedWrite =
        call.access !== "write" || call.committedAt !== null;
      return isRealCall && completedSuccessfully && completedWrite
        ? [toolKey(call.toolId, call.toolVersion)]
        : [];
    }),
  );
  const missingTools = requiredTools.filter(
    (tool) => !verifiedKeys.has(toolKey(tool.id, tool.version)),
  );
  return {
    missingTools,
    passed: missingTools.length === 0,
    requiredToolCount: requiredTools.length,
    verifiedToolCount: requiredTools.length - missingTools.length,
  };
}

function toolKey(id: string, version: number) {
  return `${id}@${version}`;
}
