import resolvable from "@md/resolvable";
import { assert, assertEquals } from "@std/assert";
import type { ElementContent } from "hast";
import { rehype } from "rehype";
import { CONFIG } from "../../config.ts";
import type { LangFileContent } from "../translations.ts";
import { type VFile, VFS } from "../vfs/mod.ts";
import { absoluteLinksPlugin } from "./html/absoluteLinksPlugin.ts";
import { processSvelteBlocks } from "./html/svelteBlocksPlugin.ts";
import {
  getTranslationFunction,
  processMixedContent,
} from "./html/translationPlugin.ts";

// Mock VFile and VFS for testing
const createMockVFile = (language: string, outPath: string): VFile => ({
  srcPath: "/test/src" + outPath,
  srcExtension: "html",
  srcHash: new ArrayBuffer(0),
  outPath,
  outExtension: "html",
  status: "pending",
  language,
  needsTranslation: true,
  buildPromise: resolvable(),
});

const createMockVFS = (translations: LangFileContent): VFS => {
  const vfs = new VFS();

  vfs.buildUtils.langFiles = {
    "/": {
      global: {
        siteName: "Test Site",
        menuItems: ["home", "about", "contact"],
        userLoggedIn: false,
        featureEnabled: true,
      },
      ...translations,
    },
  };
  return vfs;
};

/** Removes the `position` property from a HAST tree to make assertions less verbose */
const stripPositionInfo = (result: ElementContent[]) => {
  for (const el of result) {
    if ("position" in el) delete el.position;
    if (el.type === "element") stripPositionInfo(el.children);
  }
  return result;
};

Deno.test("getTranslationFunction - basic translation lookup", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      welcome: "Welcome",
      navigation: {
        home: "Home",
      },
    },
  });

  const translate = getTranslationFunction(vFile, vfs);

  assertEquals(translate("welcome"), "Welcome");
  assertEquals(translate("navigation.home"), "Home");
  assertEquals(translate("nonexistent"), null);
});

Deno.test("getTranslationFunction - built-in variables", () => {
  const vFile = createMockVFile("en", "/about.html");
  const vfs = createMockVFS({});

  const translate = getTranslationFunction(vFile, vfs);

  assertEquals(translate("cf:lang"), "en");
  assertEquals(translate("cf:path"), "/about.html");
  assertEquals(translate("cf:year"), new Date().getFullYear() + "");
});

Deno.test("getTranslationFunction - global fallback", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      specific: "English specific",
    },
  });

  const translate = getTranslationFunction(vFile, vfs);

  assertEquals(translate("siteName"), "Test Site");
  assertEquals(translate("specific"), "English specific");
});

Deno.test("processMixedContent - simple text without placeholders", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent("Hello world", translate);

  assertEquals(result, [{ type: "text", value: "Hello world" }]);
});

Deno.test("processMixedContent - simple translation replacement", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      greeting: "Hello",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent("Say {greeting} to everyone", translate);

  assertEquals(result, [{ type: "text", value: "Say Hello to everyone" }]);
});

Deno.test(
  "processMixedContent - markdown NOT processed without directive",
  () => {
    const vFile = createMockVFile("en", "/index.html");
    const vfs = createMockVFS({
      en: {
        emphasis: "**very important**",
      },
    });
    const translate = getTranslationFunction(vFile, vfs);

    const result = processMixedContent("This is {emphasis} text", translate);

    // Without @md directive, markdown should NOT be processed
    assertEquals(result, [
      {
        type: "text",
        value: "This is **very important** text",
      },
    ]);
  },
);

Deno.test("processMixedContent - link NOT processed without directive", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      linkText: "Visit [our site](https://example.com)",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent("Please {linkText} today", translate);

  // Without @md directive, links should NOT be processed
  assertEquals(result, [
    {
      type: "text",
      value: "Please Visit [our site](https://example.com) today",
    },
  ]);
});

