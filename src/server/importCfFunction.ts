import { join } from "@std/path/join";
import { CONFIG } from "../config.ts";
import { importModule } from "../util/importModule.ts";

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
  if (module instanceof Error) throw module;
  else return module;
};
