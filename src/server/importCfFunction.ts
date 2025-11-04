import { isError } from "@md/ensure-error/is-error";
import { join } from "@std/path/join";
import { importModule } from "@util/importModule.ts";
import { CONFIG } from "../config.ts";

export const importCfFunction = async (
  path: string,
  type: "function" | "middleware",
) => {
  const srcPath = join(
    CONFIG.srcDir,
    path,
    (type === "function" ? CONFIG.functionName : CONFIG.middlewareName) + `.ts`,
  );
  const module = await importModule(srcPath);
  if (isError(module)) throw module;
  else return module;
};
