import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type MediaStorageResult = {
  provider: "local-public" | "supabase-storage";
  publicPath: string;
};

type SupabaseStorageConfig = {
  bucket: string;
  serviceRoleKey: string;
  url: string;
};

function getSupabaseStorageConfig(): SupabaseStorageConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();

  if (!url && !serviceRoleKey && !bucket) {
    return null;
  }

  if (!url || !serviceRoleKey || !bucket) {
    throw new Error(
      "Supabase media storage is incomplete. Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_MEDIA_BUCKET.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS.");
  }

  return {
    bucket,
    serviceRoleKey,
    url: parsedUrl.origin,
  };
}

function encodeStoragePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function uploadToSupabaseStorage(input: {
  bytes: Buffer;
  config: SupabaseStorageConfig;
  mimeType: string;
  storageKey: string;
}): Promise<MediaStorageResult> {
  const bucketPath = `${encodeURIComponent(input.config.bucket)}/${encodeStoragePath(input.storageKey)}`;
  const response = await fetch(
    `${input.config.url}/storage/v1/object/${bucketPath}`,
    {
      body: new Uint8Array(input.bytes),
      headers: {
        apikey: input.config.serviceRoleKey,
        Authorization: `Bearer ${input.config.serviceRoleKey}`,
        "Content-Type": input.mimeType,
        "x-upsert": "false",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Supabase media upload failed with status ${response.status}. Check the bucket and staging storage credentials.`,
    );
  }

  return {
    provider: "supabase-storage",
    publicPath: `${input.config.url}/storage/v1/object/public/${bucketPath}`,
  };
}

async function uploadToLocalPublicStorage(input: {
  bytes: Buffer;
  fileName: string;
  projectStoragePath: string;
  storageKey: string;
}): Promise<MediaStorageResult> {
  const uploadDirectory = path.join(
    process.cwd(),
    "public",
    input.projectStoragePath,
  );
  const diskPath = path.join(uploadDirectory, input.fileName);

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(diskPath, input.bytes);

  return {
    provider: "local-public",
    publicPath: `/${input.storageKey}`,
  };
}

export function getMediaStorageLabel() {
  try {
    if (getSupabaseStorageConfig()) {
      return "Supabase Storage";
    }
  } catch {
    return "Misconfigured";
  }

  return process.env.NODE_ENV === "production" ? "Not configured" : "Local";
}

export async function uploadMediaObject(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  projectStoragePath: string;
  storageKey: string;
}): Promise<MediaStorageResult> {
  const supabaseConfig = getSupabaseStorageConfig();

  if (supabaseConfig) {
    return uploadToSupabaseStorage({
      bytes: input.bytes,
      config: supabaseConfig,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
    });
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Production media storage is not configured. Add the Supabase Storage environment variables and redeploy.",
    );
  }

  return uploadToLocalPublicStorage(input);
}
