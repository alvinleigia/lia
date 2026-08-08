import { getContact, listContactAttributes } from "@/lib/contacts";
import type { ConversationProjectPolicyV1 } from "@/lib/conversation-contracts";
import type { TurnContextValueV1 } from "@/lib/conversation-turn-contracts";

export const MEMORY_CONSENT_ATTRIBUTE_KEY = "lia_memory_consent";

type MemoryPolicy = ConversationProjectPolicyV1["dataHandling"]["memory"];

type ContactMemoryAttribute = {
  key: string;
  updatedAt: Date;
  value: unknown;
};

function normalizeMemoryValue(
  value: unknown,
): TurnContextValueV1["value"] | null {
  if (typeof value === "string") {
    return value.length <= 2_000 ? value : value.slice(0, 2_000);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every((item) => typeof item === "string")
  ) {
    return value.map((item) => item.slice(0, 500));
  }

  return null;
}

function hasMemoryConsent(
  attributes: ContactMemoryAttribute[],
  policy: MemoryPolicy,
  projectConsentRequired: boolean,
) {
  if (policy.consentMode === "disabled") {
    return false;
  }
  if (
    policy.consentMode !== "required" &&
    !(policy.consentMode === "inherit" && projectConsentRequired)
  ) {
    return true;
  }

  return attributes.some(
    ({ key, value }) => key === MEMORY_CONSENT_ATTRIBUTE_KEY && value === true,
  );
}

export function selectSelectedContactMemoryFacts(input: {
  attributes: ContactMemoryAttribute[];
  now?: Date;
  policy: MemoryPolicy;
  projectConsentRequired: boolean;
}): TurnContextValueV1[] {
  if (
    !input.policy.enabled ||
    input.policy.selectedFactKeys.length === 0 ||
    !hasMemoryConsent(
      input.attributes,
      input.policy,
      input.projectConsentRequired,
    )
  ) {
    return [];
  }

  const cutoff =
    (input.now ?? new Date()).getTime() -
    input.policy.retentionDays * 24 * 60 * 60 * 1_000;
  const selectedKeys = new Set(input.policy.selectedFactKeys);

  return input.attributes.flatMap((attribute) => {
    if (
      !selectedKeys.has(attribute.key) ||
      attribute.updatedAt.getTime() < cutoff
    ) {
      return [];
    }
    const value = normalizeMemoryValue(attribute.value);
    return value === null
      ? []
      : [
          {
            key: attribute.key,
            modelVisible: true,
            sensitivity: "standard" as const,
            value,
          },
        ];
  });
}

export async function loadSelectedContactMemory(input: {
  contactId: number | null;
  now?: Date;
  policy: ConversationProjectPolicyV1;
  projectId: number;
}) {
  if (input.contactId === null) {
    return [];
  }

  const contact = await getContact(input.projectId, input.contactId);
  if (!contact) {
    return [];
  }
  const attributes = await listContactAttributes(
    input.projectId,
    input.contactId,
  );

  return selectSelectedContactMemoryFacts({
    attributes,
    now: input.now,
    policy: input.policy.dataHandling.memory,
    projectConsentRequired: input.policy.dataHandling.consentRequired,
  });
}
