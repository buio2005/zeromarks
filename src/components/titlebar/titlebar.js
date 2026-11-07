// @ts-check

import { getLanguage, setLanguage, t } from "../../shared/i18n/i18n.js";
import { attr, effect, listener, mount, requireElement, requireRef, template } from "../../shared/runtime/naf.js";
import {
  closeApplication,
  hasNativeWindowHost,
  minimiseWindow as hostMinimiseWindow,
  toggleMaximiseWindow as hostToggleMaximiseWindow,
} from "../../shared/runtime/window-host.js";
import { appState } from "../../shared/state/app-state.js";
import { APP_INFO } from "../../shared/app-info.js";
import { aboutDialog } from "../../features/about/about-dialog.js";
import { saving } from "../../shared/state/save-state.js";

/** @returns {void} */
function minimiseWindow() {
  if (!appState.selectors.hasNativeWindowHost()) {
    return;
  }
  void hostMinimiseWindow();
}

/** @returns {Promise<void>} */
async function toggleMaximiseWindow() {
  if (!appState.selectors.hasNativeWindowHost()) {
    return;
  }
  await hostToggleMaximiseWindow();
  await appState.actions.syncWindowState();
}

/** @returns {void} */
function closeWindow() {
  if (!appState.selectors.hasNativeWindowHost()) {
    return;
  }
  void closeApplication();
}

/**
 * @returns {Component<HTMLElement>}
 */
function createTitlebarBrandComponent() {
  const renderBrand = /** @type {TemplateTag} */ (
    template({
      onMount(_el, _host, ctx) {
        const { cleanup } = ctx;
        cleanup.add(
          effect(() => {
            const isSaving = saving();
            const spinner = document.querySelector(".titlebar__save-spinner");
            if (spinner instanceof HTMLElement) {
              if (isSaving) {
                spinner.hidden = false;
                spinner.removeAttribute("aria-hidden");
              } else {
                spinner.hidden = true;
                spinner.setAttribute("aria-hidden", "true");
              }
            }
          }),
        );
      },
    })
  );

  return renderBrand /*html*/ `
    <div class="titlebar__brand">
      <div class="titlebar__title-row">
        <h1 class="titlebar__title">${APP_INFO.name}</h1>
        <span
          class="spinner spinner-sm titlebar__save-spinner"
          hidden
          aria-hidden="true"
        ></span>
      </div>
      <p id="titlebar-meta" class="titlebar__meta"></p>
    </div>
  `;
}

/**
 * @returns {Component<HTMLElement>}
 */
function createTitlebarWindowControlsComponent() {
  const renderControls = /** @type {TemplateTag} */ (
    template({
      onMount(_el, _host, ctx) {
        const { refs, cleanup } = ctx;
        const themeToggleButton = /** @type {HTMLButtonElement} */ (requireRef(refs, "themeToggleButton"));
        const languageButton = /** @type {HTMLButtonElement} */ (requireRef(refs, "languageButton"));
        const aboutButton = /** @type {HTMLButtonElement} */ (requireRef(refs, "aboutButton"));
        aboutButton.addEventListener("click", () => aboutDialog.open());
        languageButton.textContent = getLanguage() === "it" ? "IT" : "EN";
        languageButton.addEventListener("click", () => {
          setLanguage(getLanguage() === "it" ? "en" : "it");
        });
        const minimizeButton = /** @type {HTMLButtonElement} */ (requireRef(refs, "minimizeButton"));
        const maximizeButton = /** @type {HTMLButtonElement} */ (requireRef(refs, "maximizeButton"));
        const closeButton = /** @type {HTMLButtonElement} */ (requireRef(refs, "closeButton"));

        const handleMaximiseClick = () => {
          void toggleMaximiseWindow();
        };
        const handleFocus = () => {
          void appState.actions.syncWindowState();
        };

        themeToggleButton.addEventListener("click", () => {
          const current = appState.selectors.getTheme();
          appState.actions.setTheme(current === "light" ? "dark" : "light");
          themeToggleButton.innerHTML = current === "light" ? "🌞" : "🌙";
        });
        themeToggleButton.innerHTML = appState.selectors.getTheme() === "light" ? "🌙" : "🌞";

        cleanup.add(
          listener(minimizeButton, "click", minimiseWindow),
          listener(maximizeButton, "click", handleMaximiseClick),
          listener(closeButton, "click", closeWindow),
          listener(window, "focus", handleFocus),
          attr(minimizeButton, "disabled", () => !appState.selectors.hasNativeWindowHost()),
          attr(maximizeButton, "disabled", () => !appState.selectors.hasNativeWindowHost()),
          attr(closeButton, "disabled", () => !appState.selectors.hasNativeWindowHost()),
          effect(() => {
            const maximised = appState.selectors.isMaximised();

            maximizeButton.textContent = maximised ? "❐" : "□";
            maximizeButton.setAttribute(
              "aria-label",
              t(maximised ? "Restore window" : "Maximize window"),
            );
            maximizeButton.title = t(maximised ? "Restore" : "Maximize");
          }),
        );

        void appState.actions.syncWindowState();
      },
    })
  );

  return renderControls/*html*/`
    <div class="titlebar__window-controls" data-no-window-drag data-ref="windowControls">
      <button
        id="about-button"
        type="button"
        data-ref="aboutButton"
        class="btn btn-ghost btn-sm btn-square"
        title="About and privacy"
        aria-label="About and privacy"
      >
        &#9432;
      </button>
      <button
        id="language-toggle"
        type="button"
        data-ref="languageButton"
        class="btn btn-ghost btn-sm titlebar__language"
        title="Switch language: English / Italiano"
        aria-label="Switch language: English / Italiano"
      >
        EN
      </button>
      <button
        id="theme-toggle"
        data-ref="themeToggleButton"
        class="btn btn-ghost btn-sm btn-square"
      >
        🌙
      </button>
      <button
        id="window-minimize"
        data-ref="minimizeButton"
        class="btn btn-ghost btn-sm btn-square titlebar__window-button"
        type="button"
        aria-label="Minimize window"
      >
        &#9472;
      </button>
      <button
        id="window-maximize"
        data-ref="maximizeButton"
        class="btn btn-ghost btn-sm btn-square titlebar__window-button"
        type="button"
        aria-label="Toggle maximize"
      >
        &#9633;
      </button>
      <button
        id="window-close"
        data-ref="closeButton"
        class="btn btn-ghost btn-sm btn-square titlebar__window-button titlebar__window-button--close"
        type="button"
        aria-label="Close window"
      >
        &#10005;
      </button>
    </div>
  `;
}

/**
 * @returns {Component<HTMLElement>}
 */
function createTitlebarComponent() {
  const brand = createTitlebarBrandComponent();
  const controls = createTitlebarWindowControlsComponent();
  const renderTitlebar = /** @type {TemplateTag} */ (template({}));

  return renderTitlebar/*html*/`
    ${brand}
    ${controls}
  `;
}

/**
 * @param {ParentNode} root
 * @returns {() => void}
 */
export function mountTitlebar(root) {
  const titlebar = /** @type {HTMLElement} */ (requireElement(root, "#titlebar", "titlebar"));
  if (hasNativeWindowHost()) {
    titlebar.setAttribute("data-tauri-drag-region", "");
  }
  const component = createTitlebarComponent();
  mount(component, titlebar);

  return () => {
    component.unmount?.();
    titlebar.replaceChildren();
  };
}
