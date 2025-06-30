import compareArrayBuffers from "@md/compare-array-buffers";
import getFileHash from "@md/file-hash";
import { join } from "@std/path/join";
import { CONFIG } from "../config.ts";
import { importCfFunction } from "./importCfFunction.ts";
import type { PreviewVFS } from "./mod.ts";

/** Type definition for function or middleware handler */
export type FunctionHandler = (
  context: EventContext<unknown, string, Record<string, unknown>>,
) => Promise<Response> | Response;

/** Cached compiled function and middleware handlers */
export type CompiledHandlers = {
  functions: Map<string, { handler: FunctionHandler; hash: ArrayBuffer }>;
  middlewares: Map<string, { handlers: FunctionHandler[]; hash: ArrayBuffer }>;
};

/** Gets the appropriate handler from a function module based on HTTP method */
const getMethodSpecificHandler = (
  // deno-lint-ignore no-explicit-any
  module: any,
  method: string,
): FunctionHandler | null => {
  /** Converts `GET` to `Get` */
  const methodRightCap = method
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
  const specificMethodHandlerName = `onRequest${methodRightCap}`;

  if (typeof module[specificMethodHandlerName] === "function") {
    return module[specificMethodHandlerName];
  } else if (typeof module.onRequest === "function") {
    return module.onRequest;
  } else return null;
};

/**
 * Compile all functions and middlewares from VFS source to executable handlers
 * This is called during build time to avoid compiling per request
 */
export const compileHandlers = async (
  vfs: PreviewVFS,
): Promise<CompiledHandlers> => {
  const compiled: CompiledHandlers = {
    functions: new Map(),
    middlewares: new Map(),
  };

  // Compile all functions
  const functionPromises = Array.from(vfs.functions).map(async (path) => {
    const prev = vfs.compiled.functions.get(path);

    const hash = await getFileHash(
      join(CONFIG.srcDir, path, CONFIG.functionName + `.ts`),
    );
    if (prev && compareArrayBuffers(prev.hash, hash)) {
      compiled.functions.set(path, prev);
      return; // Skip import if hash matches
    }

    const module = await importCfFunction(path, "function");

    // Create a method-aware wrapper function
    const wrappedHandler: FunctionHandler = (context) => {
      const method = context.request.method;
      const handler = getMethodSpecificHandler(module, method);
      return handler ? handler(context) : context.next();
    };

    compiled.functions.set(path, { handler: wrappedHandler, hash });
  });

  // Compile all middlewares
  const middlewarePromises = Array.from(vfs.middlewares).map(async (path) => {
    const prev = vfs.compiled.middlewares.get(path);

    const hash = await getFileHash(
      join(CONFIG.srcDir, path, CONFIG.middlewareName + `.ts`),
    );
    if (prev && compareArrayBuffers(prev.hash, hash)) {
      compiled.middlewares.set(path, prev);
      return; // Skip import if hash matches
    }

    const { onRequest } = await importCfFunction(path, "middleware");

    const isArray = Array.isArray(onRequest);
    if (!isArray && typeof onRequest !== "function") {
      throw new Error(
        `Invalid middleware (${path}): expected a function or array of functions but got ${typeof onRequest}`,
      );
    }
    if (isArray && !onRequest.every((v) => typeof v === "function")) {
      throw new Error(
        `Invalid middleware (${path}): All items in the onRequest array must be functions`,
      );
    }

    compiled.middlewares.set(path, {
      handlers: isArray ? onRequest : [onRequest],
      hash,
    });
  });

  await Promise.all([...functionPromises, ...middlewarePromises]);
  return compiled;
};
