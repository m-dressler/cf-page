import { exists } from "@std/fs/exists";
import * as JSONC from "@std/jsonc";
import { resolve } from "@std/path/resolve";
import { z } from "zod/v4";

/** The key in `deno.json` used to configure @md/cf-page */
const CONFIG_KEY = "@md/cf-page";

/** The type for the configuration which gets loaded from `deno.json` */
const CONFIG_SCHEMA = z.object({
  port: z.number().int().positive().default(3000),
  /** The directory containing the source files (absolute path) */
  srcDir: z
    .string()
    .transform((val) => resolve(val))
    .prefault("./src"),
  /** The directory to put the built file into (absolute path) */
  outDir: z
    .string()
    .transform((val) => resolve(val))
    .prefault("./dist"),
  /** Whether to bundle the final TypeScript/JavaScript scripts */
  bundle: z.boolean().default(true),
  index: z.string().default("index.html"),
  /** The file name for CloudFlare functions */
  functionName: z.string().default("+fn"),
  /** The file name for CloudFlare middlewares */
  middlewareName: z.string().default("+middleware"),
  /** The file name for HTML layouts */
  layoutName: z.string().default("+layout.html"),
  /** The file name for language files (must be YAML) */
  langfileName: z.string().default("+lang.yml"),
  /** The file name for the custom plugin loader */
  pluginName: z.string().default("+plugin.ts"),
  /** Other directories for which changes should rebuild the dev server */
  watchDirs: z
    .array(z.string())
    .transform((dirs) => dirs.map((dir) => resolve(dir)))
    .default([]),
  /** Any bindings that should be provided {@see https://developers.cloudflare.com/pages/functions/bindings/} */
  bindings: z
    .record(z.string(), z.object({ type: z.enum(["D1"]), id: z.uuid() }))
    .default({}),
  /** Glob patterns to match files that should NOT be part of the final output */
  ignore: z.array(z.string()).default(["**/.DS_Store"]),
});

let denoJson: unknown;
if (await exists("./deno.jsonc")) {
  denoJson = JSONC.parse(await Deno.readTextFile("./deno.jsonc")) ?? {};
} else if (await exists("./deno.json")) {
  denoJson = JSON.parse(await Deno.readTextFile("./deno.json")) ?? {};
} else denoJson = {};

if (typeof denoJson !== "object" || !denoJson) {
  throw new Error("deno.json(c) must be an object");
}

const loadedConfig = CONFIG_KEY in denoJson ? denoJson[CONFIG_KEY] : {};

/** The global configuration for this package */
export const CONFIG = CONFIG_SCHEMA.parse(loadedConfig);
