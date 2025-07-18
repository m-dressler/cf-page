import { CONFIG } from "../../config.ts";
import { D1DatabaseImpl } from "./d1.ts";

export type Auth = { accountId: string; apiToken: string };

class MissingEnvError extends Error {
  constructor(public variableName: string, link: `/${string}`) {
    super(
      `You specified \`bindings\` in the config but the environment variable \`${variableName}\` is not set. Add it from https://dash.cloudflare.com${link} to your .env`,
    );
  }
}

export const cloudflareFetch = async <T>(
  path: `/${string}`,
  apiToken: string,
  init: RequestInit = {},
): Promise<T | Error> => {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + apiToken);
  init.headers = headers;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4${path}`,
    init,
  );
  if (response.ok) return response.json();
  else {return new Error("Cloudflare API Request error", {
      cause: await response.json(),
    });}
};

export const loadBindings = (): Record<string, unknown> => {
  const bindingEntries = Object.entries(CONFIG.bindings);
  if (!bindingEntries.length) return {};

  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  if (!accountId) {
    throw new MissingEnvError("CLOUDFLARE_ACCOUNT_ID", "/?to=/:account/pages");
  }

  const apiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
  if (!apiToken) {
    throw new MissingEnvError("CLOUDFLARE_API_TOKEN", "/profile/api-tokens");
  }

  const auth = { accountId, apiToken };

  const bindings: Record<string, unknown> = {};

  for (const [binding, { type, id }] of bindingEntries) {
    bindings[binding] = id;
    switch (type) {
      case "D1":
        bindings[binding] = new D1DatabaseImpl(id, auth);
        break;
      default:
        throw new Error(`Unknown binding type "${type}"`);
    }
  }

  return bindings;
};
