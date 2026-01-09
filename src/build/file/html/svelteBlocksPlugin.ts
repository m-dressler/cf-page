import type { ElementContent, Root } from "hast";
import { rehype } from "rehype";
import type { Transformer } from "unified";
import type { TranslationKV } from "../../translations.ts";
import type { VFile, VFS } from "../../vfs/mod.ts";
import {
  getTranslationFunction,
  processMixedContent,
} from "./translationPlugin.ts";

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

/**
 * Plugin that processes Svelte-style blocks after layout merging
 * This must run after slotPlugin but before translationPlugin
 */
export const svelteBlocksPlugin =
  (vfs: VFS, vFile: VFile): Transformer => (tree) => {
    if (!vFile.needsTranslation || !vFile.language) return tree;

    // We need to process the string representation of the HAST tree as svelteBlocks become string literals in the tree
    const html = rehype().stringify(tree as Root);

    // Process Svelte blocks on the merged HTML
    const processed = processSvelteBlocks(html, vfs, vFile);

    // Parse the processed HTML and return the new tree
    return rehype().parse({ path: vFile.srcPath, value: processed });
  };
