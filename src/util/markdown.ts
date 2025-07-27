import type { Element, Root, Text } from "npm:@types/hast@3.0.4";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/** Fallback simple markdown parser */
const parseSimpleMarkdown = (text: string): (Element | Text)[] => {
  const elements: { marker: string; element: Element | Text }[] = [];
  let processed = text;

  // Process in order of precedence to avoid conflicts
  // 1. First process code blocks (highest precedence to protect content)
  processed = processed.replace(/`([^`]+)`/g, (_, content) => {
    const marker = `__CODE_${elements.length}_${Math.random()}__`;
    elements.push({
      marker,
      element: {
        type: "element",
        tagName: "code",
        properties: {},
        children: [{ type: "text", value: content }],
      },
    });
    return marker;
  });

  // 2. Process links
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const marker = `__LINK_${elements.length}_${Math.random()}__`;
    elements.push({
      marker,
      element: {
        type: "element",
        tagName: "a",
        properties: { href: url },
        children: [{ type: "text", value: text }],
      },
    });
    return marker;
  });

  // 3. Process bold text (after code and links to avoid conflicts)
  processed = processed.replace(/\*\*(.*?)\*\*/g, (_, content) => {
    const marker = `__BOLD_${elements.length}_${Math.random()}__`;
    elements.push({
      marker,
      element: {
        type: "element",
        tagName: "strong",
        properties: {},
        children: [{ type: "text", value: content }],
      },
    });
    return marker;
  });

  // Split by all markers and rebuild
  const markerRegex = new RegExp(
    `(${
      elements
        .map((e) => e.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")
    })`,
    "g",
  );

  const parts = processed.split(markerRegex);
  const result: (Element | Text)[] = [];

  for (const part of parts) {
    if (part) {
      const element = elements.find((e) => e.marker === part);
      if (element) {
        result.push(element.element);
      } else {
        result.push({ type: "text", value: part });
      }
    }
  }

  return result.length > 0 ? result : [{ type: "text", value: text }];
};

/** Convert markdown to HTML elements using remark */
export const parseMarkdownToHast = (text: string): (Element | Text)[] => {
  try {
    const processor = unified()
      .use(remarkParse) // Parses Markdown to MDAST
      .use(remarkRehype); // Transforms MDAST to HAST

    // Parse markdown and transform to HAST
    const mdastTree = processor.parse(text);
    const hastTree = processor.runSync(mdastTree) as Root;

    // Extract children from the root element
    if (hastTree?.children?.length > 0) {
      // If there's only one paragraph, return its children to avoid unnecessary wrapping
      if (
        hastTree.children.length === 1 &&
        hastTree.children[0].type === "element" &&
        (hastTree.children[0] as Element).tagName === "p"
      ) {
        return (hastTree.children[0] as Element).children as (Element | Text)[];
      }
      return hastTree.children as (Element | Text)[];
    }

    return [{ type: "text", value: text }];
  } catch (error) {
    console.warn(
      "Failed to parse markdown, falling back to simple parser:",
      error,
    );
    // Fallback to simple markdown parsing
    return parseSimpleMarkdown(text);
  }
};

export const parseMarkdownToHtml = (text: string): string => {
  const hastNodes = parseMarkdownToHast(text);
  return unified()
    .use(rehypeStringify)
    .stringify({ type: "root", children: hastNodes } as const satisfies Root);
};
