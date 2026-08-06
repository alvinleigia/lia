import { expect, test } from "@playwright/test";
import { uploadMediaObject } from "../../src/lib/media-storage";

const storageEnvKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_MEDIA_BUCKET",
] as const;

const originalStorageEnv = Object.fromEntries(
  storageEnvKeys.map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;

  for (const key of storageEnvKeys) {
    const value = originalStorageEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("Supabase media storage uploads privately and returns a public URL", async () => {
  process.env.SUPABASE_URL = "https://project-ref.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "private-service-role-key";
  process.env.SUPABASE_MEDIA_BUCKET = "lia-media";

  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({ Key: "uploaded" }), { status: 200 });
  };

  const result = await uploadMediaObject({
    bytes: Buffer.from("test image"),
    fileName: "test image.png",
    mimeType: "image/png",
    projectStoragePath: "uploads/media/14",
    storageKey: "uploads/media/14/test image.png",
  });

  const [request] = requests;
  expect(request).toBeDefined();
  expect(request?.input).toBe(
    "https://project-ref.supabase.co/storage/v1/object/lia-media/uploads/media/14/test%20image.png",
  );
  expect(request?.init?.method).toBe("POST");
  expect(request?.init?.headers).toMatchObject({
    apikey: "private-service-role-key",
    Authorization: "Bearer private-service-role-key",
    "Content-Type": "image/png",
    "x-upsert": "false",
  });
  expect(result).toEqual({
    provider: "supabase-storage",
    publicPath:
      "https://project-ref.supabase.co/storage/v1/object/public/lia-media/uploads/media/14/test%20image.png",
  });
});

test("partial Supabase media configuration fails before upload", async () => {
  process.env.SUPABASE_URL = "https://project-ref.supabase.co";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_MEDIA_BUCKET;

  await expect(
    uploadMediaObject({
      bytes: Buffer.from("test image"),
      fileName: "test.png",
      mimeType: "image/png",
      projectStoragePath: "uploads/media/14",
      storageKey: "uploads/media/14/test.png",
    }),
  ).rejects.toThrow("Supabase media storage is incomplete");
});

test("Supabase upload errors do not expose provider response bodies", async () => {
  process.env.SUPABASE_URL = "https://project-ref.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "private-service-role-key";
  process.env.SUPABASE_MEDIA_BUCKET = "lia-media";
  globalThis.fetch = async () =>
    new Response("private provider details", { status: 403 });

  await expect(
    uploadMediaObject({
      bytes: Buffer.from("test image"),
      fileName: "test.png",
      mimeType: "image/png",
      projectStoragePath: "uploads/media/14",
      storageKey: "uploads/media/14/test.png",
    }),
  ).rejects.toThrow("Supabase media upload failed with status 403");
});
