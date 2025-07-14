import { bundle, transpile } from "@deno/emit";
import { encodeBase64 } from "@std/encoding/base64";
import { CONFIG } from "../../config.ts";
import { AbortError } from "../abortError.ts";
import type { FileBuilder } from "./mod.ts";

export default {
  inputExtensions: ["ts", "js"],
  outputExtension: "js",
  build: async (vFile, context) => {
    if (vFile.srcExtension === ".d.ts") {
      return null;
    }

    const url = new URL("file://" + vFile.srcPath);
    if (context.abortController?.signal.aborted) throw new AbortError();
    const transpiled = await transpile(url, { allowRemote: true });
    if (context.abortController?.signal.aborted) throw new AbortError();
    const jsCode = transpiled.get(url.href)!;

    // TODO Sort out how to minify without bundling
    if (!CONFIG.bundle) return jsCode; // Respect config bundling rules

    const jsCodeBase64 = encodeBase64(jsCode);
    const { code } = await bundle(
      `data:application/javascript;base64,${jsCodeBase64}`,
      { minify: context.mode === "prod" }
    );
    if (context.abortController?.signal.aborted) throw new AbortError();

    return code;
  },
} as const satisfies FileBuilder;
