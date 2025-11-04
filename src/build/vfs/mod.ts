import resolvable, { type Resolvable } from "@md/resolvable";
import { FILE_BUILDERS } from "../file/mod.ts";
import type { LanguageFiles } from "../translations.ts";

/** A virtual file  */
export class VFile {
  /** The absolute pathname within the source folder */
  public srcPath: string;
  /** The original file extension (e.g. `scss`/`ts`/`html`) */
  public srcExtension: string;
  /** The hash of the original file contents */
  public srcHash: ArrayBuffer;
  /** The relative pathname for the result file */
  public outPath: string;
  /** The output file extension (e.g. `css`/`js`/`html`) */
  public outExtension: string;
  /** Signifies the stage of processing for the vFile */
  public status: "pending" | "skipped" | "processing" | "built" | "deleted" =
    "pending";
  /** The result of the build operation. Can be empty either if the file hasn't been built yet or needs not to be built (e.g. images) */
  public buildContents?: string | BufferSource;
  /** Language code for this file version (undefined for language-agnostic files) */
  public language?: string;
  /** Whether this file should be processed for translations */
  public needsTranslation: boolean;
  /** Time taken to process this file in milliseconds */
  public processingTime?: number;
  /** The contents to use if this file never existed on the filesystem (such as when using +plugin.ts) */
  public srcContents?: string | BufferSource;
  /** Promise that resolves when the file build is complete. Used to await dependent file builds without polling. */
  public readonly buildPromise: Resolvable<void> = resolvable<void>();

  constructor(params: {
    srcPath: string;
    srcExtension: string;
    needsTranslation?: boolean;
    srcHash: ArrayBuffer;
    outPath: string;
    language?: string;
    buildContents?: string | BufferSource;
    srcContents?: string | BufferSource;
    status?: "pending" | "skipped" | "processing" | "built" | "deleted";
  }) {
    this.srcPath = params.srcPath;
    this.srcExtension = params.srcExtension;
    this.outPath = params.outPath;
    this.outExtension =
      FILE_BUILDERS.get(params.srcExtension)?.outputExtension ??
        params.srcExtension;
    this.needsTranslation = params.needsTranslation ?? false;
    this.srcHash = params.srcHash;
    this.language = params.language;
    this.buildContents = params.buildContents;
    this.srcContents = params.srcContents;
    if (params.status) this.status = params.status;
  }
}

/** The virtual file system the build result is emitted to */
export class VFS {
  /** Maps from relative input path (e.g. `/js/main.ts`) to {@link VFile} */
  public source: Map<string, VFile> = new Map<string, VFile>();
  /** Maps from relative output path (e.g. `/js/main.js`) to {@link VFile} */
  public build: Map<string, VFile> = new Map<string, VFile>();
  /** A set of all relative function paths (e.g. [`/login`, `/home/test`]) */
  public functions: Set<string> = new Set<string>();
  /** A set of all relative middleware paths (e.g. [`/`, `/private`]) */
  public middlewares: Set<string> = new Set<string>();
  /** A set of utility files in the file system but only during the build step */
  public buildUtils: { layouts: Set<string>; langFiles: LanguageFiles } = {
    /** A set of all relative layout paths */
    layouts: new Set<string>(),
    /** A map from relative path to the language file content */
    langFiles: {},
  };

  public addVFile(arg: VFile | ConstructorParameters<typeof VFile>[0]) {
    const vFile = arg instanceof VFile ? arg : new VFile(arg);
    this.source.set(vFile.srcPath, vFile);
    this.build.set(vFile.outPath, vFile);
  }
}
