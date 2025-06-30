import autoprefixer from "autoprefixer";
import cssnanoPlugin from "cssnano";
import postcss from "postcss";
import { compile } from "sass";
import { AbortError } from "../abortError.ts";
import type { FileBuilder } from "./mod.ts";

export default {
  inputExtensions: ["scss", "sass"],
  outputExtension: "css",
  build: async (vFile, context) => {
    const sassResult = compile(vFile.srcPath);
    if (context.abortController?.signal.aborted) throw new AbortError();

    const processor = postcss([
      autoprefixer(),
      // Only minify on prod
      ...(context.mode === "prod" ? [cssnanoPlugin()] : []),
    ]);
    const postCssResult = await processor.process(sassResult.css, {
      from: vFile.srcPath,
    });
    if (context.abortController?.signal.aborted) throw new AbortError();

    for (const warning of postCssResult.warnings()) {
      context.warnings.push(warning.toString());
    }

    return postCssResult.css;
  },
} as const satisfies FileBuilder;
