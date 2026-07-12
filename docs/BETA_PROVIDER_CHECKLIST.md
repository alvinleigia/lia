# Beta Provider Checklist

Status date: 2026-07-12

This checklist is for external services required before a real beta. These
items cannot be fully completed from the local repo alone.

## Database Provider

Choose and confirm:

- Staging database provider and region.
- Production database provider and region.
- pgvector support.
- Automated backup frequency.
- Point-in-time recovery availability.
- Manual backup workflow.
- Restore workflow into staging.

Minimum beta requirement:

- Daily automated backups.
- Manual backup before schema changes.
- One successful restore rehearsal into staging.

## App Hosting

Choose and confirm:

- Staging app URL.
- Production app URL.
- Node.js 20+ runtime.
- Environment variable management.
- Cron or scheduled job support.
- Build command and install command.

Required environment values:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `PLATFORM_ADMIN_EMAILS`
- `CRON_SECRET`
- `UPLOAD_QUEUE_SECRET`
- `SMTP2GO_API_KEY`
- `MAIL_FROM`

## Email Provider

Confirm for SMTP2GO:

- Separate staging and production credentials where possible.
- Sender domain authentication.
- `MAIL_FROM` address.
- Password reset email delivery.
- Company invite email delivery.
- Manual invite link fallback remains visible.

## WhatsApp Provider

Confirm for Meta WhatsApp Business API:

- Separate test/staging phone number where possible.
- App ID and app secret.
- Business account ID.
- Phone number ID.
- Access token storage in project channel config.
- Webhook verify token.
- Webhook callback URL uses public HTTPS.
- Inbound message test reaches the correct project channel.
- Disabled tenant/project behavior blocks runtime use.
- Media URLs are publicly reachable by Meta before testing media sends.

## Object Storage

Production media should not remain on local `public/uploads`.

Choose and confirm:

- Storage provider.
- Bucket/container naming.
- Tenant/project key structure.
- Public or signed URL strategy.
- Retention policy.
- Backup/versioning policy.
- Upload, render, widget and WhatsApp media tests.

## Secrets And Rotation

Before beta:

- Generate a strong production `AUTH_SECRET`.
- Rotate any secret that appeared in screenshots or shared conversations.
- Confirm `PLATFORM_ADMIN_EMAILS` contains only intended SaaS owner emails.
- Keep `.env.local` local and untracked.
- Store staging/production secrets only in the deployment provider.

