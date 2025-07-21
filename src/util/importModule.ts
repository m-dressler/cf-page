import { isError } from "@md/ensure-error/is-error";
import getFileHash from "@md/file-hash";
import { encodeBase64Url } from "@std/encoding/base64url";
import { extname } from "@std/path/extname";

export const importModule = async (
  path: string,
): Promise<Record<string, unknown> | Error> => {
  const hash = await getFileHash(path);
  path = `file://${path}?v=${encodeBase64Url(hash)}${extname(path)}`;
  try {
    return await import(path);
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
