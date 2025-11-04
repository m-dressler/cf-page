import tailwindPlugin from "@tailwindcss/postcss";
import { throwIfAborted } from "@util/abortError.ts";
import { bufferAsString } from "@util/buffer.ts";
import autoprefixer from "autoprefixer";
import cssnanoPlugin from "cssnano";
import postcss from "postcss";
import type { FileBuilder } from "./mod.ts";

/** postCSS for tailwind, vendor prefixes, as well as minifying on prod */
export default {
  inputExtensions: ["css"],
  outputExtension: "css",
  build: async (vFile, context) => {
    const css = vFile.srcContents != null
      ? bufferAsString(vFile.srcContents)
      : await Deno.readTextFile(vFile.srcPath);
    throwIfAborted(context.abortController);

    const processor = postcss([
      tailwindPlugin(),
      autoprefixer(),
      // Only minify on prod
      ...(context.mode === "prod" ? [cssnanoPlugin()] : []),
    ]);

    const result = await processor.process(css, { from: vFile.srcPath });
    throwIfAborted(context.abortController);

    for (const warning of result.warnings()) {
      context.warnings.push(warning.toString());
    }

    throwIfAborted(context.abortController);
    return result.css;
  },
} as const satisfies FileBuilder;
