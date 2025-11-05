/// <reference lib="deno.ns" />
import { encrypt } from "@lib/common/crypto.ts";
import type { PluginFunction } from "@md/cf-page";

const BLOG_REGEX = /^\/blogs\/([^\/]+).json$/;

type Blog = {
  path: string;
  createdAt: number;
  title: string;
  body: string[];
};

/** Any transformations to the the build before it starts  */
export const before: PluginFunction = async (ctx) => {
  const blogs: Blog[] = [];

  for (const vFile of ctx.vfs.source.values()) {
    const match = vFile.outPath.match(BLOG_REGEX);
    if (!match) continue;

    // Convert to HTML and remove JSON
    const name = match[1];
    const contentRaw = await Deno.readFile(vFile.srcPath);
    const content = new TextDecoder().decode(contentRaw);
    const blog = JSON.parse(content) as Omit<Blog, "path">;
    blogs.push(Object.assign(blog, { path: "/blogs/" + name }));
    const fsPath = `/blogs/${name}/index.html`;

    // Add HTML
    ctx.vfs.addVFile({
      srcPath: fsPath,
      outPath: fsPath,
      srcExtension: "html",
      srcHash: await crypto.subtle.digest("SHA-256", contentRaw),
      srcContents: `<h1>${blog.title}</h1>${
        blog.body
          .map((v) => `<p>${v}</p>`)
          .join("")
      }`,
    });

    // Remove JSON
    ctx.vfs.source.delete(vFile.srcPath);
    ctx.vfs.build.delete(vFile.outPath);
  }

  const blogsIndex = ctx.vfs.build.get("/blogs/index.html");
  if (blogsIndex) {
    // Sort by latest
    blogs.sort((a, b) => b.createdAt - a.createdAt);
    let html = await Deno.readTextFile(blogsIndex.srcPath);
    html = html.replace(
      "<blog-list />",
      blogs.map((b) => `<li><a href="${b.path}">${b.title}</a></li>`).join(""),
    );
    blogsIndex.srcContents = html;
  }
};

/** Any transformations to the the build after it completed  */
export const after: PluginFunction = async (ctx) => {
  const vFile = ctx.vfs.build.get("/secret/index.json");
  if (!vFile) {
    return void ctx.warnings.push("/secret/index.json isn't available");
  }

  const rawContent = vFile.buildContents ??
    (await Deno.readTextFile(vFile.srcPath));

  const content = typeof rawContent === "string"
    ? new TextEncoder().encode(rawContent)
    : rawContent;

  const secret = Deno.env.get("APP_SECRET");
  if (!secret) {
    return void ctx.errors.push(
      new Error(
        "Couldn't encrypt as environment variable `APP_SECRET` isn't defined",
      ),
    );
  }

  vFile.buildContents = await encrypt({ value: content, secret });
  vFile.status = "built";
};
