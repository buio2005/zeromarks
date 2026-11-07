// @ts-check

import { t, tn } from "../../shared/i18n/i18n.js";
import { DeleteNodes, OpenURL } from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { trapFocusInContainer } from "../../shared/infra/focus.js";
import {
  cleanupCollector,
  effect,
  listener,
  mount,
  requireElement,
  requireRef,
  template,
  when,
} from "../../shared/runtime/naf.js";
import { uiState } from "../../shared/state/ui-state.js";
import { treeState } from "../tree/state/tree-state.js";
import { linkCheckState } from "./link-check-state.js";

const { phase, total, checked, rows, counts, removeIds, offline, errorMessage, stopped } = linkCheckState.signals;

/** @type {{ status: LinkCheckStatus, title: string, hint: string }[]} */
const SECTIONS = [
  { status: "broken", title: "Not working", hint: "The page or the whole site is gone. Selected for removal by default." },
  {
    status: "uncertain",
    title: "Could not verify",
    hint: "Often temporary or the site blocks automatic checks. Open them to check by hand.",
  },
  { status: "redirected", title: "Moved", hint: "Still working, but now at a different address." },
];


/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * @param {import("./link-check-state.js").LinkCheckRow} row
 * @returns {HTMLElement}
 */
function renderRow(row) {
  const removing = linkCheckState.selectors.isMarkedForRemoval(row.id);
  const container = el("div", "link-check-dialog__row");
  container.classList.toggle("is-removing", removing);

  const label = el("label", "link-check-dialog__row-main");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "link-check-dialog__checkbox";
  checkbox.checked = removing;
  checkbox.dataset.itemId = row.id;
  checkbox.setAttribute("aria-label", t('Remove "{title}"', { title: row.title || row.url }));

  const text = el("span", "link-check-dialog__row-text");
  text.append(el("span", "link-check-dialog__row-title", row.title || row.url));
  const address = row.finalUrl ? `${row.url}  →  ${row.finalUrl}` : row.url;
  const urlLine = el("span", "link-check-dialog__row-url", address);
  urlLine.title = address;
  text.append(urlLine);
  text.append(el("span", "link-check-dialog__row-meta", `${row.folderPath || t("Root")} · ${t(row.message)}`));
  label.append(checkbox, text);

  const openButton = /** @type {HTMLButtonElement} */ (el("button", "btn btn-ghost btn-sm", t("Open")));
  openButton.type = "button";
  openButton.dataset.openUrl = row.url;
  openButton.title = t("Open in your browser to check by hand");

  container.append(label, openButton);
  return container;
}

/**
 * @param {import("./link-check-state.js").LinkCheckRow[]} allRows
 * @returns {HTMLElement[]}
 */
function renderSections(allRows) {
  return SECTIONS.flatMap((section) => {
    const sectionRows = allRows.filter((row) => row.status === section.status);
    if (sectionRows.length === 0) {
      return [];
    }
    const card = el("section", "link-check-dialog__group");
    const header = el("header", "link-check-dialog__group-header");
    const heading = el("div", "link-check-dialog__group-heading");
    heading.append(
      el("span", "link-check-dialog__group-title", t(section.title)),
      el("span", "link-check-dialog__group-hint", t(section.hint)),
    );
    const selectAll = /** @type {HTMLButtonElement} */ (el("button", "btn btn-ghost btn-sm", t("Select all")));
    selectAll.type = "button";
    selectAll.dataset.selectStatus = section.status;
    header.append(heading, el("span", "badge", String(sectionRows.length)), selectAll);
    card.append(header, ...sectionRows.map(renderRow));
    return [card];
  });
}

async function removeSelected() {
  const ids = removeIds();
  if (ids.length === 0) {
    return;
  }
  try {
    await DeleteNodes(ids);
    treeState.actions.clearSelection();
    await treeState.actions.refresh();
    linkCheckState.actions.close();
    uiState.actions.showToast(
      tn(ids.length, "{count} bookmark removed. Press Ctrl+Z to undo.", "{count} bookmarks removed. Press Ctrl+Z to undo."),
      "success",
    );
  } catch (caughtError) {
    uiState.actions.showToast(getErrorMessage(caughtError, "Failed to remove bookmarks"), "error");
  }
}

