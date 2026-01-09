import { throwIfAborted } from "@util/abortError.ts";
import { bufferAsString, toUint8Array } from "@util/buffer.ts";
import { parseMarkdownToHtml } from "@util/markdown.ts";
import { rehype } from "rehype";
import rehypePresetMinify from "rehype-preset-minify";
import rehypeSlug from "rehype-slug";
import { CONFIG } from "../../config.ts";
import { absoluteLinksPlugin } from "./html/absoluteLinksPlugin.ts";
import { cacheBustPlugin } from "./html/cacheBustPlugin.ts";
import { inlinePlugin } from "./html/inlinePlugin.ts";
import { slotPlugin } from "./html/slotPlugin.ts";
import { svelteBlocksPlugin } from "./html/svelteBlocksPlugin.ts";
import { translationPlugin } from "./html/translationPlugin.ts";
import type { FileBuilder } from "./mod.ts";

export default {
  inputExtensions: ["html", ...(CONFIG.markdownToHTML ? ["md"] : [])],
  outputExtension: "html",
  build: async (vFile, context) => {
    let rawHTML = vFile.srcContents != null
      ? bufferAsString(vFile.srcContents)
      : await Deno.readTextFile(vFile.srcPath);
    throwIfAborted(context.abortController);

    if (vFile.srcExtension === "md") rawHTML = parseMarkdownToHtml(rawHTML);

    // Create a fresh processor for processing
    const processor = rehype();

    processor
      .use(slotPlugin, context, vFile)
      .use(svelteBlocksPlugin, context.vfs, vFile)
      .use(inlinePlugin, context, vFile)
      .use(translationPlugin, context, vFile)
      .use(cacheBustPlugin, context)
      .use(rehypeSlug);
    if (CONFIG.absoluteLinks) processor.use(absoluteLinksPlugin, context);
    // Minify only on prod
    if (context.mode === "prod") processor.use(rehypePresetMinify);

    const { value } = await processor.process({
      path: vFile.srcPath,
      value: rawHTML,
    });
    throwIfAborted(context.abortController);

    return typeof value === "string" ? value : toUint8Array(value);
  },
} as const satisfies FileBuilder;
