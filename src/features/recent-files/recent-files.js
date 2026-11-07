// @ts-check

import { t } from "../../shared/i18n/i18n.js";
import { openRecentFile } from "../../app/session.js";
import { cleanupCollector, effect, listener, signal } from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";
import { uiState } from "../../shared/state/ui-state.js";

const menuOpen = signal(false, { label: "recentFiles.menuOpen" });

/**
 * Splits a Windows or POSIX path into file name and containing folder.
 *
 * @param {string} path
 * @returns {{ name: string, folder: string }}
 */
export function splitPath(path) {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut < 0) {
    return { name: path, folder: "" };
  }
  return { name: path.slice(cut + 1), folder: path.slice(0, cut) };
}

export const recentFilesMenu = {
  /** @returns {void} */
  toggle() {
    menuOpen(!menuOpen());
  },
  /** @returns {void} */
  close() {
    menuOpen(false);
  },
};

/**
 * @param {string} path
 * @param {boolean} current
 * @returns {HTMLButtonElement}
 */
function renderItem(path, current) {
  const { name, folder } = splitPath(path);
  const item = document.createElement("button");
  item.type = "button";
  item.className = "recent-files__item";
  item.classList.toggle("is-current", current);
  item.dataset.path = path;
  item.title = path;
  item.setAttribute("role", "menuitem");

  const nameEl = document.createElement("span");
  nameEl.className = "recent-files__name";
  nameEl.textContent = current ? t("{name} (open)", { name }) : name;
  const folderEl = document.createElement("span");
  folderEl.className = "recent-files__folder";
  folderEl.textContent = folder;
  item.append(nameEl, folderEl);
  return item;
}

/**
 * @param {HTMLElement} container
 * @param {MouseEvent} event
 * @param {() => void} afterOpen
 * @returns {void}
 */
function handleItemClick(container, event, afterOpen) {
  const target = event.target instanceof Element ? event.target.closest("button") : null;
  if (!target || !container.contains(target)) {
    return;
  }
  if (target.dataset.action === "clear") {
    appState.actions.clearRecentFiles();
    return;
  }
  if (target.dataset.path) {
    const path = target.dataset.path;
    afterOpen();
    if (path === appState.selectors.getCurrentFilePath()) {
      uiState.actions.showToast("This file is already open", "info");
      return;
    }
    void openRecentFile(path);
  }
}

/**
 * Toolbar dropdown listing recent files.
 *
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} menu
 * @returns {() => void}
 */
export function bindRecentFilesMenu(button, menu) {
  const cleanup = cleanupCollector();

  cleanup.add(
    effect(() => {
      const isOpen = menuOpen();
      const files = appState.selectors.getRecentFiles();
      const current = appState.selectors.getCurrentFilePath();
      menu.hidden = !isOpen;
      button.setAttribute("aria-expanded", String(isOpen));
      if (!isOpen) {
        return;
      }

      const heading = document.createElement("div");
      heading.className = "eyebrow recent-files__heading";
      heading.textContent = t("Recent files");
      /** @type {HTMLElement[]} */
      const children = [heading];
      if (files.length === 0) {
        const empty = document.createElement("div");
        empty.className = "recent-files__empty";
        empty.textContent = t("No recent files yet.");
        children.push(empty);
      } else {
        children.push(...files.map((path) => renderItem(path, path === current)));
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "btn btn-ghost btn-sm recent-files__clear";
        clear.dataset.action = "clear";
        clear.textContent = t("Clear list");
        children.push(clear);
      }
      menu.replaceChildren(...children);
      queueMicrotask(() => {
        const first = menu.querySelector(".recent-files__item:not(.is-current), .recent-files__item");
        if (first instanceof HTMLElement) {
          first.focus();
        }
      });
    }),
    listener(button, "click", (event) => {
      event.stopPropagation();
      recentFilesMenu.toggle();
    }),
    listener(menu, "click", (event) => {
      event.stopPropagation();
      handleItemClick(menu, event, () => recentFilesMenu.close());
    }),
    listener(menu, "keydown", (event) => {
      // Keep tree shortcuts from firing while the menu has focus.
      event.stopPropagation();
      const items = [...menu.querySelectorAll("button")];
      const index = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      if (event.key === "Escape") {
        event.preventDefault();
        recentFilesMenu.close();
        button.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
      }
    }),
    listener(document, "click", () => recentFilesMenu.close()),
    () => recentFilesMenu.close(),
  );

  return cleanup.run;
}

/**
 * Plain list for the start page (no file open).
 *
 * @param {HTMLElement} container
 * @returns {() => void}
 */
export function bindRecentFilesList(container) {
  const cleanup = cleanupCollector();
  cleanup.add(
    effect(() => {
      const files = appState.selectors.getRecentFiles();
      container.hidden = files.length === 0;
      const heading = document.createElement("div");
      heading.className = "eyebrow recent-files__heading";
      heading.textContent = t("Recent files");
      container.replaceChildren(heading, ...files.map((path) => renderItem(path, false)));
    }),
    listener(container, "click", (event) => handleItemClick(container, event, () => {})),
  );
  return cleanup.run;
}
