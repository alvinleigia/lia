import { addActionSubmissionEvent } from "@/lib/action-flows";
import type { RuntimeActionStep } from "@/lib/action-runtime";
import {
  addContactTag,
  getActiveProjectAgentByEmail,
  removeContactTag,
  setContactAttribute,
  updateContactWorkflowState,
} from "@/lib/contacts";

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
  return [
    "set_attribute",
    "add_tag",
    "remove_tag",
    "subscribe",
    "unsubscribe",
    "assign_agent",
    "assign_team",
  ].includes(step.stepType);
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

  if (input.step.stepType === "add_tag") {
    const tags = getTagNames(input.step.settings);
    if (tags.length === 0) {
      await addActionSubmissionEvent({
        projectId: input.projectId,
        submissionId: input.submissionId,
        eventType: "contact.tags_skipped",
        message: "Contact tag step has no tags configured.",
        payload: { stepId: input.step.id },
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

  if (input.step.stepType === "remove_tag") {
    const tags = getTagNames(input.step.settings);
    const results = await Promise.all(
      tags.map((name) =>
        removeContactTag({ contactId, name, projectId: input.projectId }),
      ),
    );
    const removedTags = results
      .filter((result): result is NonNullable<typeof result> => Boolean(result))
      .map((result) => result.tag.name);

    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: "contact.tags_removed",
      message: `Removed ${removedTags.length} contact tag(s).`,
      payload: {
        contactId,
        requestedTags: tags,
        stepId: input.step.id,
        tags: removedTags,
      },
    });

    return {
      ok: removedTags.length > 0,
      message: `Removed ${removedTags.length} contact tag(s).`,
    };
  }

  if (
    input.step.stepType === "subscribe" ||
    input.step.stepType === "unsubscribe"
  ) {
    const subscriptionStatus =
      input.step.stepType === "subscribe" ? "subscribed" : "unsubscribed";
    const updated = await updateContactWorkflowState({
      contactId,
      patch: { subscriptionStatus },
      projectId: input.projectId,
    });

    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: `contact.${subscriptionStatus}`,
      message: `Contact marked ${subscriptionStatus}.`,
      payload: { contactId, stepId: input.step.id },
    });

    return {
      ok: Boolean(updated),
      message: `Contact marked ${subscriptionStatus}.`,
    };
  }

  if (input.step.stepType === "assign_agent") {
    const email = getSettingText(input.step.settings, "contactAgentEmail");
    const agent = await getActiveProjectAgentByEmail(input.projectId, email);
    if (!agent) {
      await addActionSubmissionEvent({
        projectId: input.projectId,
        submissionId: input.submissionId,
        eventType: "contact.agent_assignment_skipped",
        message: "Configured agent is not an active company member.",
        payload: { stepId: input.step.id },
      });
      return {
        ok: false,
        message: "Configured agent is not an active company member.",
      };
    }

    const updated = await updateContactWorkflowState({
      contactId,
      patch: { assignedAgent: agent },
      projectId: input.projectId,
    });
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: "contact.agent_assigned",
      message: "Contact assigned to an agent.",
      payload: { contactId, stepId: input.step.id, userId: agent.userId },
    });
    return { ok: Boolean(updated), message: "Contact assigned to an agent." };
  }

  const teamName = getSettingText(input.step.settings, "contactTeamName");
  const updated = teamName
    ? await updateContactWorkflowState({
        contactId,
        patch: { assignedTeam: teamName },
        projectId: input.projectId,
      })
    : null;
  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: input.submissionId,
    eventType: updated
      ? "contact.team_assigned"
      : "contact.team_assignment_skipped",
    message: updated
      ? "Contact assigned to a team."
      : "Contact team name is missing.",
    payload: { contactId, stepId: input.step.id, teamName: teamName || null },
  });
  return {
    ok: Boolean(updated),
    message: updated
      ? "Contact assigned to a team."
      : "Contact team name is missing.",
  };
}
