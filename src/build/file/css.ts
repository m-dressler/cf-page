import tailwindPlugin from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import cssnanoPlugin from "cssnano";
import postcss from "postcss";
import { AbortError } from "../abortError.ts";
import type { FileBuilder } from "./mod.ts";

/** postCSS for tailwind, vendor prefixes, as well as minifying on prod */
export default {
  inputExtensions: ["css"],
  outputExtension: "css",
  build: async (vFile, context) => {
    const css = await Deno.readTextFile(vFile.srcPath);
    if (context.abortController?.signal.aborted) throw new AbortError();

    const processor = postcss([
      tailwindPlugin(),
      autoprefixer(),
      // Only minify on prod
      ...(context.mode === "prod" ? [cssnanoPlugin()] : []),
    ]);

    const result = await processor.process(css, { from: vFile.srcPath });
    if (context.abortController?.signal.aborted) throw new AbortError();

    for (const warning of result.warnings()) {
      context.warnings.push(warning.toString());
    }

    if (context.abortController?.signal.aborted) throw new AbortError();
    return result.css;
  },
} as const satisfies FileBuilder;
