import { isError } from "@md/ensure-error/is-error";
import { type Auth, cloudflareFetch } from "./mod.ts";

export type TypeOrOptions =
  | "text"
  | "json"
  | "arrayBuffer"
  | "stream"
  | Partial<KVNamespaceGetOptions<undefined>>
  | KVNamespaceGetOptions<"text" | "json" | "arrayBuffer" | "stream">;

type KVResult<T> = {
  result: T;
  success: boolean;
  errors: unknown[];
  messages: unknown[];
};

/** The Cloudflare KV error code for when a key doesn't exist */
const KEY_NOT_FOUND_CODE = 10009;

/** Converts a {@link Response} to the expected {@link TypeOrOptions} requested  */
export const kvResponseToType = async (
  response: Response,
  options?: TypeOrOptions,
): Promise<string | ArrayBuffer | ReadableStream | null> => {
  const type = typeof options === "string" ? options : options?.type ?? "text";
  switch (type) {
    case "stream":
      return response.body;
    case "arrayBuffer":
      return await response.arrayBuffer();
    case "json":
      return await response.json();
    default:
      return await response.text();
  }
};

const toMap = <A extends string | number | symbol, B>(
  record: Record<A, B>,
): Map<A, B> => new Map<A, B>(Object.entries(record) as Iterable<[A, B]>);

/**
 * Implements the KV binding
 *
 * @see https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/
 */
export class KVNamespaceImpl implements KVNamespace {
  public id: string;

  constructor(id: string, public auth: Auth) {
    this.id = id.replaceAll("-", ""); // KV uses a UUID without dashes
  }

  private async request<T>(path: `/${string}`, init?: RequestInit): Promise<T> {
    const result = await cloudflareFetch<T>(
      `/accounts/${this.auth.accountId}/storage/kv/namespaces/${this.id}${path}`,
      this.auth.apiToken,
      init,
    );
    if (isError(result)) throw result;
    return result;
  }

  private async bulkGet(
    keys: string[],
    optionsOrType: TypeOrOptions | undefined,
    withMetadata: boolean,
  ): Promise<Map<string, unknown>> {
    const body = {
      keys,
      withMetadata,
      type: optionsOrType && typeof optionsOrType !== "string"
        ? optionsOrType.type
        : optionsOrType,
    };

    const response = await this.request<
      KVResult<{ values: { [key: string]: unknown } }>
    >(`/bulk/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.success) return toMap<string, unknown>(response.result.values);
    else throw new Error("Cloudflare KV bulk-get failed", { cause: response });
  }

  public async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    const searchParams = new URLSearchParams();
    if (options?.expiration) {
      searchParams.set("expiration", options.expiration.toString());
    }
    if (options?.expirationTtl) {
      searchParams.set("expiration_ttl", options.expirationTtl.toString());
    }

    let body: FormData | typeof value = value;
    // If we have metadata, we instead need to convert the body to FormData
    if (options?.metadata) {
      body = new FormData();
      body.set("metadata", JSON.stringify(options.metadata));
      if (typeof value === "string") body.set("value", value);
      else if (value instanceof ReadableStream) {
        body.set("value", await new Response(value).blob());
      } else {
        body.set(
          "value",
          new Blob([value], { type: "application/octet-stream" }),
        );
      }
    }

    const response = await this.request<KVResult<null>>(
      `/values/${encodeURIComponent(key)}?${searchParams}`,
      { method: "PUT", body },
    );
    if (!response.success) {
      throw new Error("Cloudflare KV put failed", { cause: response });
    }
  }

  /** @see https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/keys/methods/list/ */
  public async list<Metadata = unknown>(
    options?: KVNamespaceListOptions,
  ): Promise<KVNamespaceListResult<Metadata>> {
    const searchParams = new URLSearchParams();
    if (options?.prefix) searchParams.set("prefix", options.prefix);
    if (options?.limit) searchParams.set("limit", options.limit.toString());
    if (options?.cursor) searchParams.set("cursor", options.cursor);

    const response = await this.request<
      KVResult<KVNamespaceListKey<Metadata>[]> & {
        result_info: { count: number; cursor?: string };
      }
    >(
      `/keys${searchParams}`,
    );

    if (!response.success) {
      throw new Error("Cloudflare KV list failed", { cause: response });
    }

    const { cursor } = response.result_info;
    if (cursor) {
      return {
        list_complete: false,
        keys: response.result,
        cursor,
        cacheStatus: null, // TODO cacheStatus omitted for simplicity
      };
    } else {
      return {
        list_complete: true,
        keys: response.result,
        cacheStatus: null, // TODO cacheStatus omitted for simplicity
      };
    }
  }

  public async get(
    key: string | string[],
    optionsOrType?: TypeOrOptions,
    // deno-lint-ignore no-explicit-any -- Signature is too complex to satisfy typescript
  ): Promise<any> {
    if (Array.isArray(key)) return this.bulkGet(key, optionsOrType, false);

    try {
      const response = await this.request<Response>(
        `/values/${encodeURIComponent(key)}`,
      );
      return kvResponseToType(response, optionsOrType);
    } catch (e) {
      if (
        !(
          isError(e) &&
          e.cause &&
          typeof e.cause === "object" &&
          "errors" in e.cause &&
          Array.isArray(e.cause.errors) &&
          e.cause.errors.length === 1
        )
      ) throw e;
      const [error] = e.cause.errors;
      if (error.code === KEY_NOT_FOUND_CODE) return null;
      else throw e;
    }
  }

  public async getWithMetadata(
    key: string | string[],
    optionsOrType?: TypeOrOptions,
    // deno-lint-ignore no-explicit-any -- Signature is too complex to satisfy typescript
  ): Promise<any> {
    if (Array.isArray(key)) return this.bulkGet(key, optionsOrType, true);

    const valuePromise = this.get(key, optionsOrType);
    const metaDataResponse = await this.request<KVResult<unknown>>(
      `/metadata/${encodeURIComponent(key)}`,
    );
    const value = await valuePromise;

    if (!metaDataResponse.success) {
      throw new Error("Cloudflare KV getWithMetadata failed", {
        cause: metaDataResponse,
      });
    }

    return {
      value,
      metadata: metaDataResponse.result,
      cacheStatus: null, // TODO cacheStatus omitted for simplicity
    } satisfies KVNamespaceGetWithMetadataResult<unknown, unknown>;
  }

  public async delete(key: string): Promise<void> {
    await this.request<Response>(`/values/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }
}
