import { isError } from "@md/ensure-error/is-error";
import resolvable from "@md/resolvable";
import { contentType } from "@std/media-types";
import { AbortError } from "../build/abortError.ts";
import type { VFS } from "../build/gatherVFS.ts";
import { build } from "../build/mod.ts";
import { CONFIG } from "../config.ts";
import { logPerformanceMetrics } from "../util/logPerformance.ts";
import {
  addLiveReloadScript,
  PREVIEW_JS_PATH,
  PREVIEW_JS_SCRIPT,
  PREVIEW_LISTEN_PATH,
} from "./addLiveReloadScript.ts";
import { loadBindings } from "./bindings/mod.ts";
import {
  type CompiledHandlers,
  compileHandlers,
  type FunctionHandler,
} from "./compileHandlers.ts";
import { print, printBuildInfo } from "./print.ts";
import { findBestMatch, type RouteParams } from "./routeMatching.ts";

const host = `http://localhost:${CONFIG.port}`;

let refreshPromise = resolvable<string>();

export type PreviewVFS = Omit<VFS, "buildUtils"> & {
  compiled: CompiledHandlers;
};

/** Virtual file system with compiled handlers */
const vfs: PreviewVFS = {
  functions: new Set(),
  middlewares: new Set(),
  source: new Map(),
  build: new Map(),
  compiled: {
    functions: new Map(),
    middlewares: new Map(),
  },
};

const DEFAULT_INCOMING_REQUEST_CF_PROPERTIES: IncomingRequestCfProperties<
  unknown
> = {
  asn: 0,
  asOrganization: "",
  colo: "",
  edgeRequestKeepAliveStatus: 1,
  httpProtocol: "",
  requestPriority: "",
  tlsVersion: "",
  tlsCipher: "",
  botManagement: {
    score: 1,
    verifiedBot: false,
    corporateProxy: false,
    staticResource: false,
    detectionIds: [],
    ja3Hash: "",
  },
  clientTrustScore: 1,
  hostMetadata: {},
  tlsClientAuth: {
    certFingerprintSHA1: "",
    certPresented: "1",
    certVerified: "SUCCESS",
    certRevoked: "0",
    certIssuerDN: "",
    certSubjectDN: "",
    certIssuerDNRFC2253: "",
    certSubjectDNRFC2253: "",
    certIssuerDNLegacy: "",
    certSubjectDNLegacy: "",
    certSerial: "",
    certIssuerSerial: "",
    certSKI: "",
    certIssuerSKI: "",
    certFingerprintSHA256: "",
    certNotBefore: "",
    certNotAfter: "",
  },
};

/** The `env` property expected by a cloudflare function including `ASSETS` */
const CF_FUNCTION_ENV = {
  ...Deno.env.toObject(),
  ...loadBindings(),
  ASSETS: {
    fetch: (input, init) => {
      const request = new Request(
        typeof input === "string" ? new URL(input, host) : input,
        // We only assert `redirect` is a narrower type than string
        init as typeof init & { redirect: RequestRedirect | undefined },
      );
      // For ASSETS.fetch, skip function/middleware execution and serve static files directly
      const path = new URL(request.url).pathname;
      return Promise.resolve(
        request.method === "GET" || request.method === "HEAD"
          ? loadAssets(path, request.method)
          : create405Response(request),
      );
    },
  } satisfies { fetch: typeof fetch },
};

/** Gets the current time of day */
const getTime = () => new Date().toISOString().split(/T|\./)[1];

const create405Response = (req: Request) =>
  new Response(`{"message":"Method ${req.method} not supported"}`, {
    status: 405,
    headers: {
      allow: "GET, HEAD",
      "content-type": "application/json",
    },
  });

const create500Response = (error: unknown) =>
  new Response(
    `Internal Server Error: ${
      isError(error) ? error.message : "Unexpected Error"
    }`,
    { status: 500 },
  );

