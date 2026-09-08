"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  discardHostedVoiceCandidate,
  HostedVoiceDriftError,
  inspectHostedVoiceDeployment,
  promoteHostedVoiceCandidate,
  publishHostedVoiceCandidate,
  rollbackHostedVoiceDeployment,
} from "@/lib/hosted-voice-deployment";
import {
  listSupersededLiaHostedVoiceVersionIds,
  telnyxHostedVoiceDeploymentRepository,
} from "@/lib/hosted-voice-deployment-store";
import {
  buildHostedVoiceStagingDefinition,
  buildTelnyxHostedVoiceToolSetup,
  getHostedVoiceStagingState,
  getTelnyxHostedVoiceCandidateSecretIdentifier,
  hostedVoiceStagingDefinitionInputSchema,
} from "@/lib/hosted-voice-staging";
import {
  createHostedVoiceNoCallVerificationToken,
  verifyHostedVoiceIntegrationSecretFreshness,
  verifyHostedVoiceToolEndpoint,
} from "@/lib/hosted-voice-tool-preflight";
import {
  createHostedVoiceToolBinding,
  requireHostedVoiceCandidateUat,
} from "@/lib/hosted-voice-tool-store";
import { TelnyxHostedVoiceVerificationError } from "@/lib/telnyx-hosted-voice-adapter";
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
const integrationSecretIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/);

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

export async function pushHostedVoiceCandidateToolsAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = z
    .object({
      deploymentId: deploymentIdSchema,
      integrationSecretIdentifier: integrationSecretIdentifierSchema,
    })
    .safeParse({
      deploymentId: formData.get("deploymentId"),
      integrationSecretIdentifier: formData.get("integrationSecretIdentifier"),
    });
  if (!parsed.success) {
    return {
      error: "Enter the existing Telnyx Integration Secret identifier.",
    };
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  const diagnosticSteps: string[] = [];
  try {
    const state = await getHostedVoiceStagingState(context.project.id);
    const deployment = state.deployment;
    if (!deployment || deployment.id !== parsed.data.deploymentId) {
      throw new Error("Hosted voice deployment was not found.");
    }
    if (
      !deployment.bindingId ||
      !deployment.bindingUpdatedAt ||
      !deployment.candidateDeploymentVersionId ||
      !deployment.candidateRemoteVersionId ||
      !deployment.remoteAssistantId
    ) {
      throw new Error(
        "Rotate an active binding for the current Lia candidate first.",
      );
    }
    if (
      deployment.candidateRemoteVersionId === deployment.mainRemoteVersionId
    ) {
      throw new Error(
        "Webhook tools can only be pushed to a non-main candidate.",
      );
    }
    const expectedSecretIdentifier =
      getTelnyxHostedVoiceCandidateSecretIdentifier(
        deployment.candidateDeploymentVersionId,
      );
    if (parsed.data.integrationSecretIdentifier !== expectedSecretIdentifier) {
      throw new Error(
        `Use the candidate-specific Telnyx Integration Secret identifier "${expectedSecretIdentifier}". Reusing a prior candidate's identifier can change the tool credential used by MAIN.`,
      );
    }
    diagnosticSteps.push(
      `Validated candidate version …${deployment.candidateRemoteVersionId.slice(-8)} and active binding.`,
    );
    const provider = await getProjectTelnyxHostedVoiceProviderRecord(
      context.project.id,
    );
    if (!provider) throw new Error("Hosted Telnyx provider was not found.");
    const setup = await buildTelnyxHostedVoiceToolSetup({
      deploymentVersionId: deployment.candidateDeploymentVersionId,
      projectId: context.project.id,
    });
    diagnosticSteps.push(
      `Generated ${setup.tools.length} pinned Lia webhook definitions.`,
    );
    const { adapter } = await getProjectTelnyxHostedVoiceProvider({
      projectId: context.project.id,
      providerId: provider.id,
    });
    const integrationSecret = await adapter.inspectIntegrationSecret({
      identifier: parsed.data.integrationSecretIdentifier,
    });
    verifyHostedVoiceIntegrationSecretFreshness({
      bindingUpdatedAt: deployment.bindingUpdatedAt,
      integrationSecretUpdatedAt: integrationSecret.updatedAt,
    });
    diagnosticSteps.push(
      "Resolved the named Integration Secret and verified that it is current.",
    );
    const probeTools = setup.tools.filter(({ phase }) => phase !== "commit");
    if (probeTools.length === 0) {
      throw new Error(
        "The candidate has no safe Lia webhook tool for no-call verification.",
      );
    }
    for (const probeTool of probeTools) {
      await verifyHostedVoiceToolEndpoint({ url: probeTool.url });
    }
    diagnosticSteps.push(
      `Reached ${probeTools.length} public Lia webhook routes and confirmed their bearer-authentication boundaries.`,
    );
    const result = await adapter.pushCandidateTools({
      assistantId: deployment.remoteAssistantId,
      candidateVersionId: deployment.candidateRemoteVersionId,
      integrationSecretIdentifier: parsed.data.integrationSecretIdentifier,
      mainVersionId: deployment.mainRemoteVersionId,
      tools: setup.tools,
    });
    diagnosticSteps.push(
      `Attached ${result.toolCount} shared tools to the exact candidate${result.routingWasSuspended ? " and restored its routing" : ""}.`,
    );
    const verifications = [];
    for (const probeTool of probeTools) {
      const verificationRoute = getHostedVoiceToolRoute(probeTool.url);
      if (verificationRoute.phase !== probeTool.phase) {
        throw new Error(
          "The no-call verification route does not match the selected tool.",
        );
      }
      const verificationToken = createHostedVoiceNoCallVerificationToken({
        phase: verificationRoute.phase,
        secret:
          process.env.VOICE_TOOL_COMMIT_SECRET ?? process.env.AUTH_SECRET ?? "",
        toolId: verificationRoute.toolId,
      });
      const verification = await adapter.testWebhookToolWithoutCall({
        integrationSecretIdentifier: parsed.data.integrationSecretIdentifier,
        tool: probeTool,
        verificationToken,
      });
      verifications.push(verification);
      diagnosticSteps.push(
        `${verification.toolName} passed an authenticated no-call execution test (HTTP ${verification.statusCode}).`,
      );
    }
    await writeAuditLog({
      ...context,
      action: "hosted_voice.candidate_tools_pushed",
      metadata: {
        candidateRemoteVersionId: deployment.candidateRemoteVersionId,
        integrationSecretId: integrationSecret.id,
        noCallVerification: "passed",
        routingWasSuspended: result.routingWasSuspended,
        toolCount: result.toolCount,
        verifiedSafeToolCount: verifications.length,
        verifiedTools: verifications.map((verification) => ({
          name: verification.toolName,
          statusCode: verification.statusCode,
        })),
      },
      targetId: String(deployment.candidateDeploymentVersionId),
      targetType: "hosted_voice_deployment_version",
    });
    revalidatePath("/projects/channels/telnyx/hosted");
    const routingMessage = result.routingWasSuspended
      ? " Candidate routing was restored."
      : "";
    return {
      success: `${result.toolCount} Lia webhook tools were pushed and persisted on the exact candidate.${routingMessage} All ${verifications.length} safe read/prepare tools passed authenticated no-call execution tests.`,
    };
  } catch (error) {
    const verificationSteps =
      error instanceof TelnyxHostedVoiceVerificationError ? error.steps : [];
    const trace = [...diagnosticSteps, ...verificationSteps];
    return {
      error:
        trace.length > 0
          ? [
              getHostedVoiceActionError(error),
              "",
              "Safe diagnostic trace:",
              ...trace.map((step, index) => `${index + 1}. ${step}`),
            ].join("\n")
          : getHostedVoiceActionError(error),
    };
  }
}

