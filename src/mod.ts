import * as CLI from "@md/cli";
import { dirname } from "@std/path/dirname";
import { normalize } from "@std/path/normalize";
import { UntarStream } from "@std/tar";
import { build } from "./build/mod.ts";
import { writeVFS } from "./build/writeVFS.ts";
import { devServer } from "./server/mod.ts";
import { logPerformanceMetrics } from "./util/logPerformance.ts";

export type { BuildContext } from "./build/file/mod.ts";
export type { VFile, VFS } from "./build/gatherVFS.ts";
export type { LanguageFiles } from "./build/translations.ts";

/** The URL where sample projects are hosted */
const BASE_URL = "https://cf-page.mdressler.dev";

/** The commands available to the CLI */
const commands: CLI.CommandMap = {
  build: CLI.command({
    description: "Build the site",
    dangerous: false,
    flags: {
      dev: {
        description: "Build for production",
        type: "boolean",
      },
      "measure-performance": {
        description: "Enable performance measurement and logging",
        type: "boolean",
      },
    },
  }).runner(async (_, { dev, "measure-performance": measurePerformance }) => {
    const { vfs, warnings, errors } = await build(dev ? "dev" : "prod");
    for (const w of warnings) console.warn(w);
    for (const e of errors) console.warn(e);
    await writeVFS(vfs);

    if (measurePerformance) {
      logPerformanceMetrics(vfs);
    }
  }),
  serve: CLI.command({
    description: "Start the development server",
    dangerous: false,
    flags: {
      "measure-performance": {
        description: "Enable performance measurement and logging",
        type: "boolean",
      },
    },
  }).runner(async (_, { "measure-performance": measurePerformance }) => {
    await devServer({ measurePerformance });
  }),
  init: CLI.command({
    description: "Initialize a new project",
    dangerous: false,
  }).runner(async () => {
    const domainNameRegex =
      /^((?!-))(xn--)?[a-z0-9][a-z0-9-_]{0,61}[a-z0-9]{0,1}\.(xn--)?([a-z0-9\-]{1,61}|[a-z0-9-]{1,30}\.[a-z]{2,})$/;
    const exists = (path: string) =>
      Deno.stat(path).then(
        () => true,
        () => false,
      );

    const responsePromise = fetch(BASE_URL + "/starter.tar.gz");

    let name: string | undefined;
    while (!name) {
      name = prompt("Site domain:")?.trim();

      if (name?.includes("/")) {
        name = undefined;
        alert(`Domain cannot include the "/" character.`);
        continue;
      }

      // Check if directory already exists
      if (await exists("./" + name)) {
        alert(
          `A file/directory "${name}" already exists - delete manually and then continue`,
        );
        let retriesLeft = 3;
        while (await exists("./" + name)) {
          alert(
            `The file/directory "${name}" still exists, please delete it or abort!`,
          );
          if (--retriesLeft <= 0) {
            console.log("Too many retries, aborting.");
            Deno.exit(1);
          }
        }
      }
      if (name && !domainNameRegex.test(name)) {
        const doesIgnore = confirm(
          `"${name}" is not a valid domain name. Continue regardless?`,
        );
        if (!doesIgnore) name = undefined;
      }
    }

    const response = await responsePromise;
    if (response.status !== 200) {
      throw new Error(`Failed to fetch starter template: ${response.status}`);
    }
    if (!response.body) {
      throw new Error(`Failed to fetch starter template: Response has no body`);
    }

    const tarStream = response.body
      .pipeThrough(new DecompressionStream("gzip"))
      .pipeThrough(new UntarStream());

    for await (const entry of tarStream) {
      const path = normalize(`./${name}/` + entry.path);
      await Deno.mkdir(dirname(path), { recursive: true });
      await entry.readable?.pipeTo((await Deno.create(path)).writable);
    }

    const githubParams = new URLSearchParams({
      name,
      description: "A website create with @md/cf-page",
    });
    console.log(`
Project successfully initialized in the directory "${name}".

Run preview using \`deno task dev\`

Publishing:
    1. https://github.com/new?${githubParams}
    2. https://dash.cloudflare.com/?to=/:account/pages/new/provider/github"
        - Build Command:\t\tdeno task build
        - Build Output Directory:\tdist

For more details visit https://cf-page.mdressler.dev/#deploy`);
  }),
};

// Create a CLI and run it with the provided arguments
CLI.create("A simple static site generator", commands).run();
