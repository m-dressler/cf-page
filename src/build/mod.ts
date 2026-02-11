import { ensureError } from "@md/ensure-error/ensure-error";
import { throwIfAborted } from "@util/abortError.ts";
import { getBuildConcurrencyLimit } from "@util/concurrencyLimit.ts";
import { mapConcurrent } from "@util/mapAsync.ts";
import { type BuildContext, buildFile } from "./file/mod.ts";
import { loadPlugin } from "./plugin.ts";
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

  const { plugin, error: pluginLoadError } = await loadPlugin();
  if (pluginLoadError) errors.push(pluginLoadError);

  throwIfAborted(options.abortController);

  /** The buildContext object passed to each `buildFile` call */
  const buildContext: BuildContext = {
    abortController: options?.abortController,
    mode,
    vfs,
    warnings,
    errors,
  };

  if (plugin.before) {
    try {
      await plugin.before(buildContext);
    } catch (error) {
      errors.push(ensureError(error));
    }
  }

  // Process all source files with limited concurrency to prevent resource
  // exhaustion on low-spec machines (e.g., Cloudflare Pages runners)
  await mapConcurrent(
    vfs.source.values(),
    (vFile) => buildFile(vFile, buildContext),
    getBuildConcurrencyLimit(),
  );

  if (plugin.after) {
    try {
      await plugin.after(buildContext);
    } catch (error) {
      errors.push(ensureError(error));
    }
  }

  return { vfs, warnings, errors };
};
