"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  HostedVoiceDriftError,
  inspectHostedVoiceDeployment,
  promoteHostedVoiceCandidate,
  publishHostedVoiceCandidate,
  rollbackHostedVoiceDeployment,
} from "@/lib/hosted-voice-deployment";
import { telnyxHostedVoiceDeploymentRepository } from "@/lib/hosted-voice-deployment-store";
import {
  buildHostedVoiceStagingDefinition,
  buildTelnyxHostedVoiceToolSetup,
  hostedVoiceStagingDefinitionInputSchema,
} from "@/lib/hosted-voice-staging";
import { createHostedVoiceToolBinding } from "@/lib/hosted-voice-tool-store";
import {
  getProjectTelnyxHostedVoiceProvider,
  getProjectTelnyxHostedVoiceProviderRecord,
  upsertProjectTelnyxHostedVoiceProvider,
} from "@/lib/telnyx-hosted-voice-provider";
import { isValidTelnyxVoicePublicKey } from "@/lib/telnyx-voice-provider";

const hostedProviderSchema = z.object({
  apiKey: z.string().trim().max(500).optional(),
  costRateMicrounitsPerMinute: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000_000),
  modelId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(120),
  transcriptionLanguage: z.string().trim().min(2).max(40),
  transcriptionModelId: z.string().trim().min(1).max(160),
  voiceId: z.string().trim().min(1).max(240),
  webhookPublicKey: z.string().trim().max(2_000).optional(),
});

const deploymentIdSchema = z.coerce.number().int().positive();

export type HostedVoiceBindingActionState = ActionFormState & {
  credential?: string;
  setupJson?: string;
};

export async function saveHostedVoiceProviderAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = hostedProviderSchema.safeParse({
    apiKey: formData.get("apiKey"),
    costRateMicrounitsPerMinute: formData.get("costRateMicrounitsPerMinute"),
    modelId: formData.get("modelId"),
    name: formData.get("name"),
    transcriptionLanguage: formData.get("transcriptionLanguage"),
    transcriptionModelId: formData.get("transcriptionModelId"),
    voiceId: formData.get("voiceId"),
    webhookPublicKey: formData.get("webhookPublicKey"),
  });
  if (!parsed.success) {
    return { error: "Please check the hosted Telnyx provider settings." };
  }
  if (
    parsed.data.webhookPublicKey &&
    !isValidTelnyxVoicePublicKey(parsed.data.webhookPublicKey)
  ) {
    return { error: "Enter a valid Telnyx Ed25519 public key." };
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  const existing = await getProjectTelnyxHostedVoiceProviderRecord(
    context.project.id,
  );
  try {
    const provider = await upsertProjectTelnyxHostedVoiceProvider({
      ...parsed.data,
      projectId: context.project.id,
    });
    await writeAuditLog({
      ...context,
      action: "hosted_voice.provider_configured",
      metadata: {
        apiKeyUpdated: Boolean(parsed.data.apiKey),
        providerType: "telnyx_ai_assistant",
        webhookPublicKeyConfigured: Boolean(parsed.data.webhookPublicKey),
      },
      targetId: provider.id,
      targetType: "integration_provider",
    });
    revalidatePath("/projects/channels/telnyx/hosted");
    return {
      success: existing
        ? "Hosted Telnyx provider updated."
        : "Hosted Telnyx provider created.",
    };
  } catch (error) {
    return { error: getHostedVoiceActionError(error) };
  }
}

export async function publishHostedVoiceCandidateAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = hostedVoiceStagingDefinitionInputSchema.safeParse({
    greeting: formData.get("greeting"),
    handoffMode: formData.get("handoffMode"),
    identityRequirement: formData.get("identityRequirement"),
    instructions: formData.get("instructions"),
    key: formData.get("key"),
    language: formData.get("language"),
    name: formData.get("name"),
    retentionDays: Number(formData.get("retentionDays")),
    taskVersionIds: formData
      .getAll("taskVersionIds")
      .map((value) => Number(value)),
    timezone: formData.get("timezone"),
    verificationFactors: String(formData.get("verificationFactors") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  });
  if (!parsed.success) {
    return {
      error:
        "Check the voice definition and select at least one published task version.",
    };
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  try {
    const provider = await getProjectTelnyxHostedVoiceProviderRecord(
      context.project.id,
    );
    if (!provider) {
      return { error: "Configure the hosted Telnyx provider first." };
    }
    const definition = await buildHostedVoiceStagingDefinition({
      projectId: context.project.id,
      value: parsed.data,
    });
    const { adapter } = await getProjectTelnyxHostedVoiceProvider({
      projectId: context.project.id,
      providerId: provider.id,
    });
    const result = await publishHostedVoiceCandidate({
      adapter,
      definition,
      projectId: context.project.id,
      providerId: provider.id,
      repository: telnyxHostedVoiceDeploymentRepository,
    });
    revalidatePath("/projects/channels/telnyx/hosted");
    return {
      success: result.reused
        ? "The verified hosted voice candidate is already current."
        : "A verified non-main Telnyx Assistant candidate was created.",
    };
  } catch (error) {
    return { error: getHostedVoiceActionError(error) };
  }
}

export async function rotateHostedVoiceBindingAction(
  _previousState: HostedVoiceBindingActionState,
  formData: FormData,
): Promise<HostedVoiceBindingActionState> {
  const deploymentVersionId = deploymentIdSchema.safeParse(
    formData.get("deploymentVersionId"),
  );
  if (!deploymentVersionId.success) {
    return { error: "A valid candidate version is required." };
  }
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  try {
    const setup = await buildTelnyxHostedVoiceToolSetup({
      deploymentVersionId: deploymentVersionId.data,
      projectId: context.project.id,
    });
    const { credential } = await createHostedVoiceToolBinding({
      deploymentVersionId: deploymentVersionId.data,
      projectId: context.project.id,
      provider: "telnyx",
    });
    revalidatePath("/projects/channels/telnyx/hosted");
    return {
      credential,
      setupJson: JSON.stringify(setup, null, 2),
      success:
        "Binding rotated. Store the credential in Telnyx now; Lia cannot show it again.",
    };
  } catch (error) {
    return { error: getHostedVoiceActionError(error) };
  }
}

export async function inspectHostedVoiceDeploymentAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  return runDeploymentAction(
    formData,
    async ({ adapter, deploymentId, projectId }) => {
      const deployment =
        await telnyxHostedVoiceDeploymentRepository.findDeploymentById({
          deploymentId,
          projectId,
        });
      if (!deployment)
        throw new Error("Hosted voice deployment was not found.");
      const result = await inspectHostedVoiceDeployment({
        adapter,
        deployment,
        repository: telnyxHostedVoiceDeploymentRepository,
      });
      return result.status === "drifted"
        ? "Remote drift detected. Promotion remains blocked."
        : "Telnyx main version is in sync with Lia.";
    },
  );
}

export async function promoteHostedVoiceCandidateAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  if (formData.get("confirm") !== "promote") {
    return { error: "Confirm that the candidate passed staging UAT first." };
  }
  return runDeploymentAction(
    formData,
    async ({ adapter, deploymentId, projectId }) => {
      await promoteHostedVoiceCandidate({
        adapter,
        deploymentId,
        projectId,
        repository: telnyxHostedVoiceDeploymentRepository,
      });
      return "The tested Telnyx candidate is now the main version.";
    },
  );
}

export async function rollbackHostedVoiceDeploymentAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  if (formData.get("confirm") !== "rollback") {
    return { error: "Confirm the rollback action first." };
  }
  return runDeploymentAction(
    formData,
    async ({ adapter, deploymentId, projectId }) => {
      await rollbackHostedVoiceDeployment({
        adapter,
        deploymentId,
        projectId,
        repository: telnyxHostedVoiceDeploymentRepository,
      });
      return "The verified rollback version is now main.";
    },
  );
}

async function runDeploymentAction(
  formData: FormData,
  execute: (input: {
    adapter: Awaited<
      ReturnType<typeof getProjectTelnyxHostedVoiceProvider>
    >["adapter"];
    deploymentId: number;
    projectId: number;
  }) => Promise<string>,
): Promise<ActionFormState> {
  const deploymentId = deploymentIdSchema.safeParse(
    formData.get("deploymentId"),
  );
  if (!deploymentId.success) {
    return { error: "A valid hosted voice deployment is required." };
  }
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  try {
    const provider = await getProjectTelnyxHostedVoiceProviderRecord(
      context.project.id,
    );
    if (!provider) throw new Error("Hosted Telnyx provider was not found.");
    const { adapter } = await getProjectTelnyxHostedVoiceProvider({
      projectId: context.project.id,
      providerId: provider.id,
    });
    const success = await execute({
      adapter,
      deploymentId: deploymentId.data,
      projectId: context.project.id,
    });
    revalidatePath("/projects/channels/telnyx/hosted");
    return { success };
  } catch (error) {
    return { error: getHostedVoiceActionError(error) };
  }
}

function getHostedVoiceActionError(error: unknown) {
  if (error instanceof HostedVoiceDriftError) {
    return "Remote Telnyx drift was detected. Inspect and resolve it before continuing.";
  }
  if (error instanceof Error && error.message.length <= 240) {
    return error.message;
  }
  return "The hosted Telnyx operation could not be completed.";
}
