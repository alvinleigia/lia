import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENCRYPTED_SECRET_KEY = "$liaEncryptedSecret";
const DEFAULT_KEY_VERSION = 1;

type EncryptedSecretPayload = {
  authenticationTag: string;
  ciphertext: string;
  initializationVector: string;
  keyVersion: number;
};

export type EncryptedSecretEnvelope = {
  [ENCRYPTED_SECRET_KEY]: EncryptedSecretPayload;
};

function getCurrentKeyVersion() {
  const configured = Number(process.env.PROVIDER_SECRETS_KEY_VERSION);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_KEY_VERSION;
}

function getKeyMaterial(keyVersion: number) {
  const versionedKey =
    process.env[`PROVIDER_SECRETS_ENCRYPTION_KEY_V${keyVersion}`];
  const currentKey =
    keyVersion === getCurrentKeyVersion()
      ? process.env.PROVIDER_SECRETS_ENCRYPTION_KEY
      : undefined;
  const source = versionedKey || currentKey || process.env.AUTH_SECRET;

  if (!source) {
    throw new Error(
      "Provider secret encryption requires PROVIDER_SECRETS_ENCRYPTION_KEY or AUTH_SECRET.",
    );
  }

  return createHash("sha256")
    .update(`lia-provider-secrets:v${keyVersion}:${source}`)
    .digest();
}

function isEncryptedSecretPayload(
  value: unknown,
): value is EncryptedSecretPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.authenticationTag === "string" &&
    typeof payload.ciphertext === "string" &&
    typeof payload.initializationVector === "string" &&
    typeof payload.keyVersion === "number" &&
    Number.isInteger(payload.keyVersion) &&
    payload.keyVersion > 0
  );
}

export function isEncryptedSecretEnvelope(
  value: unknown,
): value is EncryptedSecretEnvelope {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isEncryptedSecretPayload(
      (value as Record<string, unknown>)[ENCRYPTED_SECRET_KEY],
    )
  );
}

export function encryptSecretValue(value: string): EncryptedSecretEnvelope {
  const keyVersion = getCurrentKeyVersion();
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getKeyMaterial(keyVersion),
    initializationVector,
  );
  cipher.setAAD(Buffer.from(`lia-secret:v${keyVersion}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    [ENCRYPTED_SECRET_KEY]: {
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      initializationVector: initializationVector.toString("base64"),
      keyVersion,
    },
  };
}

export function decryptSecretValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (!isEncryptedSecretEnvelope(value)) {
    return null;
  }

  const payload = value[ENCRYPTED_SECRET_KEY];
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKeyMaterial(payload.keyVersion),
    Buffer.from(payload.initializationVector, "base64"),
  );
  decipher.setAAD(Buffer.from(`lia-secret:v${payload.keyVersion}`, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.authenticationTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function getEncryptedSecretPayload(envelope: EncryptedSecretEnvelope) {
  return envelope[ENCRYPTED_SECRET_KEY];
}