Deno.test(
  "processMixedContent - regular translation (no markdown processing)",
  () => {
    const vFile = createMockVFile("en", "/index.html");
    const vfs = createMockVFS({
      en: {
        instruction: "Run `npm install`",
      },
    });
    const translate = getTranslationFunction(vFile, vfs);

    const result = processMixedContent(
      "To get started: {instruction}",
      translate,
    );

    // Without @md directive, markdown should NOT be processed
    assertEquals(result, [
      {
        type: "text",
        value: "To get started: Run `npm install`",
      },
    ]);
  },
);

Deno.test("processMixedContent - {@md directive} processes markdown", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      instruction: "Run `npm install`",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    "To get started: {@md instruction}",
    translate,
  );

  // With @md directive, markdown SHOULD be processed
  assertEquals(stripPositionInfo(result), [
    { type: "text", value: "To get started: " },
    { type: "text", value: "Run " },
    {
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value: "npm install" }],
    },
  ]);
});

Deno.test("processMixedContent - {@md directive} with bold text", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      emphasis: "This is **very important**",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent("Note: {@md emphasis}", translate);

  assertEquals(stripPositionInfo(result), [
    { type: "text", value: "Note: " },
    {
      type: "text",
      value: "This is ",
    },
    {
      type: "element",
      tagName: "strong",
      properties: {},
      children: [{ type: "text", value: "very important" }],
    },
  ]);
});

Deno.test("processMixedContent - {@md directive} with links", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      linkText: "Visit [our website](https://example.com)",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    "Please {@md linkText} for more info",
    translate,
  );

  assertEquals(stripPositionInfo(result), [
    { type: "text", value: "Please " },
    {
      type: "text",
      value: "Visit ",
    },
    {
      type: "element",
      tagName: "a",
      properties: { href: "https://example.com" },
      children: [{ type: "text", value: "our website" }],
    },
    { type: "text", value: " for more info" },
  ]);
});

Deno.test(
  "processMixedContent - multiple {@md directives} in one string",
  () => {
    const vFile = createMockVFile("en", "/index.html");
    const vfs = createMockVFS({
      en: {
        code: "`code`",
        bold: "**bold**",
      },
    });
    const translate = getTranslationFunction(vFile, vfs);

    const result = processMixedContent(
      "Use {@md code} and {@md bold} together",
      translate,
    );

    assertEquals(stripPositionInfo(result), [
      { type: "text", value: "Use " },
      {
        type: "element",
        tagName: "code",
        properties: {},
        children: [{ type: "text", value: "code" }],
      },
      { type: "text", value: " and " },
      {
        type: "element",
        tagName: "strong",
        properties: {},
        children: [{ type: "text", value: "bold" }],
      },
      { type: "text", value: " together" },
    ]);
  },
);

Deno.test("processMixedContent - translation with parameters", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      welcome: "Welcome to {name}!",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    "Header: {welcome, name: {siteName}}",
    translate,
  );

  assertEquals(result, [
    { type: "text", value: "Header: Welcome to Test Site!" },
  ]);
});

Deno.test("processMixedContent - nested key with parameters", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      footer: {
        copyright: "Copyright © {year} mdressler. All rights reserved.",
      },
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    "{footer.copyright, year: {cf:year}}",
    translate,
  );

  assertEquals(result, [
    {
      type: "text",
      value: `Copyright © ${
        new Date().getFullYear()
      } mdressler. All rights reserved.`,
    },
  ]);
});

Deno.test("processMixedContent - deeply nested key with parameters", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      app: {
        messages: {
          greeting: "Hello {user}, welcome to {app}!",
        },
      },
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    "{app.messages.greeting, user: {siteName}, app: {cf:lang}}",
    translate,
  );

  assertEquals(result, [
    { type: "text", value: "Hello Test Site, welcome to en!" },
  ]);
});

Deno.test(
  "processMixedContent - mixed content with multiple placeholders",
  () => {
    const vFile = createMockVFile("en", "/index.html");
    const vfs = createMockVFS({
      en: {
        bold: "**bold**",
        link: "[link](https://example.com)",
      },
    });
    const translate = getTranslationFunction(vFile, vfs);

    const result = processMixedContent(
      "Text with {@md bold} and {@md link} elements",
      translate,
    );

    assertEquals(stripPositionInfo(result), [
      { type: "text", value: "Text with " },
      {
        type: "element",
        tagName: "strong",
        properties: {},
        children: [{ type: "text", value: "bold" }],
      },
      { type: "text", value: " and " },
      {
        type: "element",
        tagName: "a",
        properties: { href: "https://example.com" },
        children: [{ type: "text", value: "link" }],
      },
      { type: "text", value: " elements" },
    ]);
  },
);

