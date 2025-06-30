import type { Element, Node, Parent, Root, Text } from "npm:@types/hast@3.0.4";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type Transformer, unified } from "unified";
import { visit } from "unist-util-visit";
import type { BuildContext } from "../mod.ts";

/** Gets translation lookup function for current context */
export const getTranslationFunction = (
  vFile: VFile,
  vfs: VFS,
): (key: string) => string | string[] | boolean | null => {
  const translations: TranslationKV[] = [];

  const pathParts = vFile.outPath.split("/");
  if (pathParts[1] === vFile.language) pathParts.splice(1, 1);

  // Walk up the directory tree to collect translations
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const path = pathParts.slice(0, i).join("/") || "/";
    const langFileContent = vfs.buildUtils.langFiles.get(path);

    if (langFileContent) {
      // Add language-specific translations
      const languageTranslations = langFileContent[vFile.language!];
      if (languageTranslations) {
        translations.push(languageTranslations);
      }

      // Add global translations (fallback)
      const globalTranslations = langFileContent.global;
      if (globalTranslations) {
        translations.push(globalTranslations);
      }
    }
  }

  // Add built-in variables
  translations.push(
    new Map([
      ["cf:lang", vFile.language!],
      ["cf:path", vFile.outPath],
      ["cf:year", new Date().getFullYear() + ""],
    ]),
  );

  return (key: string): string | string[] | boolean | null => {
    const keyParts = key.split(".");
    for (let translation of translations) {
      for (let i = 0; i < keyParts.length; ++i) {
        const val = translation.get(keyParts[i]);
        if (!val) break;

        if (i === keyParts.length - 1) {
          if (typeof val === "string") return val;
          if (Array.isArray(val)) return val;
          if (typeof val === "boolean") return val;
        } else if (
          typeof val !== "string" &&
          !Array.isArray(val) &&
          typeof val !== "boolean"
        ) {
          translation = val;
        } else break;
      }
    }
    return null;
  };
};

/** Convert markdown to HTML elements using remark */
const parseMarkdownToHast = (text: string): (Element | Text)[] => {
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

/** Process translation variables in text content with markdown detection */
const processTextTranslations = (
  content: string,
  translate: (key: string) => string | string[] | boolean | null,
  preserveArrays = false,
): { result: string | string[]; hasMarkdown: boolean } => {
  // Check if this is a simple array lookup that should be preserved
  const simpleArrayMatch = content.match(/^\{([^}]+)\}$/);
  if (simpleArrayMatch && preserveArrays) {
    const result = translate(simpleArrayMatch[1]);
    if (Array.isArray(result)) return { result, hasMarkdown: false };
  }

  let hasMarkdown = false;
  const processed = content.replace(
    /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    (match, expression) => {
      // Check if this is a markdown directive
      const isMarkdownDirective = expression.startsWith("@md ");

      if (isMarkdownDirective) {
        // Extract the key from {@md key}
        const markdownKey = expression.substring(4).trim();
        const result = translate(markdownKey);

        if (typeof result === "string") {
          hasMarkdown = true; // Mark that this content has markdown
          return result;
        } else if (Array.isArray(result)) {
          hasMarkdown = true;
          return result.join("\n");
        } else if (typeof result === "boolean") {
          return result.toString();
        } else {
          return match;
        }
      }

      // Check if this is a parameterized translation like {key, param1: value1, param2: value2}
      const parameterizedMatch = expression.match(/^([\w.]+)\s*,\s*(.+)$/);
      if (parameterizedMatch) {
        const [, translationKey, paramsStr] = parameterizedMatch;
        const baseTranslation = translate(translationKey);

        if (
          !baseTranslation ||
          Array.isArray(baseTranslation) ||
          typeof baseTranslation === "boolean"
        ) {
          return match;
        }

        // Parse parameters
        const args: Record<string, string> = {};
        // Match param: value pairs, handling both "string literals" and {key} references
        const paramRegex = /(\w+):\s*(?:"([^"]*)"|(\{[\w.:]+\})|([^,}]+))/g;
        let paramMatch;

        while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
          const [, paramName, stringValue, bracedValue, plainValue] =
            paramMatch;

          if (stringValue !== undefined) {
            // String literal value
            args[paramName] = stringValue;
          } else if (bracedValue !== undefined) {
            // Translation key reference like {siteName}
            const keyValue = bracedValue.slice(1, -1); // Remove braces
            const argVal = translate(keyValue);
            args[paramName] = typeof argVal === "string"
              ? argVal
              : typeof argVal === "boolean"
              ? String(argVal)
              : keyValue; // Fallback to the key itself
          } else if (plainValue !== undefined) {
            // Plain value (for backwards compatibility or edge cases)
            const trimmed = plainValue.trim();
            // Check if it looks like a braced reference that wasn't caught
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
              const keyValue = trimmed.slice(1, -1);
              const argVal = translate(keyValue);
              args[paramName] = typeof argVal === "string"
                ? argVal
                : typeof argVal === "boolean"
                ? String(argVal)
                : keyValue;
            } else {
              args[paramName] = trimmed;
            }
          }
        }

        // Replace placeholders in translation
        const result = baseTranslation.replace(
          /\{(\w+)\}/g,
          (_, placeholder) => {
            return args[placeholder] || placeholder;
          },
        );

        return result;
      }

      // Simple variable replacement
      const result = translate(expression);
      if (typeof result === "string") {
        return result;
      }
      if (Array.isArray(result)) return result.join("\n");
      if (typeof result === "boolean") return result.toString();
      return match;
    },
  );

  return { result: processed, hasMarkdown };
};

