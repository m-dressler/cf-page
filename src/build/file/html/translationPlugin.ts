import type { Element, Node, Parent, Text } from "npm:@types/hast@3.0.4";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";
import { parseMarkdownToHast } from "../../../util/markdown.ts";
import type { TranslationKV, TranslationValue } from "../../translations.ts";
import type { VFile, VFS } from "../../vfs/mod.ts";
import type { BuildContext } from "../mod.ts";

type TranslateFunction = (
  key: string,
  localVariables?: TranslationKV,
) => TranslationValue | null;

/** Gets translation lookup function for current context */
export const getTranslationFunction = (
  vFile: VFile,
  vfs: VFS,
): TranslateFunction => {
  const translations: TranslationKV[] = [];

  const pathParts = vFile.outPath.split("/");
  if (pathParts[1] === vFile.language) pathParts.splice(1, 1);

  // Walk up the directory tree to collect translations
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const path = pathParts.slice(0, i).join("/") || "/";
    const langFileContent = vfs.buildUtils.langFiles[path];

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
  translations.push({
    "cf:lang": vFile.language!,
    "cf:path": vFile.outPath,
    "cf:year": new Date().getFullYear() + "",
  });

  return (key, localVariables) => {
    /** Add any local variables if applicable */
    const translationsLocal = localVariables
      ? [localVariables, ...translations]
      : translations;

    const keyParts = key.split(".");
    for (let translation of translationsLocal) {
      for (let i = 0; i < keyParts.length; ++i) {
        const val = translation[keyParts[i]];
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

/** Process translation variables in text content with markdown detection */
const processTextTranslations = (
  content: string,
  translate: TranslateFunction,
  preserveArrays = false,
): { result: string | (string | TranslationKV)[]; hasMarkdown: boolean } => {
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
  translate: TranslateFunction,
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
      if (!node.properties) return;

      for (const [key, value] of Object.entries(node.properties)) {
        if (typeof value !== "string" || !value.includes("{")) continue;

        const { result } = processTextTranslations(value, translate);
        if (typeof result === "string") node.properties[key] = result;
        else if (Array.isArray(result)) {
          node.properties[key] = result.join("\n");
        }
      }
    });

    return tree;
  };