Deno.test("processMixedContent - array translation values", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      items: ["apple", "banana", "cherry"],
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent("Fruits: {items}", translate);

  assertEquals(result, [
    { type: "text", value: "Fruits: apple\nbanana\ncherry" },
  ]);
});

Deno.test("Svelte blocks - {#each} with simple array", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});

  const html = `
    <ul>
      {#each menuItems as item}
        <li>{item}</li>
      {/each}
    </ul>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("<li>home</li>"), true);
  assertEquals(result.includes("<li>about</li>"), true);
  assertEquals(result.includes("<li>contact</li>"), true);
});

Deno.test("Svelte blocks - {#each} with markdown in template", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      features: [
        "**Feature 1**",
        "`Feature 2`",
        "[Feature 3](https://example.com)",
      ],
    },
  });

  const html = `
    <div>
      {#each features as feature}
        <p>{@md feature}</p>
      {/each}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("<strong>Feature 1</strong>"), true);
  assertEquals(result.includes("<code>Feature 2</code>"), true);
  assertEquals(
    result.includes('<a href="https://example.com">Feature 3</a>'),
    true,
  );
});

Deno.test("Svelte blocks - {#each} with nested keys", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      nested: Array(3)
        .fill(0)
        .map(
          (_, i) => ({
            title: "Title " + (i + 1),
            description: "Description " + (i + 1),
          } as const),
        ),
    },
  });

  const html = `
    <ul>
      {#each nested as item}
        <li>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </li>
      {/each}
    </ul>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(
    result.replace(/\n +\n/g, "\n"),
    `
    <ul>
        <li>
          <h3>Title 1</h3>
          <p>Description 1</p>
        </li>
        <li>
          <h3>Title 2</h3>
          <p>Description 2</p>
        </li>
        <li>
          <h3>Title 3</h3>
          <p>Description 3</p>
        </li>
    </ul>
  `,
  );
});

Deno.test("Svelte blocks - {#if} with truthy condition", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});

  const html = `
    <div>
      {#if featureEnabled}
        <p>Feature is enabled!</p>
      {:else}
        <p>Feature is disabled.</p>
      {/if}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("Feature is enabled!"), true);
  assertEquals(result.includes("Feature is disabled."), false);
});

Deno.test("Svelte blocks - {#if} with falsy condition", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});

  const html = `
    <div>
      {#if userLoggedIn}
        <p>Welcome back!</p>
      {:else}
        <p>Please log in.</p>
      {/if}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("Welcome back!"), false);
  assertEquals(result.includes("Please log in."), true);
});

Deno.test("Svelte blocks - {#if} with markdown in content", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      hasMarkdown: "true",
    },
  });

  const html = `
    <div>
      {#if hasMarkdown}
        <p>This is **bold** and [linked](https://example.com)</p>
      {/if}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("**bold**"), true);
  assertEquals(result.includes("[linked](https://example.com)"), true);
});

Deno.test("Svelte blocks - nested {#each} with complex content", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      sections: [
        "**Introduction**",
        "`Code Examples`",
        "[Documentation](https://docs.example.com)",
      ],
    },
  });

  const html = `
    <div class="content">
      {#each sections as section}
        <div class="section">
          <h3>{@md section}</h3>
          <p>Section content here</p>
        </div>
      {/each}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("<strong>Introduction</strong>"), true);
  assertEquals(result.includes("<code>Code Examples</code>"), true);
  assertEquals(
    result.includes('<a href="https://docs.example.com">Documentation</a>'),
    true,
  );
  assertEquals(result.includes("Section content here"), true);
});

Deno.test("Svelte blocks - {#if} without else clause", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});

  const html = `
    <div>
      <p>Always visible</p>
      {#if featureEnabled}
        <p>**Conditionally visible**</p>
      {/if}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("Always visible"), true);
  assertEquals(result.includes("**Conditionally visible**"), true);
});

