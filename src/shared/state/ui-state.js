// @ts-check

import { t } from "../i18n/i18n.js";
import { signal } from "../../shared/runtime/naf.js";

/**
 * UI state owner.
 *
 * Owns:
 * - toast queue
 * - toast expiry bookkeeping
 * - confirm modal state
 * - async confirm execution flow
 */

const DEFAULT_CONFIRM_LABEL = "OK";

const toasts = signal(/** @type {Toast[]} */ ([]), { label: "ui.toasts" });
const modal = signal(
  /** @type {ConfirmModalState} */ ({
    open: false,
    title: "",
    message: "",
    confirmLabel: DEFAULT_CONFIRM_LABEL,
    onConfirm: null,
  }),
  { label: "ui.modal" },
);

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const toastTimers = new Map();

/**
 * @param {number} id
 * @returns {void}
 */
function clearToastTimer(id) {
  const timer = toastTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
}

/**
 * @param {number} id
 * @returns {Toast[]}
 */
function removeToast(id) {
  clearToastTimer(id);
  const nextToasts = toasts().filter((toast) => toast.id !== id);
  toasts(nextToasts);
  return nextToasts;
}

export const uiState = {
  signals: {
    toasts,
    modal,
  },
  computed: {},
  actions: {
    /**
     * @param {string} message
     * @param {ToastType} [type="info"]
     * @param {number} [duration=4000]
     * @returns {number}
     */
    showToast(message, type = "info", duration = 4000) {
      const id = Date.now() + Math.random();
      const nextToast = { id, message: t(message), type };
      toasts([...toasts(), nextToast]);

      const timer = setTimeout(() => {
        removeToast(id);
      }, duration);
      toastTimers.set(id, timer);

      return id;
    },
    /**
     * @param {number} id
     * @returns {Toast[]}
     */
    removeToast,
    /**
     * @returns {Toast[]}
     */
    clearToasts() {
      for (const id of toastTimers.keys()) {
        clearToastTimer(id);
      }
      const empty = /** @type {Toast[]} */ ([]);
      toasts(empty);
      return empty;
    },
    /**
     * @param {string} title
     * @param {string} message
     * @param {string} [confirmLabel=DEFAULT_CONFIRM_LABEL]
     * @param {ConfirmCallback} [onConfirm=null]
     * @returns {ConfirmModalState}
     */
    showConfirm(
      title,
      message,
      confirmLabel = DEFAULT_CONFIRM_LABEL,
      onConfirm = null,
    ) {
      const nextModal = {
        open: true,
        title: t(title),
        message: t(message),
        confirmLabel: t(confirmLabel),
        onConfirm,
      };
      modal(nextModal);
      return nextModal;
    },
    /**
     * @returns {ConfirmModalState}
     */
    closeModal() {
      const nextModal = {
        open: false,
        title: "",
        message: "",
        confirmLabel: DEFAULT_CONFIRM_LABEL,
        onConfirm: null,
      };
      modal(nextModal);
      return nextModal;
    },
    /**
     * @returns {Promise<void>}
     */
    async confirmModal() {
      const currentModal = modal();
      try {
        await currentModal.onConfirm?.();
      } finally {
        uiState.actions.closeModal();
      }
    },
  },
  selectors: {
    /**
     * @returns {Toast[]}
     */
    getToasts() {
      return toasts();
    },
    /**
     * @returns {ConfirmModalState}
     */
    getModal() {
      return modal();
    },
  },
};
