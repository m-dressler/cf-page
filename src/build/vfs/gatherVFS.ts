import getFileHash from "@md/file-hash";
import { walk } from "@std/fs/walk";
import { SEPARATOR } from "@std/path/constants";
import { globToRegExp } from "@std/path/glob-to-regexp";
import { parse } from "@std/path/parse";
import { parse as parseYaml } from "@std/yaml";
import { CONFIG } from "../../config.ts";
import { FILE_BUILDERS } from "../file/mod.ts";
import {
  getDefaultLanguage,
  getSupportedLanguages,
  isMultiLanguageEnabled,
  type LangFileContent,
  type TranslationKV,
} from "../translations.ts";
import { VFile, VFS } from "./mod.ts";

/** Converts an array of glob strings to a single RegExp to test paths against */
const globsToRegExp = (globs: string[]): RegExp | null => {
  if (!globs.length) return null;

  // Convert each glob to a RegExp and get its source string.
  const regexParts = globs.map(
    (glob) => globToRegExp(glob).source.slice(1, -1), // Remove the `^` from the start and `$` from the end of each source string for
  );
  // 3. Join the parts with `|` (OR) and wrap them in a non-capturing group `(?:...)`.
  // 4. Add `^` and `$` to ensure the new RegExp matches the entire path.
  return new RegExp(`^(?:${regexParts.join("|")})$`);
};

/** Loads all files from the source directory with their computed hash */
export const gatherVFS = async (): Promise<VFS> => {
  const vfs = new VFS();

  const multiLanguageEnabled = await isMultiLanguageEnabled();
  const supportedLanguages = multiLanguageEnabled
    ? await getSupportedLanguages()
    : [];
  const defaultLanguage = await getDefaultLanguage();

  const ignoreRegex = globsToRegExp(CONFIG.ignore);

  try {
    const SRC_DIR_PATH_LEN = CONFIG.srcDir.length;
    for await (const file of walk(CONFIG.srcDir, { includeDirs: false })) {
      /** The relative path */
      const relPath = file.path.substring(SRC_DIR_PATH_LEN);
      if (!file.isFile || ignoreRegex?.test(relPath)) continue;

      const pathMeta = parse(relPath);

      if (pathMeta.name === CONFIG.functionName) {
        vfs.functions.add(pathMeta.dir);
      } else if (pathMeta.name === CONFIG.middlewareName) {
        vfs.middlewares.add(pathMeta.dir);
      } else if (pathMeta.base === CONFIG.layoutName) {
        vfs.buildUtils.layouts.add(pathMeta.dir);
      } else if (pathMeta.base === CONFIG.langfileName) {
        const langFileContent = await Deno.readTextFile(file.path);
        const parsed = parseYaml(langFileContent);
        if (!parsed || typeof parsed !== "object") {
          throw new Error(`Invalid YAML format in language file: ${file.path}`);
        }

        const langFileData: LangFileContent = {};

        // Recursive function to parse nested YAML objects into nested Maps
        const parseNestedTranslations = (
          obj: Record<string, unknown>,
        ): TranslationKV => {
          const translationMap = new Map<
            string,
            string | string[] | TranslationKV
          >();

          for (const [key, value] of Object.entries(obj)) {
            if (typeof value === "string") {
              translationMap.set(key, value);
            } else if (Array.isArray(value)) {
              // Preserve arrays as arrays instead of joining them
              translationMap.set(key, value);
            } else if (typeof value === "object" && value !== null) {
              // Recursively parse nested objects
              translationMap.set(
                key,
                parseNestedTranslations(value as Record<string, unknown>),
              );
            }
          }

          return translationMap;
        };

        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "object" && value !== null) {
            langFileData[key] = parseNestedTranslations(
              value as Record<string, unknown>,
            );
          }
        }

        vfs.buildUtils.langFiles.set(pathMeta.dir, langFileData);
      } else {
        const extension = pathMeta.ext.substring(1);
        const outputExtension = FILE_BUILDERS.get(extension)?.outputExtension ??
          extension;

        // Determine if this file needs translation
        const needsTranslation = multiLanguageEnabled && extension === "html";

        // Add the default language version under the default path
        const vFileParams: ConstructorParameters<typeof VFile>[0] = {
          srcPath: file.path,
          srcExtension: extension,
          srcHash: await getFileHash(file.path),
          outPath: pathMeta.dir +
            (pathMeta.dir === "/" ? "" : SEPARATOR) +
            pathMeta.name +
            "." +
            outputExtension,
        };

        // Create a version for each supported language
        if (needsTranslation && supportedLanguages.length > 0) {
          vFileParams.needsTranslation = true;
          vFileParams.language = defaultLanguage ?? undefined;

          for (const language of supportedLanguages) {
            const vFile = new VFile({
              ...vFileParams,
              outPath: `/${language}` + vFileParams.outPath,
              language,
            });
            vfs.source.set(`${vFile.srcPath}:${language}`, vFile);
            vfs.build.set(vFile.outPath, vFile);
          }
        }

        vfs.addVFile(vFileParams);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Source directory "${CONFIG.srcDir}" not found.`, {
        cause: error,
      });
    } else throw error;
  }
  return vfs;
};
