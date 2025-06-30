import { exists } from "@std/fs/exists";
import * as YAML from "@std/yaml";
import { CONFIG } from "../config.ts";

/** Gets the root language file content */
const getRootLangFile = async (): Promise<Record<string, unknown> | null> => {
  const rootLangPath = `${CONFIG.srcDir}/${CONFIG.langfileName}`;

  if (!(await exists(rootLangPath))) {
    return null;
  }

  try {
    const content = await Deno.readTextFile(rootLangPath);
    const parsed = YAML.parse(content) as Record<string, unknown>;
    return parsed || null;
  } catch {
    return null;
  }
};

/** Gets the list of supported languages from root +lang.yml file */
export const getSupportedLanguages = async (): Promise<string[]> => {
  const rootLangFile = await getRootLangFile();
  if (!rootLangFile) {
    return [];
  }

  const languages: string[] = [];

  // Extract language keys (excluding 'global' and '$defaultLanguage')
  for (const key of Object.keys(rootLangFile)) {
    if (
      key !== "global" && key !== "$defaultLanguage" &&
      typeof rootLangFile[key] === "object"
    ) {
      languages.push(key);
    }
  }

  return languages.sort();
};

/** Checks if multi-language support is enabled */
export const isMultiLanguageEnabled = async (): Promise<boolean> => {
  const languages = await getSupportedLanguages();
  return languages.length > 0;
};

/** Gets the default language from $defaultLanguage key or first available language */
export const getDefaultLanguage = async (): Promise<string | null> => {
  const rootLangFile = await getRootLangFile();
  if (!rootLangFile) {
    return null;
  }

  // Check for $defaultLanguage key
  const defaultLanguage = rootLangFile.$defaultLanguage;
  if (typeof defaultLanguage === "string") {
    return defaultLanguage;
  }

  // Fall back to first available language
  const languages = await getSupportedLanguages();
  return languages.length > 0 ? languages[0] : null;
};
