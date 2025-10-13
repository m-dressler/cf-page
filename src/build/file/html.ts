import type { ElementContent } from "npm:hast@1.0.0";
import { rehype } from "rehype";
import rehypePresetMinify from "rehype-preset-minify";
import rehypeSlug from "rehype-slug";
import { CONFIG } from "../../config.ts";
import { throwIfAborted } from "../../util/abortError.ts";
import { bufferAsString } from "../../util/buffer.ts";
import { parseMarkdownToHtml } from "../../util/markdown.ts";
import type { TranslationKV } from "../translations.ts";
import type { VFile, VFS } from "../vfs/mod.ts";
import { absoluteLinksPlugin } from "./html/absoluteLinksPlugin.ts";
import { cacheBustPlugin } from "./html/cacheBustPlugin.ts";
import { inlinePlugin } from "./html/inlinePlugin.ts";
import { slotPlugin } from "./html/slotPlugin.ts";
import {
  getTranslationFunction,
  processMixedContent,
  translationPlugin,
} from "./html/translationPlugin.ts";
import type { FileBuilder } from "./mod.ts";

/** Convert HAST nodes to HTML string */
const hastToHtml = (nodes: ElementContent[]): string => {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      } else if (node.type === "element") {
        const attrs = Object.entries(node.properties || {})
          .map(([key, value]) => `${key}="${value}"`)
          .join(" ");
        const attrStr = attrs ? ` ${attrs}` : "";
        const children = hastToHtml(node.children);
        return `<${node.tagName}${attrStr}>${children}</${node.tagName}>`;
      }
      return "";
    })
    .join("");
};

/** Process Svelte-style template blocks in HTML strings */
export const processSvelteBlocks = (
  html: string,
  vfs: VFS,
  vFile: VFile,
): string => {
  const translate = getTranslationFunction(vFile, vfs);
  let processed = html;

  // Process {#each} blocks
  processed = processed.replace(
    /\{#each\s+([^}]+)\s+as\s+(\w+)\}([\s\S]*?)\{\/each\}/g,
    (match, arrayExpr, itemVar, template) => {
      const result = translate(arrayExpr.trim());

      if (Array.isArray(result)) {
        return result
          .map((item) => {
            const variables: TranslationKV = { [itemVar]: item };
            // Use the markdown-aware processing for the template with item substitution
            const hastNodes = processMixedContent(
              template,
              (key) => translate(key, variables),
            );
            return hastToHtml(hastNodes);
          })
          .join("");
      }

      return match; // Return original if not an array
    },
  );

  // Process {#if} blocks with optional {:else}
  processed = processed.replace(
    /\{#if\s+([^}]+)\}([\s\S]*?)(?:\{:else\}([\s\S]*?))?\{\/if\}/g,
    (_, condition, ifContent, elseContent = "") => {
      const result = translate(condition.trim());

      // Evaluate truthiness: non-empty strings, non-empty arrays, true values
      const isTruthy = result !== null &&
        ((typeof result === "string" &&
          result.length > 0 &&
          result !== "false") ||
          (Array.isArray(result) && result.length > 0) ||
          result === true);

      const selectedContent = isTruthy ? ifContent : elseContent;

      // Use the markdown-aware processing for the selected content
      const hastNodes = processMixedContent(selectedContent, translate);
      return hastToHtml(hastNodes);
    },
  );

  return processed;
};

export default {
  inputExtensions: ["html", ...(CONFIG.markdownToHTML ? ["md"] : [])],
  outputExtension: "html",
  build: async (vFile, context) => {
    let rawHTML = vFile.srcContents != null
      ? bufferAsString(vFile.srcContents)
      : await Deno.readTextFile(vFile.srcPath);
    throwIfAborted(context.abortController);

    if (vFile.srcExtension === "md") rawHTML = parseMarkdownToHtml(rawHTML);

    // Process Svelte-style blocks before AST processing (they span multiple elements)
    if (vFile.needsTranslation && vFile.language) {
      rawHTML = processSvelteBlocks(rawHTML, context.vfs, vFile);
    }

    // Create a fresh processor for processing
    // Note: translationPlugin now handles remaining translations and markdown processing
    const processor = rehype();

    processor
      .use(slotPlugin, context, vFile)
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

    return value;
  },
} as const satisfies FileBuilder;
