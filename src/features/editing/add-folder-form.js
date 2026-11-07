// @ts-check

import { t } from "../../shared/i18n/i18n.js";
import { AddFolder } from "../../shared/api/api.js";
import {
  cleanupCollector,
  effect,
  fx,
  listener,
  model,
  raw,
  requireRef,
  signal,
  show,
  template,
} from "../../shared/runtime/naf.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { appState } from "../../shared/state/app-state.js";
import { treeState } from "../tree/state/tree-state.js";
import { uiState } from "../../shared/state/ui-state.js";

/**
 * @typedef {object} AddFolderFormOptions
 * @property {string} triggerLabel
 * @property {string=} triggerClassName
 * @property {string=} formTitle
 * @property {string=} submitLabel
 * @property {string=} triggerKeyboardAction
 * @property {string=} triggerAriaLabel
 * @property {string=} triggerTitle
 * @property {string=} triggerIconClassName
 * @property {() => string} getParentFolderId
 * @property {() => boolean=} isAvailable
 * @property {(() => void)=} onAdded
 */

/**
 * @param {AddFolderFormOptions} options
 * @returns {Component<HTMLElement>}
 */
export function createAddFolderForm(options) {
  const open = signal(false);
  const busy = signal(false);
  const name = signal("");
  const errorMessage = signal("");
  const cleanup = cleanupCollector();

  const renderAddFolderForm = /** @type {TemplateTag} */ (
    template({
      root: ".add-folder-launcher",
      onMount(el, _parent, ctx) {
        const trigger = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "trigger"));
        const panel = /** @type {HTMLElement} */ (requireRef(ctx.refs, "panel"));
        const input = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "input"));
        const error = /** @type {HTMLElement} */ (requireRef(ctx.refs, "error"));
        const submit = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "submit"));
        const cancel = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "cancel"));
        const launcher = /** @type {HTMLElement} */ (el);

        const panelEl = panel;
        const detailPaneContent = panelEl.closest(".detail-pane__content");
        const treePane = panelEl.closest(".tree-pane");
        let isPositionListenerAttached = false;
        const nameBinding = model(input, name, { reactive: true });

        /**
         * @param {number} value
         * @param {number} min
         * @param {number} max
         * @returns {number}
         */
        function clamp(value, min, max) {
          return Math.min(Math.max(value, min), max);
        }

        function clearPanelPlacement() {
          panelEl.style.removeProperty("left");
          panelEl.style.removeProperty("right");
          panelEl.style.removeProperty("top");
          panelEl.style.removeProperty("bottom");
        }

        function positionPanel() {
          const inDetailActions = Boolean(panelEl.closest(".detail-inline-actions"));
          const inTreeActions = Boolean(panelEl.closest(".tree-pane__actions"));
          const boundaryContainer = inDetailActions
            ? detailPaneContent
            : inTreeActions
              ? treePane
              : null;
          if (!(boundaryContainer instanceof HTMLElement)) {
            return;
          }
          const launcher = panelEl.parentElement;
          if (!(launcher instanceof HTMLElement)) {
            return;
          }

          // Start from default "below + right aligned" placement.
          panelEl.style.left = "0px";
          panelEl.style.right = "auto";
          panelEl.style.top = "calc(100% + 0.4rem)";
          panelEl.style.bottom = "auto";

          const margin = 8;
          const gap = 6;
          const containerRect = boundaryContainer.getBoundingClientRect();
          const launcherRect = launcher.getBoundingClientRect();
          const panelRect = panelEl.getBoundingClientRect();
          if (panelRect.width === 0 || panelRect.height === 0) {
            return;
          }

          const defaultLeft = launcherRect.width - panelRect.width;
          const minLeft = containerRect.left + margin - launcherRect.left;
          const maxLeft = containerRect.right - margin - panelRect.width - launcherRect.left;
          const nextLeft = minLeft <= maxLeft
            ? clamp(defaultLeft, minLeft, maxLeft)
            : minLeft;
          panelEl.style.left = `${Math.round(nextLeft)}px`;

          const spaceBelow = containerRect.bottom - launcherRect.bottom - margin;
          const spaceAbove = launcherRect.top - containerRect.top - margin;
          const shouldOpenUp =
            spaceBelow < panelRect.height + gap && spaceAbove > spaceBelow;

          if (shouldOpenUp) {
            panelEl.style.top = "auto";
            panelEl.style.bottom = `${Math.round(launcherRect.height + gap)}px`;
          }
        }

        function attachPositionListeners() {
          if (isPositionListenerAttached) {
            return;
          }
          if (detailPaneContent instanceof HTMLElement && panelEl.closest(".detail-inline-actions")) {
            detailPaneContent.addEventListener("scroll", positionPanel);
          }
          window.addEventListener("resize", positionPanel);
          isPositionListenerAttached = true;
        }

        function detachPositionListeners() {
          if (!isPositionListenerAttached) {
            return;
          }
          if (detailPaneContent instanceof HTMLElement) {
            detailPaneContent.removeEventListener("scroll", positionPanel);
          }
          window.removeEventListener("resize", positionPanel);
          isPositionListenerAttached = false;
        }

        /**
         * @param {boolean} nextOpen
         * @returns {void}
         */
        function setOpen(nextOpen) {
          open(nextOpen);
          if (nextOpen) {
            attachPositionListeners();
            queueMicrotask(() => {
              positionPanel();
              input.focus();
            });
          } else {
            detachPositionListeners();
            clearPanelPlacement();
            name("");
            errorMessage("");
          }
        }

        async function submitForm() {
          if (busy()) {
            return;
          }

          const nextName = name().trim();
          if (!nextName) {
            errorMessage("Folder name is required");
            input.focus();
            return;
          }

          errorMessage("");
          busy(true);

          try {
            const createdFolder = await AddFolder(options.getParentFolderId(), nextName);
            const inserted = treeState.actions.insertFlatNode(
              createdFolder.parentId,
              createdFolder,
            );
            if (!inserted) {
              await treeState.actions.refresh();
            }
            if (treeState.selectors.getNode(createdFolder.id)) {
              treeState.actions.selectSingle(createdFolder.id);
            }
            uiState.actions.showToast("Folder created", "success");
            setOpen(false);
            options.onAdded?.();
          } catch (caughtError) {
            errorMessage(getErrorMessage(caughtError, "Failed to create folder"));
          } finally {
            busy(false);
          }
        }

        function handleTriggerClick() {
          if (open()) {
            setOpen(false);
            return;
          }
          setOpen(true);
        }

        function handleCancelClick() {
          setOpen(false);
        }

        function handleSubmitClick() {
          void submitForm();
        }

        /** @param {KeyboardEvent} event */
        function handleInputKeydown(event) {
          if (event.key === "Enter") {
            event.preventDefault();
            void submitForm();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }

        /** @param {FocusEvent} event */
        function handleLauncherFocusOut(event) {
          if (!open()) {
            return;
          }

          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && launcher.contains(nextTarget)) {
            return;
          }

          setOpen(false);
        }

        /** @param {PointerEvent} event */
        function handleDocumentPointerDown(event) {
          if (!open()) {
            return;
          }

          const target = event.target;
          if (target instanceof Node && launcher.contains(target)) {
            return;
          }

          setOpen(false);
        }

        cleanup.add(
          listener(trigger, "click", handleTriggerClick),
          listener(submit, "click", handleSubmitClick),
          listener(cancel, "click", handleCancelClick),
          listener(input, "keydown", handleInputKeydown),
          listener(launcher, "focusout", handleLauncherFocusOut),
          listener(document, "pointerdown", handleDocumentPointerDown),
          nameBinding.cleanup,
          effect(() => {
            const available = options.isAvailable
              ? options.isAvailable()
              : Boolean(appState.selectors.getCurrentFilePath());
            trigger.disabled = !available;
            if (!available) {
              setOpen(false);
            }
          }),
          show(panel, open),
          fx(error, (currentError) => {
            const message = errorMessage();
            currentError.hidden = message.length === 0;
            currentError.textContent = t(message);
          }),
          fx(submit, (currentSubmit) => {
            currentSubmit.disabled = busy();
          }),
          () => detachPositionListeners(),
        );
      },
      onUnmount() {
        cleanup.run();
      },
    })
  );

  return renderAddFolderForm`
    <div class="add-folder-launcher">
      <button
        type="button"
        class="${options.triggerClassName ?? "btn btn-secondary btn-sm"}"
        data-ref="trigger"
        ${raw(options.triggerKeyboardAction ? `data-keyboard-action="${options.triggerKeyboardAction}"` : "")}
        ${raw(options.triggerAriaLabel ? `aria-label="${options.triggerAriaLabel}"` : "")}
        ${raw(options.triggerTitle ? `title="${options.triggerTitle}"` : "")}
      >
        ${raw(options.triggerIconClassName
          ? `<span class="${options.triggerIconClassName}" aria-hidden="true"></span>`
          : options.triggerLabel)}
      </button>
      <div class="panel add-folder-panel" hidden data-ref="panel">
        <p class="eyebrow label">${options.formTitle ?? "Create folder"}</p>
        <div class="field">
          <input
            type="text"
            class="input"
            placeholder="Folder name"
            data-keyboard-action="add-folder-name"
            data-ref="input"
          />
          <p class="error-text" hidden data-ref="error"></p>
        </div>
        <div class="detail-inline-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-ref="submit">
            ${options.submitLabel ?? "Add Folder"}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" data-ref="cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}
