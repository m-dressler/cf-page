import { CONFIG } from "../../config.ts";
import { throwIfAborted } from "../../util/abortError.ts";
import { bundle } from "../../util/bundle.ts";
import type { FileBuilder } from "./mod.ts";

export default {
  inputExtensions: ["ts", "js"],
  outputExtension: "js",
  build: async (vFile, context) => {
    if (vFile.srcExtension === ".d.ts") {
      return null;
    }

    if (!CONFIG.bundle) {
      const code = await bundle(vFile.srcPath, false);
      throwIfAborted(context.abortController);
      return code;
    } else {
      let code = await bundle(vFile.srcPath, context.mode === "prod");
      throwIfAborted(context.abortController);

      // Post-process to replace npm: specifiers with CDN URLs for browser compatibility
      if (CONFIG.npmToEsm) {
        code = code.replace(
          /(\s+)from(\s*)"npm:([^"]+)"/g,
          '$1from$2"https://esm.sh/$3"',
        );
      }

      return code;
    }
  },
} as const satisfies FileBuilder;
