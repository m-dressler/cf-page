import { ensureDirSync } from "@std/fs/ensure-dir";
import { dirname } from "@std/path/dirname";
import { CONFIG } from "../../config.ts";
import { D1DatabaseLocal } from "./d1-local.ts";
import { D1DatabaseImpl } from "./d1.ts";
import { KVNamespaceLocal } from "./kv-local.ts";
import { KVNamespaceImpl } from "./kv.ts";

export type Auth = { accountId: string; apiToken: string };

const LOCAL_BINDINGS_DIR = ".bindings.local/";

class MissingEnvError extends Error {
  constructor(public variableName: string, link: `/${string}`) {
    super(
      `You specified \`bindings\` in the config but the environment variable \`${variableName}\` is not set. Add it from https://dash.cloudflare.com${link} to your .env`,
    );
  }
}

/** An fetch error while trying to request a Cloudflare resource (see {@link cloudflareFetch}) */
class CloudflareFetchError extends Error {
  /**
   * @param path The URL path that was requested
   * @param init The request payload
   * @param status The response HTTP status
   * @param body The response body (either parsed JSON or plaintext)
   */
  private constructor(
    public path: string,
    public init: RequestInit,
    public status: number,
    public body: unknown,
  ) {
    super(`Cloudflare API Request error`, {
      cause: {
        path,
        init,
        status,
        body,
      },
    });
    this.name = "CloudflareFetchError";
  }

  /**
   * Converts a failed response into a {@link CloudflareFetchError}
   *
   * @param path The URL path that was requested
   * @param init The request payload
   * @param response The failed response
   */
  static async create(
    path: string,
    init: RequestInit,
    response: Response,
  ): Promise<CloudflareFetchError> {
    const isJsonResponse = response.headers.get("content-type")?.includes(
      "application/json",
    );
    const body = await (isJsonResponse ? response.json() : response.text());
    init = structuredClone(init);
    const headers = new Headers(init.headers ?? {});
    headers.delete("authorization");
    init.headers = Object.fromEntries(headers.entries());
    return new CloudflareFetchError(path, init, response.status, body);
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
  if (!response.ok) return CloudflareFetchError.create(path, init, response);
  else if (
    response.headers.get("Content-Type")?.includes("application/json")
  ) {
    return response.json();
  } else return response as T;
};

export const loadBindings = (): Record<string, unknown> => {
  const localBindings = Deno.env.get("CLOUDFLARE_LOCAL") === "true";
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
        if (!localBindings) {
          bindings[binding] = new D1DatabaseImpl(id, auth);
        } else {
          const path = `${LOCAL_BINDINGS_DIR}/d1/${id}.sqlite`;
          ensureDirSync(dirname(path));
          bindings[binding] = new D1DatabaseLocal(path);
        }
        break;
      case "KV":
        if (!localBindings) {
          bindings[binding] = new KVNamespaceImpl(id, auth);
        } else {
          const path = `${LOCAL_BINDINGS_DIR}/kv/${id}/`;
          ensureDirSync(path);
          bindings[binding] = new KVNamespaceLocal(path);
        }
        break;
      default:
        throw new Error(`Unknown binding type "${type}"`);
    }
  }

  return bindings;
};
