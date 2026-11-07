// @ts-check

import { t } from "../../shared/i18n/i18n.js";
import { loadFileIntoSession } from "../../app/session.js";
import { CheckExternalChange, KeepLocalVersion } from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { cleanupCollector, effect, listener, requireElement, signal } from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";
import { uiState } from "../../shared/state/ui-state.js";

/** How often the open file is compared with the copy on disk. */
const POLL_MS = 3000;

/** @typedef {"none" | "changed" | "missing"} BannerKind */

const banner = signal(/** @type {BannerKind} */ ("none"), { label: "externalChange.banner" });
const busy = signal(false, { label: "externalChange.busy" });

let checking = false;
/** File path for which the user closed the "missing" notice. */
let dismissedMissingFor = "";

async function check() {
  const path = appState.selectors.getCurrentFilePath();
  if (checking || busy() || !path || banner() !== "none" || document.visibilityState === "hidden") {
    return;
  }
  checking = true;
  try {
    const status = await CheckExternalChange();
    if (path !== appState.selectors.getCurrentFilePath()) {
      return;
    }
    if (status === "changed") {
      banner("changed");
    } else if (status === "missing" && dismissedMissingFor !== path) {
      banner("missing");
    }
  } catch {
    // A failed check is not worth bothering the user; try again next time.
  } finally {
    checking = false;
  }
}

async function reload() {
  const path = appState.selectors.getCurrentFilePath();
  busy(true);
  try {
    if (await loadFileIntoSession(path)) {
      banner("none");
      uiState.actions.showToast("Reloaded the version saved by the other program", "success");
    }
  } finally {
    busy(false);
  }
}

async function keepMine() {
  busy(true);
  try {
    await KeepLocalVersion();
    banner("none");
    uiState.actions.showToast(
      "Kept your version. The other version was saved in the .zeromarks-backups folder.",
      "success",
    );
  } catch (caughtError) {
    uiState.actions.showToast(getErrorMessage(caughtError, "Could not save your version"), "error");
  } finally {
    busy(false);
  }
}

/**
 * Watches the open file for changes made by other programs (sync tools, editors,
 * another ZeroMarks window) and shows a bar with the choices.
 *
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountExternalChangeWatcher(root) {
  const container = /** @type {HTMLElement} */ (
    requireElement(root, "#external-change-container", "external-change-container")
  );
  container.innerHTML = /*html*/ `
    <div class="external-change" role="alert" hidden>
      <span class="external-change__icon" aria-hidden="true">!</span>
      <div class="external-change__text">
        <strong class="external-change__title"></strong>
        <span class="external-change__message"></span>
      </div>
      <div class="external-change__actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="secondary"></button>
        <button type="button" class="btn btn-primary btn-sm" data-action="primary"></button>
      </div>
    </div>
  `;
  const bar = /** @type {HTMLElement} */ (container.querySelector(".external-change"));
  const title = /** @type {HTMLElement} */ (container.querySelector(".external-change__title"));
  const message = /** @type {HTMLElement} */ (container.querySelector(".external-change__message"));
  const primary = /** @type {HTMLButtonElement} */ (container.querySelector('[data-action="primary"]'));
  const secondary = /** @type {HTMLButtonElement} */ (container.querySelector('[data-action="secondary"]'));

  const cleanup = cleanupCollector();
  const timer = window.setInterval(() => void check(), POLL_MS);

  cleanup.add(
    () => window.clearInterval(timer),
    listener(window, "focus", () => void check()),
    effect(() => {
      const kind = banner();
      const isBusy = busy();
      bar.hidden = kind === "none";
      primary.disabled = isBusy;
      secondary.disabled = isBusy;
      if (kind === "changed") {
        title.textContent = t("This file was changed by another program.");
        message.textContent = t(
          "Reload to see those changes (your undo history is cleared), or keep your version (the other one is saved as a backup).",
        );
        primary.textContent = t("Reload");
        secondary.textContent = t("Keep my version");
      } else if (kind === "missing") {
        title.textContent = t("This file was moved, renamed or deleted.");
        message.textContent = t("Your bookmarks are still shown here. Save them again to the same place?");
        primary.textContent = t("Save again");
        secondary.textContent = t("Not now");
      }
    }),
    // A different file was opened: forget notices about the previous one.
    effect(() => {
      void appState.selectors.getCurrentFilePath();
      banner("none");
    }),
    listener(primary, "click", () => {
      if (banner() === "changed") {
        void reload();
      } else if (banner() === "missing") {
        void keepMine();
      }
    }),
    listener(secondary, "click", () => {
      if (banner() === "changed") {
        void keepMine();
      } else if (banner() === "missing") {
        dismissedMissingFor = appState.selectors.getCurrentFilePath();
        banner("none");
      }
    }),
  );

  return {
    cleanup() {
      cleanup.run();
      container.replaceChildren();
    },
  };
}
