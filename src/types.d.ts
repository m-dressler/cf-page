declare global {
  /** A virtual file  */
  type VFile = {
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

  /** A map from translation key to translation value */
  type TranslationKV = Map<string, string | string[] | boolean | TranslationKV>;
  /** Language file structure with language keys and global fallback */
  type LangFileContent = {
    global?: TranslationKV;
    [languageCode: string]: TranslationKV | undefined;
  };
  /** A map from relative project path to the language file content */
  type LanguageFiles = Map<string, LangFileContent>;

  /** The virtual file system the build result is emitted to */
  type VFS = {
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

  // deno-lint-ignore no-explicit-any
  type PartialBy<T extends Record<any, any>, U extends keyof T> =
    & Omit<T, U>
    & {
      [K in U]?: T[K];
    };
}

export {};
