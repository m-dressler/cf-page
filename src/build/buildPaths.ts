import { CONFIG } from "../config.ts";

/** Converts a path in the `srcDir` to the path in the `outDir` */
export const toBuildPath = (sourcePath: string, newFileExtension?: string) => {
  if (newFileExtension) {
    sourcePath = sourcePath.substring(0, sourcePath.lastIndexOf(".") + 1) +
      newFileExtension;
  }
  return CONFIG.outDir + sourcePath.substring(CONFIG.srcDir.length);
};
