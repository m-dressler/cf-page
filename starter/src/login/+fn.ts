import { createToken } from "../../lib/server/token.ts";

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

  const token = await createToken({
    username,
    appSecret: context.env.APP_SECRET,
  });

  return new Response('{"success":true}', {
    status: 302,
    headers: {
      "Set-Cookie": `cf:auth=${token}; HttpOnly; Path=/`,
      Location: "/app",
    },
  });
};
