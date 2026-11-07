// @ts-check

import { OpenURL } from "../../shared/api/api.js";
import { APP_INFO, getAppVersion } from "../../shared/app-info.js";
import { t } from "../../shared/i18n/i18n.js";
import { trapFocusInContainer } from "../../shared/infra/focus.js";
import { cleanupCollector, effect, listener, requireElement, signal } from "../../shared/runtime/naf.js";

const open = signal(false, { label: "about.open" });
/** Which text is shown in the viewer: none, the app license, or third-party notices. */
const viewer = signal(/** @type {"" | "license" | "notices"} */ (""), { label: "about.viewer" });

export const aboutDialog = {
  /** @returns {void} */
  open() {
    viewer("");
    open(true);
  },
  /** @returns {void} */
  close() {
    open(false);
  },
};

/** @type {Record<string, string>} */
const textCache = {};

/**
 * @param {"license" | "notices"} which
 * @returns {Promise<string>}
 */
async function loadText(which) {
  const file = which === "license" ? "licenses/LICENSE.txt" : "licenses/THIRD-PARTY-NOTICES.txt";
  if (!textCache[file]) {
    const response = await fetch(file);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    textCache[file] = await response.text();
  }
  return textCache[file];
}

/**
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountAboutDialog(root) {
  const container = /** @type {HTMLElement} */ (requireElement(root, "#about-dialog-container", "about-dialog-container"));
  const { basedOn } = APP_INFO;

  container.innerHTML = /*html*/ `
    <div class="modal-backdrop" role="presentation" data-ref="backdrop" hidden>
      <div class="modal about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" tabindex="-1" data-focus-zone="dialog">
        <div class="modal__header">
          <div class="about-dialog__identity">
            <img class="about-dialog__logo" src="assets/zeromarks-icon.png" alt="" width="56" height="56" />
            <div>
            <h3 class="shell-panel__title" id="about-title"></h3>
            <p class="shell-panel__subtitle about-dialog__version"></p>
            </div>
          </div>
        </div>
        <div class="modal__body about-dialog__body">
          <section class="about-dialog__section">
            <h4 class="about-dialog__heading" data-text="Your privacy"></h4>
            <p data-text="Everything stays on your computer. Your bookmarks are kept in a plain HTML file that you choose: nothing is uploaded, and there are no accounts, statistics or tracking."></p>
            <p data-text="The app connects to the internet only when you ask it to (refreshing titles and icons, checking links), and then only to the websites of your bookmarks."></p>
          </section>
          <section class="about-dialog__section">
            <h4 class="about-dialog__heading" data-text="Credits"></h4>
            <p class="about-dialog__based-on"></p>
            <p class="about-dialog__copyright"></p>
          </section>
          <div class="about-dialog__links">
            <button type="button" class="btn btn-ghost btn-sm" data-action="license" data-text="License"></button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="notices" data-text="Third-party licenses"></button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="original" data-text="Original project"></button>
          </div>
          <pre class="about-dialog__viewer" tabindex="0" hidden></pre>
        </div>
        <div class="modal__footer">
          <span></span>
          <button type="button" class="btn btn-primary btn-sm" data-action="close" data-text="Close"></button>
        </div>
      </div>
    </div>
  `;

  const backdrop = /** @type {HTMLElement} */ (container.querySelector(".modal-backdrop"));
  const dialog = /** @type {HTMLElement} */ (container.querySelector(".about-dialog"));
  const viewerEl = /** @type {HTMLElement} */ (container.querySelector(".about-dialog__viewer"));
  const versionEl = /** @type {HTMLElement} */ (container.querySelector(".about-dialog__version"));

  for (const el of container.querySelectorAll("[data-text]")) {
    el.textContent = t(el.getAttribute("data-text") ?? "");
  }
  /** @type {HTMLElement} */ (container.querySelector("#about-title")).textContent = t("About {name}", { name: APP_INFO.name });
  /** @type {HTMLElement} */ (container.querySelector(".about-dialog__based-on")).textContent = t(
    "Based on {project} by {author}, released under the {license} license. Thank you!",
    { project: basedOn.name, author: basedOn.author, license: basedOn.license },
  );
  /** @type {HTMLElement} */ (container.querySelector(".about-dialog__copyright")).textContent = APP_INFO.copyright.join("\n");
  void getAppVersion().then((version) => {
    versionEl.textContent = version ? t("Version {version}", { version }) : "";
  });

  const cleanup = cleanupCollector();
  cleanup.add(
    effect(() => {
      const isOpen = open();
      backdrop.hidden = !isOpen;
      if (isOpen) {
        queueMicrotask(() => dialog.focus());
      }
    }),
    effect(() => {
      const which = viewer();
      viewerEl.hidden = which === "";
      if (which === "") {
        return;
      }
      viewerEl.textContent = t("Loading…");
      loadText(which).then(
        (text) => {
          if (viewer() === which) {
            viewerEl.textContent = text;
            viewerEl.scrollTop = 0;
          }
        },
        () => {
          viewerEl.textContent = t("Could not load the license text.");
        },
      );
    }),
    listener(backdrop, "click", () => aboutDialog.close()),
    listener(dialog, "click", (event) => {
      event.stopPropagation();
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      const action = target?.getAttribute("data-action");
      if (action === "close") {
        aboutDialog.close();
      } else if (action === "license" || action === "notices") {
        viewer(viewer() === action ? "" : action);
      } else if (action === "original") {
        void OpenURL(basedOn.url);
      }
    }),
    listener(dialog, "keydown", (event) => {
      // Keep tree shortcuts from acting on the library behind the dialog.
      event.stopPropagation();
      if (trapFocusInContainer(event, dialog)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        aboutDialog.close();
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
