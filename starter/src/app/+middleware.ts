import { decodeToken } from "@lib/server/token.ts";

const parseCookie = (str: string) =>
  str.length
    ? str
      .split(";")
      .map((v) => v.split("="))
      .reduce((acc: { [name: string]: string }, v) => {
        acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(
          v[1].trim(),
        );
        return acc;
      }, {})
    : {};

/** This middleware checks if the user is authenticated for all routes below it */
export const onRequest: PagesFunction<ENV> = async (context) => {
  const cookiesRaw = context.request.headers.get("Cookie");
  const cookies = parseCookie(cookiesRaw || "");
  const token = await decodeToken({
    token: cookies["cf:auth"],
    appSecret: context.env.APP_SECRET,
  });

  // If the user is authenticated and the token hasn't expired (5 minutes)
  if (token && token.ts + 5 * 60_000 > Date.now()) return context.next();
  // If they prefer HTML, redirect to the login page
  else if (context.request.headers.get("Accept")?.includes("text/html")) {
    const response = await context.env.ASSETS.fetch("/401.html");
    return new Response(response.body, {
      status: 401,
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });
  } else {
    return new Response(`Please authenticate to access this page`, {
      status: 401,
    });
  }
};
