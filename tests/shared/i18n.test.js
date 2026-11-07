// @ts-check

import { describe, test } from "../lib/test.js";
import { strictEqual } from "../lib/assert.js";
import { t, tn, useLanguageForTests } from "../../src/shared/i18n/i18n.js";
import it from "../../src/shared/i18n/it.js";

/**
 * @param {() => void} fn
 */
function inItalian(fn) {
  useLanguageForTests("it");
  try {
    fn();
  } finally {
    useLanguageForTests("en");
  }
}

describe("i18n", () => {
  test("English is the identity, with placeholders filled", () => {
    strictEqual(t("Delete"), "Delete");
    strictEqual(t("Checked {done} of {total} links", { done: 2, total: 9 }), "Checked 2 of 9 links");
  });

  test("Italian exact keys and placeholders", () => {
    inItalian(() => {
      strictEqual(t("Delete"), "Elimina");
      strictEqual(t("Checked {done} of {total} links", { done: 2, total: 9 }), "Controllati 2 link su 9");
      strictEqual(t("Some text nobody translated"), "Some text nobody translated");
    });
  });

  test("tn picks singular or plural", () => {
    inItalian(() => {
      strictEqual(tn(1, "{count} copy", "{count} copies"), "1 copia");
      strictEqual(tn(3, "{count} copy", "{count} copies"), "3 copie");
    });
  });

  test("texts built elsewhere are matched against pattern keys", () => {
    inItalian(() => {
      strictEqual(t("Move failed: timeout"), "Spostamento non riuscito: timeout");
      strictEqual(t('Delete "My site"?'), 'Eliminare "My site"?');
      strictEqual(t("Access denied (403), the site may block automatic checks"),
        "Accesso negato (403), il sito potrebbe bloccare i controlli automatici");
    });
  });

  test("the most specific pattern wins and captured parts are translated too", () => {
    inItalian(() => {
      strictEqual(t("Undid Delete 3 Items"), "Annullato: Elimina 3 elementi");
      strictEqual(t("Undid Sort Folder"), "Annullato: Ordina cartella");
      strictEqual(t("Delete Folders"), "Elimina Cartelle");
    });
  });

  test("short pattern keys are not used for guessing", () => {
    inItalian(() => {
      strictEqual(t("Edit item"), "Modifica l'elemento");
      strictEqual(t("Weird item"), "Weird item");
    });
  });

  test("every Italian entry keeps the same placeholders as its key", () => {
    for (const [key, value] of Object.entries(it)) {
      const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      strictEqual(names(value), names(key), `placeholders differ for: ${key}`);
    }
  });
});
