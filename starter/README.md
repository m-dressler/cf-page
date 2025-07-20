# @md/cf-page Starter

This is your starting point to launching your first Cloudflare Pages page.

Run `deno task dev` to open a live preview of this page.

## Directory structure

- src/ - Contains your website files. Everything but `+fn.ts` and
  `+middleware.ts` files will be a statically hosted asset
- lib/ - Contains any files that shouldn't be part of the final build such as
  imported utility types
- deno.jsonc - Update the `@md/cf-page` key to change your project configuration
- .env - Contains your environment variables. Add your accountId and accessToken
  to leverage bindings

## More details

Visit https://cf-page.mdressler.dev for more info such as deployment.
