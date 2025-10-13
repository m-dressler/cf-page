import { dirname, resolve } from "jsr:@std/path@1.0.8";
import type { Element, Parent } from "npm:@types/hast@3.0.4";
import { fromHtml } from "npm:hast-util-from-html@2.0.3";
import type { Transformer } from "npm:unified@^11.0.5";
import { visit } from "unist-util-visit";
import { CONFIG } from "../../../config.ts";
import type { VFile } from "../../vfs/mod.ts";
import type { BuildContext } from "../mod.ts";

/** Inlines `script`, `link[rel=stylesheet]`, and `img[svg]` elements when the `inline` prop is present */
export const inlinePlugin =
  (context: BuildContext, vFile: VFile): Transformer => async (tree) => {
    const promises: Promise<void>[] = [];
    const inlineDir = dirname(vFile.srcPath);

    const loadInlineFile = (srcProp: string): Promise<string> => {
      let fsPath: string = "";

      // Check import map first (highest precedence)
      for (const [from, to] of Object.entries(CONFIG.importMap)) {
        if (srcProp.startsWith(from)) {
          fsPath = to + srcProp.substring(from.length);
          break;
        }
      }

      // Fall back to absolute or relative path resolution
      if (!fsPath) {
        if (srcProp.startsWith("/")) fsPath = CONFIG.srcDir + srcProp;
        else fsPath = resolve(inlineDir, srcProp);
      }

      return Deno.readTextFile(fsPath);
    };

    // Inline <img inline src="*.svg" />
    visit(tree, { tagName: "img" }, (node: Element, index, parent: Parent) => {
      if (!("inline" in node.properties)) return;
      if (index === undefined || parent === null) return;

      delete node.properties.inline;
      const { src } = node.properties;
      if (typeof src !== "string") {
        context.warnings.push(
          `Inline image in ${vFile.srcPath}:${node.position?.start.line} has invalid \`src\` attribute (${src})`,
        );
        return;
      }
      if (!src.endsWith(".svg")) {
        context.warnings.push(
          `Inline image in ${vFile.srcPath}:${node.position?.start.line} \`src\` needs to end in \`.svg\``,
        );
        return;
      }

      promises.push(
        loadInlineFile(src).then((svgContent) => {
          const svgTree = fromHtml(svgContent, { fragment: true });
          for (const child of svgTree.children) {
            if (child.type === "element") {
              child.properties = Object.assign(
                child.properties,
                node.properties,
              );
            }
          }
          parent.children.splice(index, 1, ...svgTree.children);
        }).catch((error) => {
          const message = error instanceof Error
            ? error.message
            : String(error);
          context.warnings.push(
            `Failed to inline SVG ${src} in ${vFile.srcPath}:${node.position?.start.line}: ${message}`,
          );
        }),
      );
    });

    // Inline <script inline src="*.js" />
    visit(
      tree,
      { tagName: "script" },
      (node: Element, index, parent: Parent) => {
        if (!("inline" in node.properties)) return;
        if (index === undefined || parent === null) return;

        delete node.properties.inline;
        const { src } = node.properties;
        if (typeof src !== "string") {
          context.warnings.push(
            `Inline script in ${vFile.srcPath}:${node.position?.start.line} has invalid \`src\` attribute (${src})`,
          );
          return;
        }

        promises.push(
          loadInlineFile(src).then((scriptContent) => {
            delete node.properties.src;
            node.children = [{ type: "text", value: scriptContent }];
          }).catch((error) => {
            const message = error instanceof Error
              ? error.message
              : String(error);
            context.warnings.push(
              `Failed to inline script ${src} in ${vFile.srcPath}:${node.position?.start.line}: ${message}`,
            );
          }),
        );
      },
    );

    // Inline <link inline rel="stylesheet" href="*.css" />
    visit(tree, { tagName: "link" }, (node: Element, index, parent: Parent) => {
      if (!("inline" in node.properties)) return;
      if (index === undefined || parent === null) return;

      delete node.properties.inline;
      const { href, rel } = node.properties;
      if (typeof href !== "string") {
        context.warnings.push(
          `Inline link in ${vFile.srcPath}:${node.position?.start.line} has invalid \`href\` attribute (${href})`,
        );
        return;
      }
      if (rel !== "stylesheet") {
        context.warnings.push(
          `Inline link in ${vFile.srcPath}:${node.position?.start.line} must have \`rel="stylesheet"\``,
        );
        return;
      }

      // Delete invalid/unnecessary properties
      delete node.properties.href;
      delete node.properties.rel;

      promises.push(
        loadInlineFile(href).then((cssContent) => {
          parent.children[index] = {
            type: "element",
            tagName: "style",
            properties: node.properties,
            children: [{ type: "text", value: cssContent }],
          };
        }).catch((error) => {
          const message = error instanceof Error
            ? error.message
            : String(error);
          context.warnings.push(
            `Failed to inline stylesheet ${href} in ${vFile.srcPath}:${node.position?.start.line}: ${message}`,
          );
        }),
      );
    });

    await Promise.all(promises);
  };
