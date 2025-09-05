import { isError } from "@md/ensure-error/is-error";
import getFileHash from "@md/file-hash";
import { encodeBase64Url } from "@std/encoding/base64url";
import { bundle } from "./bundle.ts";

/** Cache that maps from path to hash to module */
const MODULE_CACHE = new Map<string, Map<string, Record<string, unknown>>>();

/** The maximum amount of revisions that can be kept in the cache per file */
const MAX_CACHE_PER_FILE = 5;

export const importModule = async (
  path: string,
): Promise<Record<string, unknown> | Error> => {
  const hash = encodeBase64Url(await getFileHash(path));
  let fileCache = MODULE_CACHE.get(path);
  if (!fileCache) MODULE_CACHE.set(path, fileCache = new Map());
  const module = fileCache.get(hash);
  if (module) return module;

  try {
    // For development, transpile the module with native deno bundle for import map resolution
    const transpiledCode = await bundle(path, false);
    // Create a data URL with proper encoding and cache busting
    const dataUrl = `data:application/javascript;base64,${
      btoa(transpiledCode)
    }`;
    // Use dynamic import with data URL (cache busting through file hash in transpiled content)
    const module = await import(dataUrl);
    fileCache.set(hash, module);
    // Reduce cache if needed
    if (fileCache.size > MAX_CACHE_PER_FILE) {
      fileCache.delete(fileCache.keys().next().value!);
    }

    return module;
  } catch (error) {
    const baseMessage = `Failed to import module ${path}: `;
    if (isError(error)) {
      error.message = baseMessage + error.message;
      return error;
    } else {
      return new Error(baseMessage + error, {
        cause: error,
      });
    }
  }
};