/** @returns {Component} */
function createLinkCheckDialogComponent() {
  const cleanup = cleanupCollector();
  const render = /** @type {TemplateTag} */ (
    template({
      onMount(_el, _parent, ctx) {
        const backdrop = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "backdrop"));
        const dialog = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "dialog"));
        const subtitle = /** @type {HTMLElement} */ (requireRef(ctx.refs, "subtitle"));
        const intro = /** @type {HTMLElement} */ (requireRef(ctx.refs, "intro"));
        const progressShell = /** @type {HTMLElement} */ (requireRef(ctx.refs, "progressShell"));
        const progress = /** @type {HTMLProgressElement} */ (requireRef(ctx.refs, "progress"));
        const notice = /** @type {HTMLElement} */ (requireRef(ctx.refs, "notice"));
        const list = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "list"));
        const clearButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "clearButton"));
        const closeButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "closeButton"));
        const primaryButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "primaryButton"));

        let busy = false;

        // Header, progress and buttons (cheap, re-run on every progress tick).
        cleanup.add(
          effect(() => {
            const currentPhase = phase();
            const done = checked();
            const all = total();
            const problems = rows();
            const toRemove = removeIds().length;
            const error = errorMessage();

            intro.hidden = currentPhase !== "idle";
            progressShell.hidden = currentPhase !== "running";
            list.hidden = currentPhase === "idle" || problems.length === 0;

            if (currentPhase === "idle") {
              subtitle.textContent = t("Find bookmarks whose page no longer exists.");
            } else if (currentPhase === "running") {
              subtitle.textContent = stopped()
                ? t("Stopping after the current batch…")
                : t("Checked {done} of {total} links", { done, total: all || "…" }) +
                  " · " +
                  tn(problems.length, "{count} problem so far", "{count} problems so far");
              progress.max = Math.max(all, 1);
              progress.value = done;
            } else {
              const { ok, skipped } = counts();
              const partial = done < all ? t(" (stopped after {done} of {total})", { done, total: all }) : "";
              subtitle.textContent =
                tn(ok, "{count} link works", "{count} links work") +
                ", " +
                tn(problems.length, "{count} needs a look", "{count} need a look") +
                (skipped ? t(", {count} non-web links skipped", { count: skipped }) : "") +
                partial +
                ".";
            }

            notice.hidden = !(error || (currentPhase === "done" && offline()));
            notice.textContent = error
              ? t(error)
              : t("No website answered at all. Your computer may be offline, so nothing was selected for removal.");

            clearButton.hidden = currentPhase !== "done" || problems.length === 0;
            closeButton.textContent = t(currentPhase === "done" ? "Close" : "Cancel");
            if (currentPhase === "idle") {
              primaryButton.textContent = t("Start check");
              primaryButton.disabled = false;
              primaryButton.className = "btn btn-primary btn-sm";
            } else if (currentPhase === "running") {
              primaryButton.textContent = t("Stop");
              primaryButton.disabled = stopped();
              primaryButton.className = "btn btn-ghost btn-sm";
            } else {
              primaryButton.hidden = problems.length === 0;
              primaryButton.textContent =
                toRemove === 0 ? t("Nothing selected") : tn(toRemove, "Remove {count} bookmark", "Remove {count} bookmarks");
              primaryButton.disabled = busy || toRemove === 0;
              primaryButton.className = "btn btn-primary btn-sm";
            }
          }),
          // Result list (rebuilt only when results or the selection change).
          effect(() => {
            const problems = rows();
            void removeIds();
            const scrollTop = list.scrollTop;
            list.replaceChildren(...renderSections(problems));
            list.scrollTop = scrollTop;
          }),
        );

        const handlePrimary = async () => {
          const currentPhase = phase();
          if (currentPhase === "idle") {
            void linkCheckState.actions.start();
          } else if (currentPhase === "running") {
            linkCheckState.actions.stop();
          } else if (!busy) {
            busy = true;
            primaryButton.disabled = true;
            try {
              await removeSelected();
            } finally {
              busy = false;
            }
          }
        };

        /** @param {Event} event */
        const handleListChange = (event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.dataset.itemId) {
            const id = target.dataset.itemId;
            linkCheckState.actions.toggleRemove(id);
            const again = list.querySelector(`input[data-item-id="${CSS.escape(id)}"]`);
            if (again instanceof HTMLInputElement) {
              again.focus();
            }
          }
        };

        /** @param {MouseEvent} event */
        const handleListClick = (event) => {
          const target = event.target instanceof Element ? event.target.closest("button") : null;
          if (!target) {
            return;
          }
          if (target.dataset.openUrl) {
            void OpenURL(target.dataset.openUrl).catch((caughtError) =>
              uiState.actions.showToast(getErrorMessage(caughtError, "Could not open the link"), "error"),
            );
          } else if (target.dataset.selectStatus) {
            linkCheckState.actions.selectAllWithStatus(/** @type {LinkCheckStatus} */ (target.dataset.selectStatus));
          }
        };

        /** @param {KeyboardEvent} event */
        const handleKeydown = (event) => {
          // Keep tree shortcuts (Delete, A, M, ...) from acting on the library behind the dialog.
          event.stopPropagation();
          if (trapFocusInContainer(event, dialog)) {
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            linkCheckState.actions.close();
          }
        };

        cleanup.add(
          listener(backdrop, "click", () => {
            // A misclick outside must not throw away a long-running check.
            if (phase() !== "running") {
              linkCheckState.actions.close();
            }
          }),
          listener(dialog, "click", (event) => event.stopPropagation()),
          listener(dialog, "keydown", handleKeydown),
          listener(list, "change", handleListChange),
          listener(list, "click", handleListClick),
          listener(clearButton, "click", () => linkCheckState.actions.clearSelection()),
          listener(closeButton, "click", () => linkCheckState.actions.close()),
          listener(primaryButton, "click", () => void handlePrimary()),
        );

        queueMicrotask(() => primaryButton.focus());
      },
      onUnmount() {
        cleanup.run();
      },
    })
  );

  return render /*html*/ `
    <div class="modal-backdrop" role="presentation" data-ref="backdrop">
      <div
        class="modal link-check-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-check-dialog-title"
        tabindex="-1"
        data-focus-zone="dialog"
        data-ref="dialog"
      >
        <div class="modal__header">
          <div>
            <h3 class="shell-panel__title" id="link-check-dialog-title">Check links</h3>
            <p class="shell-panel__subtitle" data-ref="subtitle" aria-live="polite"></p>
          </div>
        </div>
        <div class="modal__body link-check-dialog__body">
          <div class="link-check-dialog__intro" data-ref="intro">
            <p>Every bookmarked website is contacted once to see if the page still exists.
              With a few hundred bookmarks this takes a minute or two; you can stop at any time.</p>
            <p>Nothing is changed until you choose what to remove, and removal can be undone with Ctrl+Z.</p>
          </div>
          <div class="link-check-dialog__progress" data-ref="progressShell" hidden>
            <progress class="link-check-dialog__progress-bar" data-ref="progress" value="0" max="1"></progress>
          </div>
          <p class="link-check-dialog__notice" data-ref="notice" hidden></p>
          <div class="link-check-dialog__list" data-ref="list" hidden></div>
        </div>
        <div class="modal__footer">
          <div class="link-check-dialog__footer-left">
            <button type="button" class="btn btn-ghost btn-sm" data-ref="clearButton" hidden>Clear selection</button>
          </div>
          <div class="link-check-dialog__footer-right">
            <button type="button" class="btn btn-ghost btn-sm" data-ref="closeButton">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" data-ref="primaryButton">Start check</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** @returns {Component} */
function createEmptyComponent() {
  return { html: "", refs: {}, mount() {}, unmount() {} };
}

/**
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountLinkCheckDialog(root) {
  const container = /** @type {HTMLElement} */ (
    requireElement(root, "#link-check-dialog-container", "link-check-dialog-container")
  );
  const renderShell = /** @type {TemplateTag} */ (template);
  const component = renderShell`
    ${when(
      () => linkCheckState.selectors.isOpen(),
      () => createLinkCheckDialogComponent(),
      () => createEmptyComponent(),
    )}
  `;
  mount(component, container);
  return {
    cleanup() {
      component.unmount?.();
    },
  };
}