const loadAssets = (path: string, method: "GET" | "HEAD"): Response => {
  // Normalize path
  if (path === "/") path += CONFIG.index;
  if (path.endsWith("/")) path = path.substring(0, path.length - 1);

  // Try to find the file in the VFS
  let vfile = vfs.build.get(path);

  // If not found, try with index.html
  if (!vfile && !path.endsWith(".html")) {
    vfile = vfs.build.get(path + "/index.html");
    if (vfile) path += "/index.html";
  }

  if (!vfile || vfile.status === "deleted") {
    return new Response('{"message":"404 Not Found"}', {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const status = method === "GET" ? 200 : 204;

  const fileContentType = contentType(vfile.outExtension);
  const headers: Record<string, string> = {
    ...(fileContentType && { "content-type": fileContentType }),
  };

  if (vfile.status === "skipped") {
    headers["content-length"] = Deno.statSync(vfile.srcPath).size + "";
    if (status === 204) return new Response(null, { status, headers });

    const file = Deno.openSync(vfile.srcPath);
    return new Response(file.readable, { status, headers });
  }

  let content = vfile.buildContents!;

  // Add live reload script for HTML and SVG files
  const isSvg = vfile.srcExtension === "svg";
  const needsRefreshScript = vfile.srcExtension === "html" || isSvg;

  if (needsRefreshScript) content = addLiveReloadScript(content, isSvg);

  const contentBuffer = typeof content === "string"
    ? new TextEncoder().encode(content)
    : content;
  headers["content-length"] = contentBuffer.byteLength + "";

  return new Response(contentBuffer, { status, headers });
};

const requestHandler = async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;

  // Handle preview endpoints
  if (path === PREVIEW_JS_PATH) {
    return new Response(PREVIEW_JS_SCRIPT, { status: 200 });
  } else if (path === PREVIEW_LISTEN_PATH) {
    const event = await refreshPromise;
    return new Response(`{"event":"${event}"}`, {
      headers: { "content-type": contentType(".json") },
    });
  }

  /** All the middlewares and if applicable function to call for this path */
  const functionChain: FunctionHandler[] = [];
  /** Parameters extracted from the route */
  let routeParams: RouteParams = {};

  // Collect middleware handlers for nested paths
  if (vfs.compiled.middlewares.size > 0) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; ++i) {
      const middlewarePath = parts.slice(0, i).join("/") || "/";
      const match = findBestMatch(vfs.compiled.middlewares, middlewarePath);

      if (match) {
        functionChain.push(...match.handler);
        routeParams = { ...routeParams, ...match.params };
      }
    }
  }

  // Find matching function handler
  const functionMatch = findBestMatch(vfs.compiled.functions, path);
  if (functionMatch) {
    functionChain.push(functionMatch.handler);
    routeParams = { ...routeParams, ...functionMatch.params };
  }

  // If no function or middleware exists, directly serve static assets
  if (functionChain.length === 0) {
    return req.method === "GET" || req.method === "HEAD"
      ? loadAssets(path, req.method)
      : create405Response(req);
  }

  /** For the `data` part of the Cloudflare request context. Simple persisted object for this request only */
  const requestData: Record<string, unknown> = {};

  const getContext = (
    fn: FunctionHandler,
  ): EventContext<unknown, string, Record<string, unknown>> => {
    const fnIndex = functionChain.indexOf(fn);
    const nextFn = functionChain[fnIndex + 1];

    /** Flag set to true by `passThroughOnException` */
    let passThroughOnException = false;

    // Create the Cloudflare-compatible context object
    return {
      request: Object.assign(req.clone(), {
        cf: DEFAULT_INCOMING_REQUEST_CF_PROPERTIES,
      }),
      params: routeParams,
      data: requestData,
      functionPath: path,
      env: CF_FUNCTION_ENV,
      /** No need to do anything specific as we don't shut down any runner after the response */
      waitUntil: () => {},
      passThroughOnException: () => {
        passThroughOnException = true; // Mark exceptions as fail safe
      },
      next: async () => {
        if (nextFn) {
          try {
            return await nextFn(getContext(nextFn));
          } catch (error) {
            console.error(`Error executing request at "${path}":`, error);
            // If passThrough was set, just return default response (https://developers.cloudflare.com/workers/runtime-apis/context/#passthroughonexception)
            if (passThroughOnException) return loadAssets(path, "GET");
            else return create500Response(error);
          }
        } else if (req.method === "GET" || req.method === "HEAD") {
          return loadAssets(path, req.method);
        } else return create405Response(req);
      },
    };
  };

  try {
    const fn = functionChain[0];
    return await fn(getContext(fn));
  } catch (error) {
    console.error(`Error executing request at "${path}":`, error);
    return create500Response(error);
  }
};

