import getFileHash from "@md/file-hash";
import { walk } from "@std/fs/walk";
import { SEPARATOR } from "@std/path/constants";
import { parse } from "@std/path/parse";
import { parse as parseYaml } from "@std/yaml";
import { CONFIG } from "../config.ts";
import { FILE_BUILDERS } from "./file/mod.ts";
import {
  getDefaultLanguage,
  getSupportedLanguages,
  isMultiLanguageEnabled,
  type LangFileContent,
  type LanguageFiles,
  type TranslationKV,
} from "./translations.ts";

/** A virtual file  */
export type VFile = {
  /** The absolute pathname within the source folder */
  srcPath: string;
  /** The original file extension (e.g. `scss`/`ts`/`html`) */
  srcExtension: string;
  /** The hash of the original file contents */
  srcHash: ArrayBuffer;
  /** The relative pathname for the result file */
  outPath: string;
  /** The output file extension (e.g. `css`/`js`/`html`) */
  outExtension: string;
  /** Signifies the stage of processing for the vFile */
  status: "pending" | "skipped" | "processing" | "built" | "deleted";
  /** The result of the build operation. Can be empty either if the file hasn't been built yet or needs not to be built (e.g. images) */
  buildContents?: string | BufferSource;
  /** Language code for this file version (undefined for language-agnostic files) */
  language?: string;
  /** Whether this file should be processed for translations */
  needsTranslation?: boolean;
  /** Time taken to process this file in milliseconds */
  processingTime?: number;
};

/** The virtual file system the build result is emitted to */
export type VFS = {
  /** Maps from relative input path (e.g. `/js/main.ts`) to {@link VFile} */
  source: Map<string, VFile>;
  /** Maps from relative output path (e.g. `/js/main.js`) to {@link VFile} */
  build: Map<string, VFile>;
  /** A set of all relative function paths (e.g. [`/login`, `/home/test`]) */
  functions: Set<string>;
  /** A set of all relative middleware paths (e.g. [`/`, `/private`]) */
  middlewares: Set<string>;
  /** A set of utility files in the file system but only during the build step */
  buildUtils: {
    /** A set of all relative layout paths */
    layouts: Set<string>;
    /** A map from relative path to the language file content */
    langFiles: LanguageFiles;
  };
};

/** Loads all files from the source directory with their computed hash */
export const gatherVFS = async (): Promise<VFS> => {
  const vfs: VFS = {
    source: new Map(),
    build: new Map(),
    functions: new Set(),
    middlewares: new Set(),
    buildUtils: {
      layouts: new Set(),
      langFiles: new Map(),
    },
  };

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

        // Create a version for each supported language
        if (needsTranslation && supportedLanguages.length > 0) {
          // Add the default language version under the default path
          const defaultVFile: VFile = {
            srcPath: file.path,
            srcExtension: extension,
            srcHash: await getFileHash(file.path),
            outPath: pathMeta.dir +
              (pathMeta.dir === "/" ? "" : SEPARATOR) +
              pathMeta.name +
              "." +
              outputExtension,

            outExtension: outputExtension,
            status: "pending",
            needsTranslation: true,
            language: defaultLanguage ?? undefined,
          };
          vfs.source.set(defaultVFile.srcPath, defaultVFile);
          vfs.build.set(defaultVFile.outPath, defaultVFile);

          for (const language of supportedLanguages) {
            const vFile: VFile = {
              ...defaultVFile,
              outPath: `/${language}` + defaultVFile.outPath,
              language,
              needsTranslation: true,
            };
            vfs.source.set(`${vFile.srcPath}:${language}`, vFile);
            vfs.build.set(vFile.outPath, vFile);
          }
        } else {
          // Single version for non-translatable files
          const vFile: VFile = {
            srcPath: file.path,
            srcExtension: extension,
            srcHash: await getFileHash(file.path),
            outPath: pathMeta.dir +
              (pathMeta.dir === "/" ? "" : SEPARATOR) +
              pathMeta.name +
              "." +
              outputExtension,
            outExtension: outputExtension,
            status: "pending",
            needsTranslation: false,
          };
          vfs.source.set(vFile.srcPath, vFile);
          vfs.build.set(vFile.outPath, vFile);
        }
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
