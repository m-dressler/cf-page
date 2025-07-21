import type { ElementContent } from "npm:hast@1.0.0";
import { rehype } from "rehype";
import rehypePresetMinify from "rehype-preset-minify";
import rehypeSlug from "rehype-slug";
import { AbortError } from "../abortError.ts";
import type { VFile, VFS } from "../vfs/mod.ts";
import { cacheBustPlugin } from "./html/cacheBustPlugin.ts";
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
const processSvelteBlocks = (html: string, vfs: VFS, vFile: VFile): string => {
  const translate = getTranslationFunction(vFile, vfs);
  let processed = html;

  // Process {#each} blocks
  processed = processed.replace(
    /\{#each\s+([^}]+)\s+as\s+(\w+)\}([\s\S]*?)\{\/each\}/g,
    (match, arrayExpr, itemVar, template) => {
      const result = translate(arrayExpr.trim());

      if (Array.isArray(result)) {
        return result
          .map((item: string) => {
            // Use the markdown-aware processing for the template with item substitution
            const hastNodes = processMixedContent(
              template,
              (key) => key === itemVar ? item : translate(key),
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
  inputExtensions: ["html"],
  outputExtension: "html",
  build: async (vFile, context) => {
    let rawHTML = vFile.srcContents ?? (await Deno.readTextFile(vFile.srcPath));
    if (context.abortController?.signal.aborted) throw new AbortError();

    // Process Svelte-style blocks before AST processing (they span multiple elements)
    if (vFile.needsTranslation && vFile.language) {
      rawHTML = processSvelteBlocks(rawHTML, context.vfs, vFile);
    }

    // Create a fresh processor for processing
    // Note: translationPlugin now handles remaining translations and markdown processing
    const processor = rehype()
      .use(slotPlugin, context, vFile)
      .use(translationPlugin, context, vFile)
      .use(cacheBustPlugin, context)
      .use(rehypeSlug);
    // Minify only on prod
    if (context.mode === "prod") processor.use(rehypePresetMinify);

    const { value } = await processor.process({
      path: vFile.srcPath,
      value: rawHTML,
    });
    if (context.abortController?.signal.aborted) throw new AbortError();

    return value;
  },
} as const satisfies FileBuilder;
