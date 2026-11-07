// @ts-check

/**
 * Minimal translation layer.
 *
 * Keys are the English texts themselves, so the code stays readable and any text
 * without a translation simply shows in English. Translations live in one plain file
 * per language (see `it.js`) that can be edited by hand.
 *
 * Placeholders use braces: t("Checked {done} of {total} links", { done: 3, total: 9 }).
 * A dictionary key with placeholders also works as a pattern: texts built elsewhere
 * (for example "Move failed: timeout") are matched against "Move failed: {error}".
 */

import it from "./it.js";

/** @typedef {"en" | "it"} Language */

const STORAGE_KEY = "justbookmarks.language";

/** @type {Record<Language, Record<string, string>>} */
const DICTIONARIES = { en: {}, it };

/** @returns {Language} */
function detectLanguage() {
  try {
    const saved = window.localStorage?.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "it") {
      return saved;
    }
  } catch {
    // Storage unavailable: fall through to the system language.
  }
  // Under Node (unit tests) stay in English so results don't depend on the machine.
  const nodeProcess = /** @type {any} */ (globalThis).process;
  if (nodeProcess?.versions?.node) {
    return "en";
  }
  const system = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return system.toLowerCase().startsWith("it") ? "it" : "en";
}

/** @type {Language} */
let language = typeof window === "undefined" ? "en" : detectLanguage();
/** @type {Record<string, string>} */
let dictionary = DICTIONARIES[language];
/** @type {{ regex: RegExp, names: string[], value: string }[]} */
let patterns = compilePatterns(dictionary);

/**
 * @param {string} text
 * @returns {string}
 */
function escapeRegex(text) {
  return text.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

/**
 * @param {Record<string, string>} dict
 * @returns {{ regex: RegExp, names: string[], value: string }[]}
 */
function compilePatterns(dict) {
  /** @param {string} key */
  const literalLength = (key) => key.replace(/\{\w+\}/g, "").trim().length;
  return Object.entries(dict)
    // Plural forms like "{count} items" are only used through tn() with explicit values;
    // as patterns they would match unrelated texts ("Edit items"), so they are skipped,
    // as are keys with almost no fixed text.
    .filter(([key]) => /\{\w+\}/.test(key) && !/^\{count\} [\w-]+$/.test(key) && literalLength(key) >= 4)
    // Most specific first: 'Delete "{title}"?' must win over "Delete {label}".
    .sort(([a], [b]) => literalLength(b) - literalLength(a))
    .map(([key, value]) => {
      /** @type {string[]} */
      const names = [];
      const source = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const match = /^\{(\w+)\}$/.exec(part);
          if (match) {
            names.push(match[1]);
            return "([\\s\\S]+?)";
          }
          return escapeRegex(part);
        })
        .join("");
      return { regex: new RegExp(`^${source}$`), names, value };
    });
}

/**
 * @param {string} text
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function fill(text, params) {
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

/**
 * Translates an English UI text.
 *
 * @param {string} text
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(text, params) {
  if (typeof text !== "string" || text === "") {
    return text;
  }
  let translated = dictionary[text];
  if (translated === undefined && !params && language !== "en") {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(text);
      if (match) {
        /** @type {Record<string, string>} */
        const captured = {};
        pattern.names.forEach((name, index) => {
          captured[name] = t(match[index + 1]);
        });
        return fill(pattern.value, captured);
      }
    }
  }
  if (translated === undefined) {
    translated = text;
  }
  return params ? fill(translated, params) : translated;
}

/**
 * Picks the singular or plural text by count, then translates it.
 * The count is available as {count}.
 *
 * @param {number} count
 * @param {string} one
 * @param {string} many
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function tn(count, one, many, params = {}) {
  return t(count === 1 ? one : many, { count, ...params });
}

/** @returns {Language} */
export function getLanguage() {
  return language;
}

/**
 * Saves the choice and reloads the interface so every text is rebuilt.
 * The open file is reopened automatically after the reload.
 *
 * @param {Language} next
 * @returns {void}
 */
export function setLanguage(next) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Best effort.
  }
  window.location.reload();
}

/**
 * For tests: switch the active dictionary without reloading.
 *
 * @param {Language} next
 * @returns {void}
 */
export function useLanguageForTests(next) {
  language = next;
  dictionary = DICTIONARIES[next];
  patterns = compilePatterns(dictionary);
}

const TRANSLATED_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"];

/**
 * Translates the fixed texts of freshly created markup (template HTML, index.html).
 * Only whole text nodes and a few attributes that exactly match a dictionary key are
 * changed. This runs before any bookmark data is put into the elements.
 *
 * @param {ParentNode} root
 * @returns {void}
 */
export function translateStaticDom(root) {
  if (language === "en") {
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Node | null} */
  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue ?? "";
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (trimmed && Object.hasOwn(dictionary, trimmed)) {
      const leading = /^\s*/.exec(raw)?.[0] ?? "";
      const trailing = /\s*$/.exec(raw)?.[0] ?? "";
      node.nodeValue = `${leading}${dictionary[trimmed]}${trailing}`;
    }
    node = walker.nextNode();
  }
  const elements = root instanceof Element ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
  for (const element of elements) {
    for (const name of TRANSLATED_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value && Object.hasOwn(dictionary, value)) {
        element.setAttribute(name, dictionary[value]);
      }
    }
  }
}
