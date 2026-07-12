import { addActionSubmissionEvent } from "@/lib/action-flows";
import type { RuntimeActionStep } from "@/lib/action-runtime";
import { addContactTag, setContactAttribute } from "@/lib/contacts";

type MutationResult = {
  ok: boolean;
  message: string;
};

type ExecuteContactMutationInput = {
  contactId: number | null;
  fields: Record<string, unknown>;
  projectId: number;
  source?: string;
  step: RuntimeActionStep;
  submissionId: number;
};

function getSettingText(
  settings: Record<string, unknown>,
  key: string,
): string {
  const value = settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function getTagNames(settings: Record<string, unknown>) {
  return getSettingText(settings, "contactTagNames")
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function resolveAttributeValue(input: {
  fields: Record<string, unknown>;
  settings: Record<string, unknown>;
}) {
  const valueSource = getSettingText(
    input.settings,
    "contactAttributeValueSource",
  );

  if (valueSource === "static") {
    return getSettingText(input.settings, "contactAttributeValue");
  }

  const fieldKey = getSettingText(input.settings, "contactAttributeFieldKey");
  return fieldKey ? input.fields[fieldKey] : undefined;
}

export function isContactMutationStep(step: RuntimeActionStep) {
  return step.stepType === "set_attribute" || step.stepType === "add_tag";
}

export async function executeContactMutationStep(
  input: ExecuteContactMutationInput,
): Promise<MutationResult> {
  if (!input.contactId) {
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: "contact.mutation_skipped",
      message: "No active contact is linked to this flow.",
      payload: {
        stepId: input.step.id,
        stepType: input.step.stepType,
      },
    });

    return {
      ok: false,
      message: "No active contact is linked to this flow.",
    };
  }
  const contactId = input.contactId;

  if (input.step.stepType === "set_attribute") {
    const key = getSettingText(input.step.settings, "contactAttributeKey");
    const value = resolveAttributeValue({
      fields: input.fields,
      settings: input.step.settings,
    });

    if (!key || value === undefined) {
      await addActionSubmissionEvent({
        projectId: input.projectId,
        submissionId: input.submissionId,
        eventType: "contact.attribute_skipped",
        message: "Contact attribute step is missing a key or value.",
        payload: {
          key,
          stepId: input.step.id,
          value,
        },
      });

      return {
        ok: false,
        message: "Contact attribute step is missing a key or value.",
      };
    }

    const attribute = await setContactAttribute({
      contactId,
      key,
      projectId: input.projectId,
      source: input.source ?? "flow",
      value,
    });

    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: attribute
        ? "contact.attribute_set"
        : "contact.attribute_skipped",
      message: attribute
        ? `Set contact attribute ${key}.`
        : "Contact attribute could not be set.",
      payload: {
        attributeId: attribute?.id ?? null,
        contactId,
        key,
        stepId: input.step.id,
        value,
      },
    });

    return {
      ok: Boolean(attribute),
      message: attribute
        ? `Set contact attribute ${key}.`
        : "Contact attribute could not be set.",
    };
  }

  const tags = getTagNames(input.step.settings);
  if (tags.length === 0) {
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: "contact.tags_skipped",
      message: "Contact tag step has no tags configured.",
      payload: {
        stepId: input.step.id,
      },
    });

    return {
      ok: false,
      message: "Contact tag step has no tags configured.",
    };
  }

  const results = await Promise.all(
    tags.map((name) =>
      addContactTag({
        contactId,
        name,
        projectId: input.projectId,
        source: input.source ?? "flow",
      }),
    ),
  );
  const appliedTags = results
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .map((result) => result.tag.name);

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: input.submissionId,
    eventType: "contact.tags_added",
    message: `Added ${appliedTags.length} contact tag(s).`,
    payload: {
      contactId,
      requestedTags: tags,
      stepId: input.step.id,
      tags: appliedTags,
    },
  });

  return {
    ok: appliedTags.length > 0,
    message: `Added ${appliedTags.length} contact tag(s).`,
  };
}
