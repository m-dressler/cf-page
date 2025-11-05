import type { Transformer } from "unified";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import type { BuildContext } from "../mod.ts";

/** Tags and their attributes to convert to absolute links */
const absoluteLinkTags = {
  script: "src",
  link: "href",
  img: "src",
  source: "src",
  video: "src",
  audio: "src",
  track: "src",
  a: "href",
} as const;

export const absoluteLinksPlugin =
  (context: BuildContext): Transformer => (tree, file) => {
    if (!tree) return;
    const { path: htmlFilePath } = file;
    const htmlVFile = context.vfs.source.get(htmlFilePath)!;

    // Visit all relevant tags and process their attributes
    visit(
      tree,
      "element",
      (
        node: Node & { tagName: string; properties?: { [K: string]: string } },
      ) => {
        const tagName = node.tagName as keyof typeof absoluteLinkTags;
        const attr = absoluteLinkTags[tagName];
        if (!attr || !node.properties?.[attr]) return;

        const src = node.properties[attr];
        if (!(src.startsWith("./") || src.startsWith("../"))) return;

        try {
          const url = new URL(src, "http://example.com" + htmlVFile.outPath);
          node.properties[attr] = url.pathname;
        } catch {
          context.warnings.push(
            `Absolute Link (${htmlFilePath}): Invalid ${tagName} ${attr} URL (${src})`,
          );
        }
      },
    );
  };
