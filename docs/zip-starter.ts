/// <reference lib="deno.ns" />
/**
 * @module docs/zip-starter.ts
 * @description This module provides a task to zip the starter files into `./src`.
 */
import { walk } from "jsr:@std/fs/walk";
import { TarStream, type TarStreamInput } from "jsr:@std/tar/tar-stream";

const STARTER_DIR = "../starter";
const ZIP_PATH = "./src/starter.tar.gz";

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
        path,
        size,
        readable,
      };
    }
  }
};

await ReadableStream.from(createTarInputStream())
  .pipeThrough(new TarStream())
  .pipeThrough(new CompressionStream("gzip"))
  .pipeTo((await Deno.create(ZIP_PATH)).writable);
