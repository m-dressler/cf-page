export const onRequestGet: PagesFunction<ENV, "username"> = (context) =>
  new Response(context.params.username.toString());
