export const onRequestPost: PagesFunction = () =>
  new Response('{"success":true}', {
    status: 302,
    headers: {
      "Set-Cookie": "cf:auth=; HttpOnly; Path=/",
      Location: "/login",
    },
  });
