import { join } from "@std/path/join";
import { CONFIG } from "../config.ts";

export const importCfFunction = async (
  path: string,
  type: "function" | "middleware",
) => {
  const srcPath = 'file://' + join(
    CONFIG.srcDir,
    path,
    (type === "function" ? CONFIG.functionName : CONFIG.middlewareName) +
      `.ts?v=${Date.now()}.ts`,
  );
  try {
    return await import(srcPath);
  } catch (error) {
    const baseMessage = `Failed to import ${type} at ${srcPath}`;
    if (error instanceof Error) {
      error.message = baseMessage + ": " + error.message;
      throw error;
    } else {
      throw new Error(`Failed to import ${type} at ${srcPath}: ${error}`, {
        cause: error,
      });
    }
  }
};
