import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

export const createToken = async ({
  username,
  appSecret,
}: {
  username: string;
  appSecret: string;
}): Promise<string> => {
  const rawToken = JSON.stringify({ username, ts: Date.now() });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const token = await crypto.subtle.encrypt(
    { name: "AES-GCM", length: 256, iv },
    await crypto.subtle.importKey(
      "raw",
      decodeBase64(appSecret),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    ),
    new TextEncoder().encode(rawToken),
  );
  // Create a joint buffer with the IV and token
  const jointBuffer = new Uint8Array(iv.length + token.byteLength);
  jointBuffer.set(iv, 0);
  jointBuffer.set(new Uint8Array(token), iv.length);
  return encodeBase64(jointBuffer);
};

export const decodeToken = async ({
  token,
  appSecret,
}: {
  token: string;
  appSecret: string;
}): Promise<{ username: string; ts: number } | null> => {
  try {
    const tokenArray = decodeBase64(token);
    const iv = tokenArray.slice(0, 12);
    const tokenEncrypted = tokenArray.slice(12);

    const tokenDecryptedRaw = await crypto.subtle.decrypt(
      { name: "AES-GCM", length: 256, iv },
      await crypto.subtle.importKey(
        "raw",
        decodeBase64(appSecret),
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      ),
      tokenEncrypted,
    );

    const tokenDecrypted = JSON.parse(
      new TextDecoder().decode(tokenDecryptedRaw),
    );
    return tokenDecrypted;
  } catch {
    return null;
  }
};
