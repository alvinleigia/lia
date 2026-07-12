"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  getProjectWhatsAppChannel,
  sendWhatsAppTextMessage,
  upsertProjectWhatsAppChannel,
} from "@/lib/whatsapp";

const whatsappSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["active", "disabled"]),
  businessAccountId: z.string().trim().max(160).optional(),
  phoneNumberId: z.string().trim().max(160).optional(),
  displayPhoneNumber: z.string().trim().max(80).optional(),
  businessName: z.string().trim().max(120).optional(),
  accessToken: z.string().trim().optional(),
  appSecret: z.string().trim().optional(),
  verifyToken: z.string().trim().optional(),
});

const testMessageSchema = z.object({
  to: z.string().trim().min(6).max(30),
  message: z.string().trim().min(1).max(1000),
});

function redirectWithError(message: string): never {
  redirect(`/projects/channels/whatsapp?error=${encodeURIComponent(message)}`);
}

export async function updateWhatsAppChannelAction(formData: FormData) {
  const parsed = whatsappSettingsSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status"),
    businessAccountId: formData.get("businessAccountId"),
    phoneNumberId: formData.get("phoneNumberId"),
    displayPhoneNumber: formData.get("displayPhoneNumber"),
    businessName: formData.get("businessName"),
    accessToken: formData.get("accessToken"),
    appSecret: formData.get("appSecret"),
    verifyToken: formData.get("verifyToken"),
  });

  if (!parsed.success) {
    redirectWithError("Please check the WhatsApp settings.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");

  const channel = await upsertProjectWhatsAppChannel({
    projectId: context.project.id,
    name: parsed.data.name,
    status: parsed.data.status,
    config: {
      businessAccountId: parsed.data.businessAccountId,
      phoneNumberId: parsed.data.phoneNumberId,
      displayPhoneNumber: parsed.data.displayPhoneNumber,
      businessName: parsed.data.businessName,
      accessToken: parsed.data.accessToken,
      appSecret: parsed.data.appSecret,
      verifyToken: parsed.data.verifyToken,
    },
  });

  await writeAuditLog({
    ...context,
    action: "whatsapp_channel.updated",
    targetType: "project_channel",
    targetId: channel?.id ?? context.project.id,
    metadata: {
      channelType: "whatsapp",
      status: parsed.data.status,
      phoneNumberIdConfigured: Boolean(parsed.data.phoneNumberId),
      accessTokenUpdated: Boolean(parsed.data.accessToken),
      appSecretUpdated: Boolean(parsed.data.appSecret),
      verifyTokenUpdated: Boolean(parsed.data.verifyToken),
    },
  });

  revalidatePath("/projects/channels/whatsapp");
  redirect("/projects/channels/whatsapp?updated=1");
}

export async function sendWhatsAppTestMessageAction(formData: FormData) {
  const parsed = testMessageSchema.safeParse({
    to: formData.get("to"),
    message: formData.get("message"),
  });

  if (!parsed.success) {
    redirectWithError("Please enter a valid WhatsApp recipient and message.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.widget.manage");
  const channel = await getProjectWhatsAppChannel(context.project.id);

  if (!channel || channel.status !== "active") {
    redirectWithError("Enable and save the WhatsApp channel first.");
  }

  try {
    await sendWhatsAppTextMessage({
      channel,
      to: parsed.data.to,
      text: parsed.data.message,
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "WhatsApp test send failed.",
    );
  }

  await writeAuditLog({
    ...context,
    action: "whatsapp_channel.test_message_sent",
    targetType: "project_channel",
    targetId: channel.id,
    metadata: {
      to: parsed.data.to,
    },
  });

  revalidatePath("/projects/channels/whatsapp");
  redirect("/projects/channels/whatsapp?testSent=1");
}
