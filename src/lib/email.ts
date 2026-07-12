type SendEmailInput = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
};

const SMTP2GO_SEND_URL = "https://api.smtp2go.com/v3/email/send";

export async function sendEmail({
  to,
  subject,
  textBody,
  htmlBody,
}: SendEmailInput) {
  const apiKey = process.env.SMTP2GO_API_KEY;
  const sender = process.env.MAIL_FROM;

  if (!apiKey || !sender) {
    throw new Error(
      "Missing SMTP2GO_API_KEY or MAIL_FROM environment variable.",
    );
  }

  const response = await fetch(SMTP2GO_SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Smtp2go-Api-Key": apiKey,
    },
    body: JSON.stringify({
      api_key: apiKey,
      sender,
      to: [to],
      subject,
      text_body: textBody,
      html_body: htmlBody,
    }),
  });

  const result = await response.json().catch(() => null);

  if (
    !response.ok ||
    result?.data?.succeeded === 0 ||
    result?.result === "error"
  ) {
    throw new Error(
      `SMTP2GO send failed: ${JSON.stringify(result) || response.statusText}`,
    );
  }

  return result;
}

export function getRequiredAppBaseUrl() {
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appBaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL environment variable.");
  }

  return appBaseUrl;
}
