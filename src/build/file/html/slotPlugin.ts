import { throwIfAborted } from "@util/abortError.ts";
import { rehype } from "rehype";
import type { Transformer } from "unified";
import { CONFIG } from "../../../config.ts";
import type { VFile } from "../../vfs/mod.ts";
import type { BuildContext } from "../mod.ts";

/** Extract slot content from HTML string using regex */
const extractSlotContent = (html: string): Map<string, string> => {
  const slots = new Map<string, string>();

  // Match slot elements with their full content, including nested elements
  const slotRegex =
    /<slot(?:\s+name=["']([^"']+)["'])?\s*(?:\/>|>([\s\S]*?)<\/slot>)/gi;
  let match;

  while ((match = slotRegex.exec(html)) !== null) {
    const slotName = match[1] || "default";
    const slotContent = match[2] || "";
    slots.set(slotName, slotContent.trim());
  }

  // Extract content that's not in slots for default slot
  const defaultContent = html.replace(slotRegex, "").trim();
  if (defaultContent && !slots.has("default")) {
    slots.set("default", defaultContent);
  }

  return slots;
};

/** Find the nearest +layout.html file by walking up the directory tree */
const findLayout = async (
  vFile: VFile,
  context: BuildContext,
): Promise<string | null> => {
  const pathParts = vFile.outPath.split("/");
  if (vFile.needsTranslation && pathParts[1] === vFile.language) {
    pathParts.splice(1, 1);
  }
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const path = pathParts.slice(0, i).join("/") || "/";
    if (context.vfs.buildUtils.layouts.has(path)) {
      try {
        return await Deno.readTextFile(
          CONFIG.srcDir + path + "/" + CONFIG.layoutName,
        );
      } catch {
        continue;
      }
    }
  }
  return null;
};

// Replace slots in layout with content from page
const slotRegex =
  /<slot(?:\s+name=["']([^"']+)["'])?\s*(?:\/>|>([\s\S]*?)<\/slot>)/gi;

/** Process slots in layout HTML string with content slots */
const processSlots = (
  layoutHtml: string,
  contentSlots: Map<string, string>,
): string =>
  layoutHtml.replace(
    slotRegex,
    (_, slotName, defaultContent) =>
      // If we have content for this slot, use it; otherwise keep default without the slot tags
      contentSlots.get(slotName || "default") ?? (defaultContent || ""),
  );

/** Custom transformer that processes slots before HTML parsing */
export const slotPlugin =
  (context: BuildContext, vFile: VFile): Transformer => async (tree, file) => {
    const layout = await findLayout(vFile, context);
    if (!layout) return tree;
    throwIfAborted(context.abortController);

    // Get original content HTML string
    const contentHtml = String(file.value);

    // Extract slot content from the page
    const contentSlots = extractSlotContent(contentHtml);
    throwIfAborted(context.abortController);

    // Process slots at string level to preserve structure
    const processedHtml = processSlots(layout, contentSlots);

    // Parse the final HTML and replace the tree
    return rehype().parse({ path: vFile.srcPath, value: processedHtml });
  };