Deno.test("Svelte blocks - mixed {#if} and {#each} blocks", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});

  const html = `
    <div>
      {#if featureEnabled}
        <h2>Available Features:</h2>
        <ul>
          {#each menuItems as item}
            <li>**{item}**</li>
          {/each}
        </ul>
      {:else}
        <p>No features available</p>
      {/if}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("Available Features:"), true);
  assertEquals(result.includes("**home**"), true);
  assertEquals(result.includes("**about**"), true);
  assertEquals(result.includes("**contact**"), true);
  assertEquals(result.includes("No features available"), false);
});

// Edge case tests
Deno.test("Edge cases - empty array in {#each}", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      emptyList: [],
    },
  });

  const html = `
    <div>
      {#each emptyList as item}
        <p>{item}</p>
      {/each}
      <p>After loop</p>
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  // Should have no loop content, just the after text
  assertEquals(result.includes("After loop"), true);
  assertEquals(result.split("<p>").length, 2); // Only one <p> tag
});

Deno.test("Edge cases - non-existent variable in {#if}", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({});

  const html = `
    <div>
      {#if nonExistentVar}
        <p>Should not appear</p>
      {:else}
        <p>Fallback content</p>
      {/if}
    </div>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("Should not appear"), false);
  assertEquals(result.includes("Fallback content"), true);
});

Deno.test("Edge cases - complex markdown combinations", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      complexText:
        "This has **bold** and `code` and [a link](https://example.com) all together",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent("Content: {@md complexText}", translate);

  assertEquals(stripPositionInfo(result), [
    { type: "text", value: "Content: " },
    { type: "text", value: "This has " },
    {
      type: "element",
      tagName: "strong",
      properties: {},
      children: [{ type: "text", value: "bold" }],
    },
    { type: "text", value: " and " },
    {
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value: "code" }],
    },
    { type: "text", value: " and " },
    {
      type: "element",
      tagName: "a",
      properties: { href: "https://example.com" },
      children: [{ type: "text", value: "a link" }],
    },
    { type: "text", value: " all together" },
  ]);
});

Deno.test("Edge cases - nested markdown in {#each}", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      markdownItems: [
        "**Bold item** with `code`",
        "[Link item](https://example.com) with **bold**",
        "Plain text item",
      ],
    },
  });

  const html = `
    <ul>
      {#each markdownItems as item}
        <li>{@md item}</li>
      {/each}
    </ul>
  `;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(result.includes("<strong>Bold item</strong>"), true);
  assertEquals(result.includes("<code>code</code>"), true);
  assertEquals(
    result.includes('<a href="https://example.com">Link item</a>'),
    true,
  );
  assertEquals(result.includes("<strong>bold</strong>"), true);
  assertEquals(result.includes("Plain text item"), true);
});

Deno.test("Edge cases - translation function with nested objects", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      user: {
        name: "John Doe",
        status: "**Premium User**",
      },
    },
  });

  const translate = getTranslationFunction(vFile, vfs);

  // Test nested object access
  assertEquals(translate("user.name"), "John Doe");
  assertEquals(translate("user.status"), "**Premium User**");
  assertEquals(translate("user.nonexistent"), null);
});

Deno.test("Edge cases - translation with non-existent parameter", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      greeting: "Hello {name}!",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    "Say: {greeting, name: {nonExistentParam}}",
    translate,
  );

  // Should use the parameter name as fallback
  assertEquals(result, [
    { type: "text", value: "Say: Hello nonExistentParam!" },
  ]);
});

Deno.test(
  "processMixedContent - translation with string literal parameter",
  () => {
    const vFile = createMockVFile("en", "/index.html");
    const vfs = createMockVFS({
      en: {
        greeting: "Hello {name}, welcome to {place}!",
      },
    });
    const translate = getTranslationFunction(vFile, vfs);

    const result = processMixedContent(
      '{greeting, name: "John Doe", place: "Earth"}',
      translate,
    );

    assertEquals(result, [
      { type: "text", value: "Hello John Doe, welcome to Earth!" },
    ]);
  },
);

Deno.test("processMixedContent - mixed parameter types", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      message: "User {user} logged in at {time} on {date}",
    },
  });
  const translate = getTranslationFunction(vFile, vfs);

  const result = processMixedContent(
    '{message, user: {siteName}, time: "10:30 AM", date: {cf:year}}',
    translate,
  );

  assertEquals(result, [
    {
      type: "text",
      value: `User Test Site logged in at 10:30 AM on ${
        new Date().getFullYear()
      }`,
    },
  ]);
});

// Template-related tests
Deno.test("Template - attribute translation within template element", async () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      placeholder: "Enter your name",
      buttonLabel: "Submit form",
    },
  });

  const context = {
    mode: "dev" as const,
    vfs,
    warnings: [] as string[],
    errors: [] as Error[],
  };

  const { translationPlugin } = await import("./html/translationPlugin.ts");

  const html =
    `<template><input placeholder="{placeholder}"><button aria-label="{buttonLabel}">Click</button></template>`;

  const result = await rehype()
    .use(translationPlugin, context, vFile)
    .process({ path: vFile.srcPath, value: html });

  const output = String(result);

  assertEquals(
    output,
    '<html><head><template><input placeholder="Enter your name"><button aria-label="Submit form">Click</button></template></head><body></body></html>',
  );
});

Deno.test("Template - {#each} block inside template element", () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      options: ["Option A", "Option B", "Option C"],
    },
  });

  const html =
    `<template>{#each options as opt}<option value="{opt}">{opt}</option>{/each}</template>`;

  const result = processSvelteBlocks(html, vfs, vFile);

  assertEquals(
    result,
    '<template><option value="Option A">Option A</option><option value="Option B">Option B</option><option value="Option C">Option C</option></template>',
  );
});

Deno.test("Template - combined text and attribute translations", async () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      title: "Welcome",
      inputPlaceholder: "Type here...",
      helpText: "Enter your **name**",
    },
  });

  const context = {
    mode: "dev" as const,
    vfs,
    warnings: [] as string[],
    errors: [] as Error[],
  };

  const { translationPlugin } = await import("./html/translationPlugin.ts");

  const html = `<template>
    <h1>{title}</h1>
    <input placeholder="{inputPlaceholder}">
    <span>{@md helpText}</span>
  </template>`;

  const result = await rehype()
    .use(translationPlugin, context, vFile)
    .process({ path: vFile.srcPath, value: html });

  const output = String(result);

  assertEquals(
    output,
    `<html><head><template>
    <h1>Welcome</h1>
    <input placeholder="Type here...">
    <span>Enter your <strong>name</strong></span>
  </template></head><body></body></html>`,
  );
});

