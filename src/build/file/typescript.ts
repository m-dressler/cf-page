import { bundle, transpile } from "@deno/emit";
import { CONFIG } from "../../config.ts";
import { throwIfAborted } from "../../util/abortError.ts";
import type { FileBuilder } from "./mod.ts";

export default {
  inputExtensions: ["ts", "js"],
  outputExtension: "js",
  build: async (vFile, context) => {
    if (vFile.srcExtension === ".d.ts") {
      return null;
    }

    const url = new URL("file://" + vFile.srcPath);
    if (!CONFIG.bundle) {
      // TODO Sort out how to minify without bundling
      const transpiled = await transpile(url, { allowRemote: true });
      throwIfAborted(context.abortController);
      return transpiled.get(url.href)!;
    } else {
      const { code } = await bundle(url, {
        minify: context.mode === "prod",
        allowRemote: true,
      });
      throwIfAborted(context.abortController);
      return code;
    }
  },
} as const satisfies FileBuilder;
