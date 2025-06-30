import { encodeBase64Url } from "@std/encoding/base64url";
import type { Node } from "npm:@types/unist@3.0.3";
import type { Transformer } from "npm:unified@^11.0.5";
import { visit } from "unist-util-visit";
import { CONFIG } from "../../../config.ts";
import type { BuildContext } from "../mod.ts";

/** Tags and their attributes to cache bust */
const cacheBustTags = {
  script: "src",
  link: "href",
  img: "src",
  source: "src",
  video: "src",
  audio: "src",
  track: "src",
} as const;

export const cacheBustPlugin =
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
        const tagName = node.tagName as keyof typeof cacheBustTags;
        const attr = cacheBustTags[tagName];
        if (!attr || !node.properties?.[attr]) return;

        const src = node.properties[attr];

        if (
          // Handle root path but not same scheme path (https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/URI_syntax_diagram.svg/2136px-URI_syntax_diagram.svg.png)
          (src.startsWith("/") && !src.startsWith("//")) ||
          src.startsWith("./") ||
          src.startsWith("../")
        ) {
          let url: URL;
          try {
            url = new URL(src, "http://example.com" + htmlVFile.outPath);
          } catch {
            context.warnings.push(
              `Cache Bust (${htmlFilePath}): Invalid ${tagName} ${attr} URL (${src})`,
            );
            return;
          }

          // TODO for incremental rebuilds, get as dependent
          const buildVFile = context.vfs.build.get(url.pathname);
          if (buildVFile) {
            url.searchParams.set("v", encodeBase64Url(buildVFile.srcHash));
          } else {
            const sourceVFile = context.vfs.source.get(
              CONFIG.srcDir + url.pathname,
            );
            if (sourceVFile) {
              url.searchParams.set("v", encodeBase64Url(sourceVFile.srcHash));
              // We also need to update the correct output path
              url.pathname = sourceVFile.outPath;
            } else {
              url.searchParams.set("v", "NaN");
            }
          }
          node.properties[attr] = url.pathname + url.search;
        }
      },
    );
  };
