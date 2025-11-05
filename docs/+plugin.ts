/// <reference lib="deno.ns" />
/**
 * @module docs/zip-starter.ts
 * @description This module provides a task to zip the starter files into `./src`.
*/
import { walk } from "@std/fs/walk";
import { TarStream, type TarStreamInput } from "@std/tar/tar-stream";
import type { PluginFunction } from "../src/mod.ts";

const STARTER_DIR = "../starter";

/** Creates a readable stream of TarStreamInput from walking the starter directory */
const createTarInputStream = async function* (): AsyncGenerator<
  TarStreamInput
> {
  for await (const f of walk(STARTER_DIR)) {
    const path = f.path.replace(STARTER_DIR, "");

    if (f.isDirectory) {
      yield {
        type: "directory",
        path,
      };
    } else if (f.isFile) {
      const { size } = await Deno.stat(f.path);
      const { readable } = await Deno.open(f.path);

      yield {
        type: "file",
        path: f.name === ".env.example" ? ".env" : path,
        size,
        readable,
      };
    }
  }
};

export const after: PluginFunction = async ({ vfs, mode }) => {
  if (mode === "dev") return; // No need to create zip for preview

  const stream = ReadableStream.from(createTarInputStream())
    .pipeThrough(new TarStream())
    .pipeThrough(new CompressionStream("gzip"));
  const buildContents = await new Response(stream).arrayBuffer();

  vfs.addVFile(
    {
      srcPath: "/starter.tar.gz",
      outPath: "/starter.tar.gz",
      srcExtension: "tar.gz",
      srcHash: new ArrayBuffer(),
      buildContents,
      status: "built",
    } as const,
  );
};
