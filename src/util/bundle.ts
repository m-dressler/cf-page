import { CONFIG } from "../config.ts";

/** Uses `deno bundle` since there's no runtime API available yet (https://docs.deno.com/runtime/reference/bundling/) */
export const bundle = async (
  filePath: string | URL,
  minify: boolean,
): Promise<string> => {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--unstable-raw-imports",
      CONFIG.denoJsonFilePath && "--config",
      CONFIG.denoJsonFilePath, // Auto-discovers project config with import maps
      minify && "--minify",
      filePath.toString(),
    ].filter((arg) => arg !== false && arg != null),
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stdout, stderr } = await cmd.output();
  if (success) return new TextDecoder().decode(stdout);

  const errorText = new TextDecoder().decode(stderr);
  throw new Error(`Deno bundle failed for ${filePath}`, { cause: errorText });
};
