export type FlowMediaUploadValue = {
  mediaAssetId?: number | null;
  mediaType: string;
  mimeType: string;
  originalName: string;
  provider?: "local" | "whatsapp";
  providerMediaId?: string | null;
  publicPath?: string | null;
  sizeBytes?: number | null;
  metadata?: Record<string, unknown>;
};

export function isFlowMediaUploadValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<FlowMediaUploadValue>;

  const hasReference =
    typeof record.mediaAssetId === "number" ||
    (typeof record.providerMediaId === "string" &&
      record.providerMediaId.trim().length > 0) ||
    (typeof record.publicPath === "string" &&
      record.publicPath.trim().length > 0);

  return (
    hasReference &&
    typeof record.mediaType === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.originalName === "string"
  );
}

export function formatFlowMediaUploadValue(value: unknown) {
  if (!isFlowMediaUploadValue(value)) {
    return String(value);
  }

  const media = value as FlowMediaUploadValue;
  const reference = media.publicPath || media.providerMediaId || media.provider;

  return reference
    ? `${media.originalName} (${reference})`
    : media.originalName;
}
