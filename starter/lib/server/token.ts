import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import { decrypt, encrypt } from "./crypto.ts";

export const createToken = async ({
  username,
  appSecret,
}: {
  username: string;
  appSecret: string;
}): Promise<string> => {
  const rawToken = JSON.stringify({ username, ts: Date.now() });
  const encrypted = await encrypt({ value: rawToken, secret: appSecret });
  return encodeBase64(encrypted);
};

export const decodeToken = async ({
  token,
  appSecret,
}: {
  token: string;
  appSecret: string;
}): Promise<{ username: string; ts: number } | null> => {
  try {
    const tokenDecryptedRaw = await decrypt({
      value: decodeBase64(token),
      secret: appSecret,
    });
    const tokenDecrypted = JSON.parse(
      new TextDecoder().decode(tokenDecryptedRaw),
    );
    return tokenDecrypted;
  } catch {
    return null;
  }
};
