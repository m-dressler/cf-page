import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";
import { encodeString, toUint8Array } from "@util/buffer.ts";
import { kvResponseToType, type TypeOrOptions } from "./kv.ts";

/** The format of the KV .json files stored to disk */
type StoredKVData = {
  /** Raw data (stored as Base64 on disk) */
  value: Uint8Array<ArrayBuffer>;
  metadata?: unknown;
  /** Unix timestamp in seconds */
  expiration?: number;
};

/** Returns null if {@link thrown} is `Deno.errors.NotFound`, else re-throws {@link thrown} */
const catchNotFound = (thrown: unknown): null => {
  if (thrown instanceof Deno.errors.NotFound) return null;
  throw thrown;
};

/** A local implementation of a {@link KVNamespace} which uses a file per key to store KV pairs */
export class KVNamespaceLocal implements KVNamespace {
  constructor(private path: string) {}

  private getFilePath(key: string): string {
    return `${this.path}${encodeURIComponent(key)}.json`;
  }

  private async writeStoredData(
    filePath: string,
    data: StoredKVData,
  ): Promise<void> {
    const jsonData = {
      value: encodeBase64Url(data.value),
      metadata: data.metadata,
      expiration: data.expiration,
    };
    await Deno.writeTextFile(filePath, JSON.stringify(jsonData), {
      create: true,
    });
  }

  private async readStoredData(filePath: string): Promise<StoredKVData | null> {
    const jsonText = await Deno.readTextFile(filePath).catch(catchNotFound);
    if (jsonText === null) return null;

    const jsonData = JSON.parse(jsonText);
    return {
      value: decodeBase64Url(jsonData.value),
      metadata: jsonData.metadata,
      expiration: jsonData.expiration,
    };
  }

  private isExpired(expiration?: number): boolean {
    return !!expiration && Date.now() > expiration * 1_000;
  }

  public async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    const filePath = this.getFilePath(key);

    let data: Uint8Array<ArrayBuffer>;
    if (value instanceof ReadableStream) {
      const response = new Response(value);
      const arrayBuffer = await response.arrayBuffer();
      data = new Uint8Array(arrayBuffer);
    } else if (typeof value === "string") {
      data = encodeString(value);
    } else if (value instanceof ArrayBuffer) {
      data = new Uint8Array(value);
    } else {
      data = toUint8Array(value);
    }

    let expiration: number | undefined;
    if (options?.expiration) {
      expiration = options.expiration;
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }

    const storedData: StoredKVData = {
      value: data,
      metadata: options?.metadata,
      expiration,
    };

    await this.writeStoredData(filePath, storedData);
  }

  /** @see https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/keys/methods/list/ */
  public async list<Metadata = unknown>(
    options?: KVNamespaceListOptions,
  ): Promise<KVNamespaceListResult<Metadata>> {
    const startIndex = Number(options?.cursor ?? "0");
    const endIndex = startIndex + (options?.limit ?? 1_000);

    // We collect all as order is not guaranteed
    const entries = await Array.fromAsync(Deno.readDir(this.path));

    let files = entries
      .filter((f) => f.isFile && f.name.endsWith(".json"))
      .map((f) => decodeURIComponent(f.name.slice(0, -5))); // Remove .json extension
    const prefix = options?.prefix;
    if (prefix) files = files.filter((f) => f.startsWith(prefix));
    files = files.sort(new Intl.Collator().compare); // Bring into stable order

    const names = files.slice(startIndex, endIndex);
    const keys: KVNamespaceListKey<Metadata>[] = [];

    for (const name of names) {
      const filePath = this.getFilePath(name);
      const storedData = await this.readStoredData(filePath);

      if (storedData && !this.isExpired(storedData.expiration)) {
        keys.push({
          name,
          metadata: storedData.metadata as Metadata,
          expiration: storedData.expiration,
        });
      }
    }

    if (endIndex < files.length) {
      return {
        list_complete: false,
        keys,
        cursor: endIndex.toString(),
        cacheStatus: null,
      } as const;
    } else {
      return {
        list_complete: true,
        keys,
        cacheStatus: null,
      };
    }
  }

  public async get(
    key: string | string[],
    optionsOrType?: TypeOrOptions,
    // deno-lint-ignore no-explicit-any -- Signature is too complex to satisfy typescript
  ): Promise<any> {
    if (Array.isArray(key)) {
      const entries = await Array.fromAsync(key.map(
        async (k) => [k, await this.get(k, optionsOrType)] as const,
      ));
      return new Map(entries);
    }

    const filePath = this.getFilePath(key);
    const storedData = await this.readStoredData(filePath);

    if (!storedData || this.isExpired(storedData.expiration)) {
      // Clean up expired key
      if (storedData && this.isExpired(storedData.expiration)) {
        await this.delete(key).catch((e) =>
          console.error("Error cleaning up expired key:", e)
        );
      }

      return null;
    }

    return kvResponseToType(new Response(storedData.value), optionsOrType);
  }

  public async getWithMetadata(
    key: string | string[],
    optionsOrType?: TypeOrOptions,
    _cacheTtl?: number,
    // deno-lint-ignore no-explicit-any -- Signature is too complex to satisfy typescript
  ): Promise<any> {
    if (Array.isArray(key)) {
      const entries = await Array.fromAsync(key.map(
        async (k) => [k, await this.getWithMetadata(k, optionsOrType)] as const,
      ));
      return new Map(entries);
    }

    const filePath = this.getFilePath(key);
    const storedData = await this.readStoredData(filePath);

    if (!storedData || this.isExpired(storedData.expiration)) {
      // Clean up expired key
      if (storedData && this.isExpired(storedData.expiration)) {
        await this.delete(key).catch((e) =>
          console.error("Error cleaning up expired key:", e)
        );
      }
      return {
        value: null,
        metadata: null,
        cacheStatus: null, // TODO cacheStatus omitted for simplicity
      } satisfies KVNamespaceGetWithMetadataResult<unknown, unknown>;
    }

    const value = await kvResponseToType(
      new Response(storedData.value),
      optionsOrType,
    );
    return {
      value,
      metadata: storedData.metadata,
      cacheStatus: null, // TODO cacheStatus omitted for simplicity
    } satisfies KVNamespaceGetWithMetadataResult<unknown, unknown>;
  }

  public async delete(key: string): Promise<void> {
    await Deno.remove(this.getFilePath(key)).catch(catchNotFound);
  }

  /**
   * Cleanup expired keys from storage.
   * This method should be called periodically to remove expired entries.
   */
  public async cleanupExpiredKeys(): Promise<number> {
    let cleanedCount = 0;

    for await (const entry of Deno.readDir(this.path)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;

      const filePath = this.path + entry.name;
      const storedData = await this.readStoredData(filePath);

      if (storedData && this.isExpired(storedData.expiration)) {
        try {
          await Deno.remove(filePath);
          cleanedCount++;
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    return cleanedCount;
  }
}
