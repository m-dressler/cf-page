import { ensureDirSync } from "@std/fs/ensure-dir";
import { dirname } from "@std/path/dirname";
import { DatabaseSync } from "node:sqlite";
import { CONFIG } from "../../config.ts";
import { D1DatabaseImpl } from "./d1.ts";

export type Auth = { accountId: string; apiToken: string };

const LOCAL_BINDINGS_DIR = ".bindings.local/";

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
  else {
    return new Error("Cloudflare API Request error", {
      cause: await response.json(),
    });
  }
};

export const loadBindings = (): Record<string, unknown> => {
  const { $mode: bindingMode, ...configBindings } = CONFIG.bindings;
  const bindingEntries = Object.entries(configBindings);
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
        if (bindingMode === "REMOTE") {
          bindings[binding] = new D1DatabaseImpl(id, auth);
        } else {
          const path = `${LOCAL_BINDINGS_DIR}/d1/${id}.sqlite`;
          ensureDirSync(dirname(path));
          bindings[binding] = new DatabaseSync(path);
        }
        break;
      default:
        throw new Error(`Unknown binding type "${type}"`);
    }
  }

  return bindings;
};