const rebuild = async (
  event: Deno.FsEvent,
  abortController: AbortController,
  measurePerformance?: boolean,
) => {
  print(getTime() + " | Re-building", true);
  const start = performance.now();

  // Rebuild the project and update the VFS
  try {
    const buildStart = performance.now();
    const result = await build("dev", {
      abortController,
    }).catch((err) => {
      // Abort will be handled below
      if (err instanceof AbortError) return null;
      else throw err;
    });
    const buildTime = performance.now() - buildStart;

    // Only update VFS and log success if not aborted
    if (result && !abortController.signal.aborted) {
      const { vfs: newVFS, ...meta } = result;
      // Store the new file system
      vfs.source = newVFS.source;
      vfs.build = newVFS.build;
      vfs.functions = newVFS.functions;
      vfs.middlewares = newVFS.middlewares;

      // Compile the functions and middlewares
      const compileStart = performance.now();
      const compiledHandlers = await compileHandlers(vfs);
      const compileTime = performance.now() - compileStart;
      vfs.compiled = compiledHandlers;

      printBuildInfo(meta);

      if (measurePerformance) {
        logPerformanceMetrics(newVFS);
        console.log(`🔍 Timing breakdown:`);
        console.log(`  Build phase: ${buildTime.toFixed(1)}ms`);
        console.log(`  Compile phase: ${compileTime.toFixed(1)}ms`);
      }
      print(
        `${getTime()} | Built (${(performance.now() - start).toFixed(1)}ms)`,
      );

      // Notify clients to refresh
      const isStyleOnly = event.paths.every(
        (path) =>
          path.endsWith(".css") ||
          path.endsWith(".scss") ||
          path.endsWith(".sass"),
      );
      refreshPromise.resolve(isStyleOnly ? "css" : "reload");
      refreshPromise = resolvable();
    }
  } catch (error) {
    print(`${getTime()} | Build failed`);
    console.error(error);
  }
};

/** Starts the development server listening to file changes and rebuilding the project with live reload */
export const devServer = async (
  options: { measurePerformance?: boolean } = {},
) => {
  print("Building", true);
  const start = performance.now();

  try {
    // Initial build
    const { vfs: initialVFS, ...meta } = await build("dev");

    // Initialize VFS
    vfs.source = initialVFS.source;
    vfs.build = initialVFS.build;
    vfs.functions = initialVFS.functions;
    vfs.middlewares = initialVFS.middlewares;

    // Compile functions and middlewares
    vfs.compiled = await compileHandlers(vfs);

    if (options.measurePerformance) logPerformanceMetrics(initialVFS);
    printBuildInfo(meta);
    print(
      `${getTime()} | Initial build complete (${
        (
          performance.now() - start
        ).toFixed(1)
      }ms)\n`,
    );
  } catch (err) {
    print("Initial build failed\n");
    console.error(err);
  }

  try {
    Deno.serve({
      port: CONFIG.port,
      handler: requestHandler,
      onListen: () => print(`Listening on ${host}\n`),
    });
  } catch (err) {
    if (err instanceof Deno.errors.AddrInUse) {
      await print(`Port ${CONFIG.port} is already in use\n`);
    } else {
      console.error(err);
    }
    Deno.exit(1);
  }

  const watcher = Deno.watchFs(CONFIG.srcDir);
  /** The latest abort controller to cancel interlacing builds */
  let abortController: AbortController | null = null;
  // Listen to changes and rebuild using VFS when changes come in
  for await (const event of watcher) {
    // If there is a current build process, tell it to abort
    if (abortController) abortController.abort();
    // Create an abort controller for this event
    abortController = new AbortController();
    // Rebuild the project
    rebuild(event, abortController, options.measurePerformance);
  }
};
