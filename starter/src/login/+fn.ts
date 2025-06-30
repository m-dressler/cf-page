import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

const createToken = async ({
  username,
  appSecret,
}: {
  username: string;
  appSecret: string;
}): Promise<Uint8Array> => {
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
  return jointBuffer;
};

export const onRequestPost: PagesFunction<ENV> = async (context) => {
  const data = await context.request.formData();
  const username = data.get("username");
  const password = data.get("password");
  if (typeof username !== "string" || typeof password !== "string") {
    return new Response(
      "Fields username or password are either missing or invalid strings",
      { status: 400 },
    );
  }

  if (username !== context.env.USERNAME || password !== context.env.PASSWORD) {
    const response = await context.env.ASSETS.fetch("/login");
    const html = await response.text();
    return new Response(html.replaceAll("hidden", "visible"), {
      status: 401,
      headers: response.headers,
    });
  }

  const tokenBuffer = await createToken({
    username,
    appSecret: context.env.APP_SECRET,
  });

  return new Response('{"success":true}', {
    status: 302,
    headers: {
      "Set-Cookie": `cf:auth=${encodeBase64(tokenBuffer)}; HttpOnly; Path=/`,
      Location: "/app",
    },
  });
};
