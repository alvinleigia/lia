"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  getProjectTelnyxVoiceChannel,
  isValidTelnyxVoicePublicKey,
  normalizeTelnyxVoiceConfig,
  TELNYX_TRANSCRIPTION_ENGINES,
  upsertProjectTelnyxVoiceChannel,
} from "@/lib/telnyx-voice-provider";

const telnyxSettingsSchema = z.object({
  apiKey: z.string().trim().max(500).optional(),
  connectionId: z.string().trim().max(160),
  greeting: z.string().trim().max(1000),
  language: z.string().trim().min(2).max(35),
  name: z.string().trim().min(1).max(120),
  phoneNumber: z.string().trim().max(40),
  publicKey: z.string().trim().max(2000),
  status: z.enum(["active", "disabled"]),
  transcriptionEngine: z.enum(TELNYX_TRANSCRIPTION_ENGINES),
  transcriptionModel: z.string().trim().max(120),
  transferDestination: z.string().trim().max(100),
  voice: z.string().trim().min(1).max(160),
});

export async function updateTelnyxVoiceChannelAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = telnyxSettingsSchema.safeParse({
    apiKey: formData.get("apiKey"),
    connectionId: formData.get("connectionId"),
    greeting: formData.get("greeting"),
    language: formData.get("language"),
    name: formData.get("name"),
    phoneNumber: formData.get("phoneNumber"),
    publicKey: formData.get("publicKey"),
    status: formData.get("status"),
    transcriptionEngine: formData.get("transcriptionEngine"),
    transcriptionModel: formData.get("transcriptionModel"),
    transferDestination: formData.get("transferDestination"),
    voice: formData.get("voice"),
  });

  if (!parsed.success) {
    return { error: "Please check the Telnyx Voice settings." };
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  const existing = await getProjectTelnyxVoiceChannel(context.project.id);
  const existingConfig = normalizeTelnyxVoiceConfig(existing?.config);
  const apiKey = parsed.data.apiKey || existingConfig.apiKey;

  if (parsed.data.status === "active") {
    if (!parsed.data.connectionId || !apiKey || !parsed.data.publicKey) {
      return {
        error:
          "An active Telnyx channel requires a connection ID, API key, and public key.",
      };
    }
    if (!isValidTelnyxVoicePublicKey(parsed.data.publicKey)) {
      return {
        error: "Enter a valid Telnyx Ed25519 public key in PEM or base64 form.",
      };
    }
  } else if (
    parsed.data.publicKey &&
    !isValidTelnyxVoicePublicKey(parsed.data.publicKey)
  ) {
    return {
      error: "Enter a valid Telnyx Ed25519 public key in PEM or base64 form.",
    };
  }

  const channel = await upsertProjectTelnyxVoiceChannel({
    config: {
      apiKey: parsed.data.apiKey,
      connectionId: parsed.data.connectionId,
      greeting: parsed.data.greeting,
      language: parsed.data.language,
      phoneNumber: parsed.data.phoneNumber,
      publicKey: parsed.data.publicKey,
      transcriptionEngine: parsed.data.transcriptionEngine,
      transcriptionModel: parsed.data.transcriptionModel,
      transferDestination: parsed.data.transferDestination,
      voice: parsed.data.voice,
    },
    name: parsed.data.name,
    projectId: context.project.id,
    status: parsed.data.status,
  });

  await writeAuditLog({
    ...context,
    action: "telnyx_voice_channel.updated",
    metadata: {
      apiKeyUpdated: Boolean(parsed.data.apiKey),
      channelType: "telnyx_voice",
      connectionIdConfigured: Boolean(parsed.data.connectionId),
      publicKeyConfigured: Boolean(parsed.data.publicKey),
      status: parsed.data.status,
      transferConfigured: Boolean(parsed.data.transferDestination),
    },
    targetId: channel?.id ?? context.project.id,
    targetType: "project_channel",
  });

  revalidatePath("/projects/channels/telnyx");
  redirect("/projects/channels/telnyx?updated=1");
}
