import { copy } from "@std/fs/copy";
import { emptyDir } from "@std/fs/empty-dir";
import { ensureDir } from "@std/fs/ensure-dir";
import { dirname } from "@std/path/dirname";
import { join } from "@std/path/join";
import { bundle } from "@util/bundle.ts";
import { CONFIG } from "../../config.ts";
import type { VFS } from "./mod.ts";

/**  Bundle function using native deno bundle with config resolution */
const writeFunction = async (inPath: string, outPath: string) => {
  const code = await bundle(inPath, true);
  await ensureDir(dirname(outPath));
  await Deno.writeTextFile(outPath, code);
};

/** Writes the {@link vfs} to disk */
export const writeVFS = async (vfs: VFS): Promise<void> => {
  // Clear out previous builds and ensure folders exist
  await Promise.all([CONFIG.outDir, "./functions"].map(emptyDir));

  // Copy all unmodified files (status: "skipped" or files without buildContents)
  for (const vFile of vfs.build.values()) {
    if (vFile.status === "deleted") continue;

    const outPath = join(CONFIG.outDir, vFile.outPath);
    await ensureDir(dirname(outPath));
    if (vFile.status === "skipped") {
      await copy(vFile.srcPath, outPath, { overwrite: true });
    } else if (vFile.status === "built") {
      const content = vFile.buildContents!;
      if (typeof content === "string") {
        await Deno.writeTextFile(outPath, content);
      } else if (content instanceof ArrayBuffer) {
        await Deno.writeFile(outPath, new Uint8Array(content));
      } else {
        await Deno.writeFile(
          outPath,
          new Uint8Array(
            content.buffer,
            content.byteOffset,
            content.byteLength,
          ),
        );
      }
    }
  }

  // Move bundled functions to ./functions directory
  for (const functionPath of vfs.functions) {
    const inPath = join(
      CONFIG.srcDir,
      functionPath,
      `${CONFIG.functionName}.ts`,
    );
    const outPath = join("./functions", functionPath + ".js");
    await writeFunction(inPath, outPath);
  }

  // Move middleware files to appropriate locations
  for (const middlewarePath of vfs.middlewares) {
    const inPath = join(
      CONFIG.srcDir,
      middlewarePath,
      `${CONFIG.middlewareName}.ts`,
    );
    const outPath = join("./functions", middlewarePath, "_middleware.js");
    await writeFunction(inPath, outPath);
  }
};
