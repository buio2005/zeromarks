// @ts-check

/**
 * App identity shown in the interface. When the app gets its final name, change it
 * here and in the places listed in docs/RENAMING.md (installer, window title, ...).
 */
export const APP_INFO = Object.freeze({
  name: "ZeroMarks",
  publisher: "TivuStream",
  copyright: [
    "Copyright © 2026 SellswordSoftware",
    "Copyright © 2026 TivuStream (modifications)",
  ],
  basedOn: Object.freeze({
    name: "JustBookmarks",
    author: "SellswordSoftware",
    url: "https://github.com/SellswordSoftware/justbookmarks",
    license: "MIT",
  }),
});

/**
 * Version from the app bundle (tauri.conf.json), or "" outside the desktop app.
 *
 * @returns {Promise<string>}
 */
export async function getAppVersion() {
  try {
    const app = /** @type {any} */ (window).__TAURI__?.app;
    return app ? String(await app.getVersion()) : "";
  } catch {
    return "";
  }
}
