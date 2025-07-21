import { decodeBase64 } from "jsr:@std/encoding/base64";

const ALGORITHM = "AES-GCM";

/**
 * @param params
 * @param params.value The value to encrypt
 * @param params.secret The Base64 encoded secret to encrypt the `value` with
 *
 * @returns The encrypted value
 */
export const encrypt = async ({
  value,
  secret,
}: {
  value: string | BufferSource;
  secret: string;
}): Promise<Uint8Array> => {
  // Convert to BufferSource to for crypto
  if (typeof value === "string") value = new TextEncoder().encode(value);

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64(secret),
    ALGORITHM,
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, length: 256, iv },
    key,
    value,
  );

  // Create a joint buffer with the IV and token
  const jointBuffer = new Uint8Array(iv.length + encrypted.byteLength);
  jointBuffer.set(iv, 0);
  jointBuffer.set(new Uint8Array(encrypted), iv.length);
  return jointBuffer;
};

/**
 * @param params
 * @param params.value The value to decrypt
 * @param params.secret The Base64 encoded secret to decrypt `value` with
 *
 * @returns The decrypted value
 */
export const decrypt = async ({
  value,
  secret,
}: {
  value: Uint8Array;
  secret: string;
}) => {
  const iv = value.slice(0, 12);
  const tokenEncrypted = value.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", length: 256, iv },
    await crypto.subtle.importKey(
      "raw",
      decodeBase64(secret),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    ),
    tokenEncrypted,
  );

  return decrypted;
};
