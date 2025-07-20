import getFileHash from "@md/file-hash";
import { walk } from "@std/fs/walk";
import { SEPARATOR } from "@std/path/constants";
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
import type { VFile } from "./mod.ts";
import { VFS } from "./mod.ts";

/** Loads all files from the source directory with their computed hash */
export const gatherVFS = async (): Promise<VFS> => {
  const vfs = new VFS();

  const multiLanguageEnabled = await isMultiLanguageEnabled();
  const supportedLanguages = multiLanguageEnabled
    ? await getSupportedLanguages()
    : [];
  const defaultLanguage = await getDefaultLanguage();

  try {
    const SRC_DIR_PATH_LEN = CONFIG.srcDir.length;
    for await (const file of walk(CONFIG.srcDir, { includeDirs: false })) {
      if (!file.isFile) continue;

      /** The relative path */
      const relPath = file.path.substring(SRC_DIR_PATH_LEN);
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
            vfs.addVFile({
              ...vFileParams,
              outPath: `/${language}` + vFileParams.outPath,
              language,
            });
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
