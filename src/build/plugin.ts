import { exists } from "@std/fs/exists";
import { resolve } from "@std/path/resolve";
import { CONFIG } from "../config.ts";
import { importModule } from "../util/importModule.ts";
import type { BuildContext } from "./file/mod.ts";

/** Allows modifications of the vfs (virtual file system) before or after the build */
export type PluginFunction = (ctx: BuildContext) => void | Promise<void>;

type Plugin = { before?: PluginFunction; after?: PluginFunction };

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

  const { before, after } = result;
  if (!(before || after)) {
    return {
      plugin: {},
      error: new Error("Invalid plugin: please export `before` or `after`"),
    };
  }

  // Ensure `before` and `after` are functions
  if (typeof before !== "function" || typeof after !== "function") {
    const invalid = typeof before !== "function" ? "`before`" : "`after`";
    return {
      plugin: {},
      error: new Error(`Invalid plugin: ${invalid} must be a function`),
    };
  }

  return { plugin: { before, after } as Plugin };
};
