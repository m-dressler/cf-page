import { exists } from "@std/fs/exists";
import { resolve } from "@std/path/resolve";
import { importModule } from "@util/importModule.ts";
import { CONFIG } from "../config.ts";
import type { BuildContext } from "./file/mod.ts";

/** Allows modifications of the vfs (virtual file system) before or after the build */
export type PluginFunction = (ctx: BuildContext) => void | Promise<void>;

type Plugin = { before?: PluginFunction; after?: PluginFunction };

const validatePlugin = (module: Record<string, unknown>): Error | null => {
  const baseError = `Invalid plugin ${CONFIG.pluginName}: `;
  // Must have either before or after
  if (!("before" in module || "after" in module)) {
    return new Error(baseError + "export at least one of `before` or `after`");
  }

  for (const key of ["before", "after"] as const) {
    const type = typeof module[key];
    if (key in module && type !== "function") {
      return new Error(
        `${baseError}\`${key}\` must be a function, got \`${type}\``,
      );
    }
  }
  return null;
};

export const loadPlugin = async (): Promise<{
  plugin: Plugin;
  error?: Error;
}> => {
  if (!(await exists(CONFIG.pluginName))) return { plugin: {} };

  const result = await importModule(resolve(CONFIG.pluginName));
  if (result instanceof Error) {
    result.message =
      `Failed to import plugin ${CONFIG.pluginName}: ${result.message}`;
    return { plugin: {}, error: result };
  }

  const validateError = validatePlugin(result);
  if (validateError) return { plugin: {}, error: validateError };
  else {
    return { plugin: { before: result.before, after: result.after } as Plugin };
  }
};
