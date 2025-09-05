import { bundle } from "../util/bundle.ts";

const PREVIEW_PREFIX = "/-/cf-page/";
export const PREVIEW_LISTEN_PATH = PREVIEW_PREFIX + "listen";
export const PREVIEW_JS_PATH = PREVIEW_PREFIX + "refresh.js";

export const PREVIEW_JS_SCRIPT = await bundle(
  new URL("./clientScript.ts", import.meta.url).pathname,
  true,
);

/** Adds the live reload script to HTML content */
export const addLiveReloadScript = (
  content: string | BufferSource,
  isSvg = false,
): string | Uint8Array => {
  const refreshScript =
    `<script type="text/javascript" src="${PREVIEW_JS_PATH}"></script>`;

  if (typeof content === "string") {
    if (isSvg) {
      return content.replace("</svg>", `${refreshScript}</svg>`);
    } else {
      return content + refreshScript;
    }
  } else {
    // Handle binary content
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const strContent = decoder.decode(content);

    if (isSvg) {
      return encoder.encode(
        strContent.replace("</svg>", `${refreshScript}</svg>`),
      );
    } else {
      const scriptBytes = encoder.encode(refreshScript);
      const newContent = new Uint8Array(
        content.byteLength + scriptBytes.length,
      );
      if (content instanceof ArrayBuffer) {
        newContent.set(new Uint8Array(content));
      } else {
        newContent.set(
          new Uint8Array(
            content.buffer,
            content.byteOffset,
            content.byteLength,
          ),
        );
      }
      newContent.set(scriptBytes, content.byteLength);
      return newContent;
    }
  }
};
