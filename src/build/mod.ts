import { AbortError } from "./abortError.ts";
import { type BuildContext, buildFile } from "./file/mod.ts";
import { gatherVFS } from "./vfs/gatherVFS.ts";
import type { VFS } from "./vfs/mod.ts";

/**
 * Builds the project in multiple phases
 *
 * 1. Collects all files that need to be built in a virtual file-system ({@link VFS})
 * 2. Processes each file using appropriate builders based on file type
 * 3. Returns the completed virtual file system with source and build files
 *
 * @param mode The mode to build in, prod is slower but optimizes the results more
 * @param options Additional options to be passed to the build
 * @returns The built version of the project
 */
export const build = async (
  mode: "dev" | "prod",
  options: {
    /** A abortController that can be used to cancel the build */
    abortController?: AbortController;
  } = {},
): Promise<{ vfs: VFS; warnings: string[]; errors: Error[] }> => {
  const vfs = await gatherVFS();
  const warnings: string[] = [];
  const errors: Error[] = [];

  /** A list of all files in the source directory with their meta info */
  if (options.abortController?.signal.aborted) throw new AbortError();

  /** The buildContext object passed to each `buildFile` call */
  const buildContext: BuildContext = {
    abortController: options?.abortController,
    mode,
    vfs,
    warnings,
    errors,
  };

  // Process all source files
  await Promise.all(
    vfs.source.values().map((vFile) => buildFile(vFile, buildContext)),
  );

  return { vfs, warnings, errors };
};
