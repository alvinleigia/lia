import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import {
  type FlowMediaUploadValue,
  isFlowMediaUploadValue,
} from "@/lib/flow-media-values";

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Size not recorded";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }

  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function getRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getMediaCaption(media: FlowMediaUploadValue) {
  const caption = media.metadata?.caption;
  return typeof caption === "string" && caption.trim() ? caption : null;
}

function getWhatsAppMessageId(media: FlowMediaUploadValue) {
  const messageId = media.metadata?.whatsappMessageId;
  return typeof messageId === "string" && messageId.trim() ? messageId : null;
}

export function getPayloadMediaValues(payload: unknown) {
  const mediaValues: Array<{ key: string; media: FlowMediaUploadValue }> = [];

  function visit(value: unknown, path: string[], depth: number) {
    if (depth > 4) {
      return;
    }

    if (isFlowMediaUploadValue(value)) {
      mediaValues.push({
        key: path.join(".") || "media",
        media: value as FlowMediaUploadValue,
      });
      return;
    }

    const record = getRecord(value);
    if (!record) {
      return;
    }

    for (const [key, childValue] of Object.entries(record)) {
      visit(childValue, [...path, key], depth + 1);
    }
  }

  visit(payload, [], 0);

  return mediaValues;
}

export function FlowMediaValueCard({
  children,
  label,
  media,
}: {
  children?: ReactNode;
  label?: string;
  media: FlowMediaUploadValue;
}) {
  const caption = getMediaCaption(media);
  const whatsappMessageId = getWhatsAppMessageId(media);

  return (
    <div className="rounded-md border bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          {label && (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
          )}
          <p className="break-words font-medium">{media.originalName}</p>
          <p className="text-sm text-muted-foreground">
            {media.mediaType} / {media.mimeType}
          </p>
        </div>
        <span className="w-fit rounded-md border px-2 py-1 text-xs capitalize">
          {media.provider ?? "local"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div className="rounded-md bg-gray-50 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Reference
          </p>
          <p className="break-all">
            {media.publicPath || media.providerMediaId || "Not recorded"}
          </p>
        </div>
        <div className="rounded-md bg-gray-50 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Size
          </p>
          <p>{formatBytes(media.sizeBytes)}</p>
        </div>
      </div>

      {caption && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm">
          {caption}
        </p>
      )}

      {whatsappMessageId && (
        <p className="mt-3 break-all text-xs text-muted-foreground">
          WhatsApp message: {whatsappMessageId}
        </p>
      )}

      {media.publicPath && (
        <a
          className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
          href={media.publicPath}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-4 w-4" />
          Open Media
        </a>
      )}

      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function FlowMediaPayloadCards({ payload }: { payload: unknown }) {
  const mediaValues = getPayloadMediaValues(payload);

  if (mediaValues.length === 0) {
    return null;
  }

  return (
    <>
      {mediaValues.map(({ key, media }) => (
        <FlowMediaValueCard key={key} label={key} media={media} />
      ))}
    </>
  );
}
