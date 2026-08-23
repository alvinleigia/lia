import {
  createPublicKey,
  type KeyObject,
  verify as verifySignature,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ChannelDeliveryError } from "@/lib/channel-adapter-contract";
import { db } from "@/lib/db-config";
import {
  companies,
  projectChannels,
  projects,
  type SelectProjectChannel,
  workspaces,
} from "@/lib/db-schema";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "@/lib/encrypted-secrets";
import type { TelnyxVoiceDelivery } from "@/lib/telnyx-voice";

const TELNYX_API_BASE_URL = "https://api.telnyx.com/v2";
const TELNYX_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const TELNYX_TRANSCRIPTION_ENGINES = [
  "Telnyx",
  "Deepgram",
  "Google",
] as const;

export type TelnyxVoiceChannelConfig = {
  apiKey?: string;
  connectionId?: string;
  greeting?: string;
  language?: string;
  phoneNumber?: string;
  publicKey?: string;
  transcriptionEngine?: (typeof TELNYX_TRANSCRIPTION_ENGINES)[number];
  transcriptionModel?: string;
  transferDestination?: string;
  voice?: string;
};

const telnyxWebhookPayloadSchema = z
  .object({
    call_control_id: z.string().trim().min(1),
    call_leg_id: z.string().trim().min(1),
    call_session_id: z.string().trim().min(1),
    connection_id: z.string().trim().min(1),
    direction: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    transcription_data: z
      .object({
        confidence: z.number().optional(),
        is_final: z.boolean(),
        transcript: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const telnyxVoiceWebhookSchema = z
  .object({
    data: z
      .object({
        event_type: z.string().trim().min(1),
        id: z.string().trim().min(1),
        occurred_at: z.iso.datetime({ offset: true }),
        payload: telnyxWebhookPayloadSchema,
        record_type: z.literal("event"),
      })
      .passthrough(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type TelnyxVoiceWebhook = z.infer<typeof telnyxVoiceWebhookSchema>;

function readSecret(value: unknown) {
  try {
    return decryptSecretValue(value) ?? "";
  } catch {
    return "";
  }
}

export function normalizeTelnyxVoiceConfig(
  value: Record<string, unknown> | null | undefined,
) {
  const config = value ?? {};
  const transcriptionEngine = TELNYX_TRANSCRIPTION_ENGINES.find(
    (engine) => engine === config.transcriptionEngine,
  );

  return {
    apiKey: readSecret(config.apiKey),
    connectionId:
      typeof config.connectionId === "string" ? config.connectionId : "",
    greeting:
      typeof config.greeting === "string"
        ? config.greeting
        : "Hello. How can I help you today?",
    language: typeof config.language === "string" ? config.language : "en",
    phoneNumber:
      typeof config.phoneNumber === "string" ? config.phoneNumber : "",
    publicKey: typeof config.publicKey === "string" ? config.publicKey : "",
    transcriptionEngine: transcriptionEngine ?? "Telnyx",
    transcriptionModel:
      typeof config.transcriptionModel === "string"
        ? config.transcriptionModel
        : "",
    transferDestination:
      typeof config.transferDestination === "string"
        ? config.transferDestination
        : "",
    voice:
      typeof config.voice === "string" && config.voice.trim()
        ? config.voice
        : "Telnyx.NaturalHD.astra",
  } satisfies Required<TelnyxVoiceChannelConfig>;
}

export function getTelnyxVoiceWebhookUrl() {
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const path = "/api/telnyx/voice/webhook";

  return appBaseUrl ? `${appBaseUrl.replace(/\/$/, "")}${path}` : path;
}

export async function getProjectTelnyxVoiceChannel(projectId: number) {
  const [channel] = await db
    .select()
    .from(projectChannels)
    .where(
      and(
        eq(projectChannels.projectId, projectId),
        eq(projectChannels.channelType, "telnyx_voice"),
      ),
    )
    .limit(1);

  return channel ?? null;
}

export async function upsertProjectTelnyxVoiceChannel(input: {
  config: TelnyxVoiceChannelConfig;
  name: string;
  projectId: number;
  status: "active" | "disabled";
}) {
  const existing = await getProjectTelnyxVoiceChannel(input.projectId);
  const existingConfig = normalizeTelnyxVoiceConfig(existing?.config);
  const mergedConfig: Required<TelnyxVoiceChannelConfig> = {
    apiKey: input.config.apiKey || existingConfig.apiKey,
    connectionId: input.config.connectionId ?? "",
    greeting: input.config.greeting ?? "Hello. How can I help you today?",
    language: input.config.language ?? "en",
    phoneNumber: input.config.phoneNumber ?? "",
    publicKey: input.config.publicKey ?? "",
    transcriptionEngine: input.config.transcriptionEngine ?? "Telnyx",
    transcriptionModel: input.config.transcriptionModel ?? "",
    transferDestination: input.config.transferDestination ?? "",
    voice: input.config.voice ?? "Telnyx.NaturalHD.astra",
  };
  const storedConfig = {
    ...mergedConfig,
    apiKey: mergedConfig.apiKey ? encryptSecretValue(mergedConfig.apiKey) : "",
  };

  if (existing) {
    const [channel] = await db
      .update(projectChannels)
      .set({
        config: storedConfig,
        externalId: mergedConfig.connectionId || null,
        name: input.name,
        status: input.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectChannels.id, existing.id),
          eq(projectChannels.projectId, input.projectId),
        ),
      )
      .returning();

    return channel;
  }

  const [channel] = await db
    .insert(projectChannels)
    .values({
      channelType: "telnyx_voice",
      config: storedConfig,
      externalId: mergedConfig.connectionId || null,
      name: input.name,
      projectId: input.projectId,
      status: input.status,
    })
    .returning();

  return channel;
}

export async function getActiveTelnyxVoiceChannelByConnectionId(
  connectionId: string,
) {
  const [channel] = await db
    .select({ channel: projectChannels })
    .from(projectChannels)
    .innerJoin(projects, eq(projects.id, projectChannels.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(
      and(
        eq(projectChannels.channelType, "telnyx_voice"),
        eq(projectChannels.externalId, connectionId),
        eq(projectChannels.status, "active"),
        eq(projects.isArchived, false),
        eq(companies.status, "active"),
      ),
    )
    .limit(1);

  return channel?.channel ?? null;
}

function readTelnyxPublicKey(value: string): KeyObject {
  if (value.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(value);
  }

  const rawKey = Buffer.from(value, "base64");
  if (rawKey.length !== 32) {
    throw new Error("Telnyx public key must be PEM or base64 Ed25519.");
  }

  return createPublicKey({
    format: "der",
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
    type: "spki",
  });
}

export function verifyTelnyxWebhookSignature(input: {
  nowSeconds?: number;
  publicKey: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}) {
  if (
    !input.publicKey ||
    !input.signature ||
    !input.timestamp ||
    !/^\d+$/.test(input.timestamp)
  ) {
    return false;
  }
  const timestamp = Number(input.timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > TELNYX_WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  try {
    return verifySignature(
      null,
      Buffer.from(`${input.timestamp}|${input.rawBody}`),
      readTelnyxPublicKey(input.publicKey),
      Buffer.from(input.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function getTelnyxFinalTranscript(event: TelnyxVoiceWebhook) {
  const transcription = event.data.payload.transcription_data;
  if (!transcription?.is_final) {
    return null;
  }

  return transcription.transcript.trim() || null;
}

export function hasTelnyxSpeech(event: TelnyxVoiceWebhook) {
  return Boolean(event.data.payload.transcription_data?.transcript.trim());
}

type TelnyxCallAction =
  | "answer"
  | "hangup"
  | "playback_stop"
  | "speak"
  | "transfer";

export async function sendTelnyxVoiceCommand(input: {
  action: TelnyxCallAction;
  body: Record<string, unknown>;
  callControlId: string;
  channel: SelectProjectChannel;
  fetchImpl?: typeof fetch;
}) {
  const config = normalizeTelnyxVoiceConfig(input.channel.config);
  if (!config.apiKey) {
    throw new ChannelDeliveryError("Telnyx API key is missing.", false);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${TELNYX_API_BASE_URL}/calls/${encodeURIComponent(input.callControlId)}/actions/${input.action}`,
    {
      body: JSON.stringify(input.body),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const result = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new ChannelDeliveryError(
      `Telnyx ${input.action} failed with status ${response.status}.`,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
    );
  }

  return result;
}

export function buildTelnyxAnswerBody(input: {
  commandId: string;
  config: Required<TelnyxVoiceChannelConfig>;
}) {
  return {
    command_id: input.commandId,
    transcription: true,
    transcription_config: {
      language: input.config.language,
      transcription_engine: input.config.transcriptionEngine,
      ...(input.config.transcriptionModel
        ? { transcription_model: input.config.transcriptionModel }
        : {}),
    },
  };
}

export function sendTelnyxVoiceDelivery(input: {
  channel: SelectProjectChannel;
  delivery: TelnyxVoiceDelivery;
  fetchImpl?: typeof fetch;
}) {
  return sendTelnyxVoiceCommand({
    action: input.delivery.action,
    body: input.delivery.body,
    callControlId: input.delivery.callControlId,
    channel: input.channel,
    fetchImpl: input.fetchImpl,
  });
}
