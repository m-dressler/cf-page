/** Uses `deno bundle` since there's no runtime API available yet (https://docs.deno.com/runtime/reference/bundling/) */
export const bundle = async (
  filePath: string | URL,
  minify: boolean,
): Promise<string> => {
  const result = await Deno.bundle({
    entrypoints: [filePath.toString()],
    minify,
  });

  if (!result.success) {
    throw new Error(`Deno bundle failed for ${filePath}`, {
      cause: result.errors,
    });
  }

  return new TextDecoder().decode(result.outputFiles![0]!.contents!);
};
