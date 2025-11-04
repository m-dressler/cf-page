import { throwIfAborted } from "@util/abortError.ts";
import type { VFile, VFS } from "../vfs/mod.ts";

import cssBuilder from "./css.ts";
import htmlBuilder from "./html.ts";
import sassBuilder from "./sass.ts";
import typescriptBuilder from "./typescript.ts";

export type BuildContext = {
  abortController?: AbortController;
  mode: "dev" | "prod";
  vfs: VFS;
  warnings: string[];
  errors: Error[];
};

export type BuildResult = string | BufferSource | null;

export type FileBuilder = {
  inputExtensions: string[];
  outputExtension: string;
  build: (
    vFile: VFile,
    context: BuildContext,
  ) => BuildResult | Promise<BuildResult>;
};

/** A map from possible source file extensions to a build function for them and their output extension */
export const FILE_BUILDERS = new Map<string, FileBuilder>(
  [cssBuilder, typescriptBuilder, htmlBuilder, sassBuilder].flatMap((builder) =>
    builder.inputExtensions.map((ext): [string, FileBuilder] => [ext, builder])
  ),
);

/** Builds an individual file */
export const buildFile: (
  ...params: Parameters<FileBuilder["build"]>
) => Promise<void> = async (vFile, context) => {
  throwIfAborted(context.abortController);

  vFile.status = "processing";
  const startTime = performance.now();

  const builder = FILE_BUILDERS.get(vFile.srcExtension);
  if (builder) {
    const result = await builder.build(vFile, context);
    if (!result) {
      vFile.status = "deleted";
    } else {
      vFile.status = "built";
      vFile.buildContents = result;
    }
  } else {
    // For binary or unhandled files, just mark them as unmodified
    vFile.status = "skipped";
  }
  vFile.buildPromise.resolve();

  vFile.processingTime = performance.now() - startTime;
};