Deno.test("Template - nested template elements with translations", async () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({
    en: {
      outerLabel: "Outer",
      innerLabel: "Inner",
    },
  });

  const context = {
    mode: "dev" as const,
    vfs,
    warnings: [] as string[],
    errors: [] as Error[],
  };

  const { translationPlugin } = await import("./html/translationPlugin.ts");

  const html = `<template>
    <div data-label="{outerLabel}">
      <template>
        <span data-inner="{innerLabel}">{innerLabel}</span>
      </template>
    </div>
  </template>`;

  const result = await rehype()
    .use(translationPlugin, context, vFile)
    .process({ path: vFile.srcPath, value: html });

  const output = String(result);

  assertEquals(
    output,
    `<html><head><template>
    <div data-label="Outer">
      <template>
        <span data-inner="Inner">Inner</span>
      </template>
    </div>
  </template></head><body></body></html>`,
  );
});

Deno.test("absoluteLinksPlugin - Correctly converts relative URLs to absolute", async () => {
  const vfs = createMockVFS({});
  vfs.addVFile(createMockVFile("en", "/blog/post.html"));

  const context = {
    mode: "prod" as const,
    vfs,
    warnings: [],
    errors: [],
  };

  const html = `
    <img src="./image.png" />
    <script src="../script.js"></script>
    <link href="./style.css" />
    <a href="./page.html">Link</a>
  `;

  const result = await rehype()
    .use(absoluteLinksPlugin, context)
    .process({ path: "/test/src/blog/post.html", value: html });

  const output = String(result);

  assert(output.includes('src="/blog/image.png"'), "Local image src updated");
  assert(
    output.includes('src="/script.js"'),
    "Parent script src linked to parent",
  );
  assert(output.includes('href="/blog/style.css"'), "Link href updated");
  assert(output.includes('href="/blog/page.html"'), "Anchor href updated");
});

