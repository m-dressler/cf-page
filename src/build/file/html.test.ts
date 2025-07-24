import { assertEquals } from "jsr:@std/assert";
import type { ElementContent } from "npm:@types/hast@3.0.4";
import type { TranslationKV } from "../translations.ts";
import { type VFile, VFS } from "../vfs/mod.ts";
import { processSvelteBlocks } from "./html.ts";
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
});

/** A version of {@link TranslationKV} that doesn't require the Map constructor */
type TranslationKVSimple = {
  [K: string]:
    | string
    | string[]
    | boolean
    | TranslationKVSimple
    | TranslationKVSimple[];
};
/** A version of {@link LanguageFiles} that doesn't require the Map constructor */
type LanguageFilesSimple = {
  global?: TranslationKVSimple;
  [languageCode: string]: TranslationKVSimple | undefined;
};

const createMockVFS = (translations: LanguageFilesSimple): VFS => {
  // Helper to convert nested objects to Maps recursively
  const createNestedMap = (obj: TranslationKVSimple): TranslationKV => {
    const map = new Map();
    for (const [key, value] of Object.entries(obj)) {
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        map.set(key, createNestedMap(value));
      } else {
        map.set(key, value);
      }
    }
    return map;
  };

  const vfs = new VFS();

  vfs.buildUtils.langFiles = new Map([
    [
      "/",
      {
        global: new Map([
          ["siteName", "Test Site"],
          ["menuItems", ["home", "about", "contact"]],
          ["userLoggedIn", false],
          ["featureEnabled", true],
        ] as [string, string | string[] | boolean][]),
        en: createNestedMap(translations.en || {}),
        de: createNestedMap(translations.de || {}),
      },
    ],
  ]);
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