/** Process mixed content with selective markdown parsing */
export const processMixedContent = (
  content: string,
  translate: (key: string) => string | string[] | boolean | null,
): (Element | Text)[] => {
  const elements: (Element | Text)[] = [];
  let currentText = "";
  let position = 0;

  // Function to add accumulated text as a text node
  const addTextNode = () => {
    if (currentText) {
      elements.push({ type: "text", value: currentText });
      currentText = "";
    }
  };

  // Find all translation placeholders and process them individually
  // This regex handles nested braces by matching balanced braces
  const regex = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add any text before this placeholder
    if (match.index > position) {
      currentText += content.slice(position, match.index);
    }

    const [fullMatch, expression] = match;

    // Check if this is a markdown directive
    const isMarkdownDirective = expression.startsWith("@md ");
    let translatedValue: string;
    let forceMarkdown = false;

    if (isMarkdownDirective) {
      // Extract the key from {@md key}
      const markdownKey = expression.substring(4).trim();
      const result = translate(markdownKey);

      if (typeof result === "string") {
        translatedValue = result;
        forceMarkdown = true; // Always process as markdown for @md directive
      } else if (Array.isArray(result)) {
        translatedValue = result.join("\n");
        forceMarkdown = true;
      } else if (typeof result === "boolean") {
        translatedValue = result.toString();
        // Don't force markdown for boolean values
      } else {
        currentText += fullMatch;
        position = regex.lastIndex;
        continue;
      }
    } else {
      // Check if this is a parameterized translation like {key, param1: value1, param2: value2}
      const parameterizedMatch = expression.match(/^([\w.]+)\s*,\s*(.+)$/);

      if (parameterizedMatch) {
        const [, translationKey, paramsStr] = parameterizedMatch;
        const baseTranslation = translate(translationKey);

        if (
          !baseTranslation ||
          Array.isArray(baseTranslation) ||
          typeof baseTranslation === "boolean"
        ) {
          currentText += fullMatch;
          position = regex.lastIndex;
          continue;
        }

        // Parse parameters
        const args: Record<string, string> = {};
        // Match param: value pairs, handling both "string literals" and {key} references
        const paramRegex = /(\w+):\s*(?:"([^"]*)"|(\{[\w.:]+\})|([^,}]+))/g;
        let paramMatch;

        while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
          const [, paramName, stringValue, bracedValue, plainValue] =
            paramMatch;

          if (stringValue !== undefined) {
            // String literal value
            args[paramName] = stringValue;
          } else if (bracedValue !== undefined) {
            // Translation key reference like {siteName}
            const keyValue = bracedValue.slice(1, -1); // Remove braces
            const argVal = translate(keyValue);
            args[paramName] = typeof argVal === "string"
              ? argVal
              : typeof argVal === "boolean"
              ? String(argVal)
              : keyValue; // Fallback to the key itself
          } else if (plainValue !== undefined) {
            // Plain value (for backwards compatibility or edge cases)
            const trimmed = plainValue.trim();
            // Check if it looks like a braced reference that wasn't caught
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
              const keyValue = trimmed.slice(1, -1);
              const argVal = translate(keyValue);
              args[paramName] = typeof argVal === "string"
                ? argVal
                : typeof argVal === "boolean"
                ? String(argVal)
                : keyValue;
            } else {
              args[paramName] = trimmed;
            }
          }
        }

        // Replace placeholders in translation
        translatedValue = baseTranslation.replace(
          /\{(\w+)\}/g,
          (_, placeholder) => {
            return args[placeholder] || placeholder;
          },
        );
      } else {
        // Simple variable replacement
        const result = translate(expression);
        if (typeof result === "string") {
          translatedValue = result;
        } else if (Array.isArray(result)) {
          translatedValue = result.join("\n");
        } else if (typeof result === "boolean") {
          translatedValue = result.toString();
        } else {
          currentText += fullMatch;
          position = regex.lastIndex;
          continue;
        }
      }
    }

    // Only process as markdown if explicitly requested with @md directive
    if (forceMarkdown) {
      // Add any accumulated text first
      addTextNode();

      // Parse just this translation value as markdown
      const markdownNodes = parseMarkdownToHast(translatedValue);
      elements.push(...markdownNodes);
    } else {
      // Add as regular text
      currentText += translatedValue;
    }

    position = regex.lastIndex;
  }

  // Add any remaining text
  if (position < content.length) {
    currentText += content.slice(position);
  }
  addTextNode();

  return elements.length > 0 ? elements : [{ type: "text", value: content }];
};

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