Deno.test("absoluteLinksPlugin - external URL remains static", async () => {
  const vfs = createMockVFS({});
  vfs.addVFile(createMockVFile("en", "/index.html"));

  const context = {
    mode: "prod" as const,
    vfs,
    warnings: [],
    errors: [],
  };

  const html = `
    <img src="https://example.com/image.png" />
    <script src="/absolute/path.js"></script>
  `;

  const result = await rehype()
    .use(absoluteLinksPlugin, context)
    .process({ path: "/test/src/index.html", value: html });

  const output = String(result);

  assert(
    output.includes('src="https://example.com/image.png"'),
    "External URLs should remain unchanged",
  );
  assert(
    output.includes('src="/absolute/path.js"'),
    "Absolute paths (starting with /) should remain unchanged",
  );
});

Deno.test("Layout with Svelte blocks after slot merging", async () => {
  const vFile = createMockVFile("en", "/index.html");
  const vfs = createMockVFS({ en: { menu: ["Home", "About", "Contact"] } });

  // Register the layout in VFS
  vfs.buildUtils.layouts.add("/");

  const context = {
    mode: "dev" as const,
    vfs,
    warnings: [] as string[],
    errors: [] as Error[],
    abortController: new AbortController(),
  };

  // Layout HTML with Svelte blocks
  const layoutPath = CONFIG.srcDir + "/" + CONFIG.layoutName;
  const layoutHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Test</title>
  </head>
  <body>
    <header>
      <menu>
        {#each menu as item}
        <li>{item}</li>
        {/each}
      </menu>
    </header>
    <main>
      <slot />
    </main>
  </body>
</html>`;

  // Page content - simple HTML without Svelte blocks
  const pageHtml = `<h1>Problem demo</h1>`;

  // Mock Deno.readTextFile to return our layout
  const originalReadTextFile = Deno.readTextFile;
  Deno.readTextFile = ((path: string) => {
    if (path === layoutPath) return Promise.resolve(layoutHtml);
    return originalReadTextFile(path);
  }) as typeof Deno.readTextFile;

  try {
    // Import the full HTML builder to test the actual implementation
    const htmlBuilder = await import("./html.ts");

    // Build the HTML using the actual build function
    const result = await htmlBuilder.default.build(
      { ...vFile, srcContents: new TextEncoder().encode(pageHtml) },
      context,
    );

    const output = typeof result === "string"
      ? result
      : new TextDecoder().decode(result);

    // This test will FAIL if svelteBlocksPlugin uses file.value instead of tree
    // because file.value contains only the page content, not the merged layout
    assertEquals(
      output.includes("<li>Home</li>"),
      true,
      "Layout's Svelte blocks must be processed - if this fails, svelteBlocksPlugin is not receiving the merged HTML",
    );
    assertEquals(
      output.includes("<li>About</li>"),
      true,
      "Layout should have processed About menu item",
    );
    assertEquals(
      output.includes("<li>Contact</li>"),
      true,
      "Layout should have processed Contact menu item",
    );
    assertEquals(
      output.includes("{#each"),
      false,
      "Svelte syntax should be removed from layout",
    );
    assertEquals(
      output.includes("<h1"),
      true,
      "Page content should be present",
    );
    assertEquals(
      output.includes("Problem demo"),
      true,
      "Page content text should be present",
    );
    assertEquals(
      output.includes("<header>"),
      true,
      "Layout structure (header) should be present",
    );
    assertEquals(
      output.includes("<menu>"),
      true,
      "Layout structure (menu) should be present",
    );
  } finally {
    // Restore original function
    Deno.readTextFile = originalReadTextFile;
  }
});
