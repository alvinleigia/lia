"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  getProjectWhatsAppChannel,
  isWhatsAppPhoneLinkedToOtherProject,
  normalizeWhatsAppConfig,
  upsertProjectWhatsAppChannel,
} from "@/lib/whatsapp";
import {
  activateWhatsAppSignup,
  createWhatsAppSignupState,
  exchangeWhatsAppSignupCode,
  getWhatsAppSignupSettings,
  verifyWhatsAppAccount,
  verifyWhatsAppAppWebhook,
  verifyWhatsAppSignupState,
  WHATSAPP_SIGNUP_TTL_SECONDS,
  WhatsAppSignupError,
  whatsappSignupInputSchema,
} from "@/lib/whatsapp-embedded-signup";

const COOKIE = "lia_whatsapp_signup";
const PATH = "/projects/channels/whatsapp";
const projectIdSchema = z.number().int().positive();

function publicError(error: unknown) {
  return error instanceof WhatsAppSignupError
    ? error.message
    : "WhatsApp setup could not be completed. Refresh this page and try again, or ask your administrator for help.";
}

export async function beginWhatsAppSignupAction(projectId: number) {
  try {
    const context = await resolveStrictUserAndProject(
      projectIdSchema.parse(projectId),
    );
    assertPermission(context.membership, "company.widget.manage");
    const settings = getWhatsAppSignupSettings();
    if (!settings)
      return {
        error:
          "Quick connect is not ready yet. Ask your Lia administrator to finish the Meta setup.",
      };
    await verifyWhatsAppAppWebhook(settings);
    const state = createWhatsAppSignupState(
      { projectId: context.project.id, userId: context.user.id },
      settings.appSecret,
    );
    (await cookies()).set(COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: PATH,
      maxAge: WHATSAPP_SIGNUP_TTL_SECONDS,
    });
    return { state };
  } catch (error) {
    return { error: publicError(error) };
  }
}

export async function completeWhatsAppSignupAction(input: unknown) {
  try {
    const parsed = whatsappSignupInputSchema.safeParse(input);
    if (!parsed.success)
      return {
        error:
          "The signup details were incomplete. Please start Connect WhatsApp again.",
      };
    const context = await resolveStrictUserAndProject(parsed.data.projectId);
    assertPermission(context.membership, "company.widget.manage");
    const settings = getWhatsAppSignupSettings();
    if (!settings)
      return {
        error:
          "Quick connect is not configured. Please contact your Lia administrator.",
      };
    const jar = await cookies();
    if (
      !verifyWhatsAppSignupState({
        state: parsed.data.state,
        cookie: jar.get(COOKIE)?.value,
        projectId: context.project.id,
        userId: context.user.id,
        secret: settings.appSecret,
      })
    )
      return {
        error:
          "This signup session expired or belongs to another project. Please start Connect WhatsApp again.",
      };
    // Consume the browser nonce before any remote writes. Meta also consumes the code once.
    jar.set(COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: PATH,
      maxAge: 0,
    });
    const existing = await getProjectWhatsAppChannel(context.project.id);
    if (
      existing?.externalId &&
      existing.externalId !== parsed.data.phoneNumberId
    ) {
      return {
        error:
          "This project already has a different WhatsApp number. Reconnect its existing number, or use a separate project.",
      };
    }
    if (
      await isWhatsAppPhoneLinkedToOtherProject(
        context.project.id,
        parsed.data.phoneNumberId,
      )
    ) {
      return {
        error: "This WhatsApp number is already linked to another project.",
      };
    }
    const accessToken = await exchangeWhatsAppSignupCode(
      settings,
      parsed.data.code,
    );
    const phone = await activateWhatsAppSignup({
      ...parsed.data,
      settings,
      accessToken,
    });
    const channel = await upsertProjectWhatsAppChannel({
      projectId: context.project.id,
      name: existing?.name ?? `${context.project.name} WhatsApp`,
      status: "active",
      preserveExistingNumber: true,
      config: {
        businessAccountId: parsed.data.businessAccountId,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        businessName: phone.verified_name ?? "",
        accessToken,
        appSecret: settings.appSecret,
        verifyToken: settings.verifyToken,
        apiVersion: settings.apiVersion,
      },
    });
    await writeAuditLog({
      ...context,
      action: "whatsapp_channel.connected",
      targetType: "project_channel",
      targetId: channel.id,
      metadata: { method: "embedded_signup", status: "active" },
    });
    revalidatePath(PATH);
    return { success: true, displayPhoneNumber: phone.display_phone_number };
  } catch (error) {
    return { error: publicError(error) };
  }
}

export async function checkWhatsAppConnectionAction(projectId: number) {
  try {
    const context = await resolveStrictUserAndProject(
      projectIdSchema.parse(projectId),
    );
    assertPermission(context.membership, "company.widget.manage");
    const channel = await getProjectWhatsAppChannel(context.project.id);
    const config = normalizeWhatsAppConfig(channel?.config);
    if (
      !channel ||
      channel.status !== "active" ||
      !config.accessToken ||
      !config.phoneNumberId ||
      !config.businessAccountId
    ) {
      return {
        error:
          "WhatsApp is not connected yet. Use Connect WhatsApp to get started.",
      };
    }
    const phone = await verifyWhatsAppAccount({
      settings: {
        apiVersion:
          config.apiVersion ||
          process.env.WHATSAPP_GRAPH_API_VERSION ||
          "v20.0",
      },
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
    });
    if (phone.status !== "CONNECTED")
      return {
        error:
          "Meta has not marked your number as connected. Check its status in WhatsApp Manager.",
      };
    return {
      success: true,
      message:
        "Meta authorization and number registration are working. Send a message from your phone to check the full chat flow.",
    };
  } catch (error) {
    return { error: publicError(error) };
  }
}