/**
 * Unified translation plugin that handles:
 * 1. Translation variable substitution
 * 2. Markdown parsing for formatted content
 * 3. Element attribute translation
 * Note: Svelte-style blocks are processed at the string level before AST processing
 */
export const translationPlugin =
  (context: BuildContext, vFile: VFile): Transformer => (tree) => {
    if (!vFile.needsTranslation || !vFile.language) {
      return tree;
    }

    const translate = getTranslationFunction(vFile, context.vfs);

    // Process all text nodes for translation variables with selective markdown parsing
    visit(
      tree,
      "text",
      (node: Node & { value?: string }, index: unknown, parent?: Parent) => {
        if (
          !node.value ||
          !parent ||
          !Array.isArray(parent.children) ||
          typeof index !== "number"
        ) {
          return;
        }

        // Process translation variables with mixed content support
        if (node.value.includes("{")) {
          const mixedNodes = processMixedContent(node.value, translate);

          // If we got back multiple nodes or the content changed, replace the text node
          if (
            mixedNodes.length !== 1 ||
            mixedNodes[0].type !== "text" ||
            mixedNodes[0].value !== node.value
          ) {
            parent.children.splice(index, 1, ...mixedNodes);
            return index + mixedNodes.length;
          }
        }
      },
    );

    // Process element attributes for translation variables
    visit(tree, "element", (node: Element) => {
      if (node.properties) {
        for (const [key, value] of Object.entries(node.properties)) {
          if (typeof value === "string" && value.includes("{")) {
            const { result } = processTextTranslations(value, translate);
            if (typeof result === "string") {
              node.properties[key] = result;
            } else if (Array.isArray(result)) {
              node.properties[key] = result.join("\n");
            }
          }
        }
      }
    });

    return tree;
  };
