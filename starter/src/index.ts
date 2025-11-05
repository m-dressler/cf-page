// This will be bundled by @md/cf-page
import { $ } from "@lib/client/utils.ts";
import onDomReady from "@md/on-dom-ready";

console.log("Hello World!");

onDomReady(() => {
  const langSelect = $<HTMLSelectElement>("#lang-select");
  const pathPieces = location.pathname.split("/");
  let currentLang = pathPieces[1];

  // Get the language item, if language is selected, of the url
  const currentLangItem = langSelect.options.namedItem(currentLang);
  // If we have a translation for the language, mark it as selected in the UI
  if (currentLangItem) currentLangItem.selected = true;
  // If there's no item for it, we're in the default language
  else currentLang = "en";

  const path = currentLangItem
    ? "/" + pathPieces.slice(2).join("/")
    : pathPieces.join("/");

  langSelect.addEventListener("change", (e: Event) => {
    const lang = (e.target as HTMLSelectElement).value;
    // If the selected language is the default language, redirect to the root
    if (lang === "en") location.href = path;
    // Otherwise, redirect to the language path
    else location.href = `/${lang}` + path;
  });
});