function getHostedVoiceToolRoute(url: string) {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const parsed = z
    .object({
      phase: z.enum(["prepare", "read"]),
      toolId: z.string().trim().min(1).max(120),
    })
    .safeParse({
      phase: segments.at(-1),
      toolId: segments.at(-2)
        ? decodeURIComponent(segments.at(-2) as string)
        : undefined,
    });
  if (!parsed.success) {
    throw new Error("The no-call verification tool URL is invalid.");
  }
  return parsed.data;
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
      const deployment =
        await telnyxHostedVoiceDeploymentRepository.findDeploymentById({
          deploymentId,
          projectId,
        });
      if (!deployment?.candidateRemoteVersionId) {
        throw new Error("Hosted voice deployment has no candidate to promote.");
      }
      await requireHostedVoiceCandidateUat({
        deploymentId,
        projectId,
        provider: "telnyx",
        remoteVersionId: deployment.candidateRemoteVersionId,
      });
      await promoteHostedVoiceCandidate({
        adapter,
        deploymentId,
        projectId,
        repository: telnyxHostedVoiceDeploymentRepository,
      });
      return "The fully evidenced Telnyx candidate is now the main version.";
    },
  );
}

export async function discardHostedVoiceCandidateAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  if (formData.get("confirm") !== "discard") {
    return {
      error: "Confirm that candidate traffic routing was removed first.",
    };
  }
  return runDeploymentAction(
    formData,
    async ({ adapter, deploymentId, projectId }) => {
      await discardHostedVoiceCandidate({
        adapter,
        deploymentId,
        projectId,
        repository: telnyxHostedVoiceDeploymentRepository,
      });
      return "Failed candidate deleted from Telnyx and its Lia tool binding revoked.";
    },
  );
}

export async function cleanupHostedVoiceVersionsAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  if (formData.get("confirm") !== "cleanup") {
    return {
      error: "Confirm that superseded Lia-owned versions should be deleted.",
    };
  }
  return runDeploymentAction(
    formData,
    async ({ adapter, context, deploymentId, projectId }) => {
      const deployment =
        await telnyxHostedVoiceDeploymentRepository.findDeploymentById({
          deploymentId,
          projectId,
        });
      if (!deployment?.remoteAssistantId) {
        throw new Error("Hosted voice deployment was not found.");
      }
      const protectedVersionIds = [
        deployment.mainRemoteVersionId,
        deployment.candidateRemoteVersionId,
        deployment.rollbackRemoteVersionId,
      ].filter((value): value is string => Boolean(value));
      const obsoleteVersionIds = await listSupersededLiaHostedVoiceVersionIds({
        deploymentId,
        projectId,
      });
      const result = await adapter.cleanupObsoleteVersions({
        assistantId: deployment.remoteAssistantId,
        obsoleteVersionIds,
        protectedVersionIds,
      });
      await writeAuditLog({
        ...context,
        action: "hosted_voice.obsolete_versions_deleted",
        metadata: {
          deletedVersionIds: result.deletedVersionIds,
          obsoleteVersionIds,
          protectedVersionIds,
        },
        targetId: String(deployment.id),
        targetType: "hosted_voice_deployment",
      });
      return result.deletedVersionIds.length === 0
        ? "No superseded Lia-owned Telnyx Assistant versions were found."
        : `${result.deletedVersionIds.length} superseded Lia-owned Telnyx Assistant version(s) were deleted. MAIN, the current Lia candidate, rollback targets, and unrelated versions were preserved.`;
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
    context: Awaited<ReturnType<typeof resolveUserAndProject>>;
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
      context,
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
