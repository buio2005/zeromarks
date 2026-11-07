// @ts-check

import { t } from "../i18n/i18n.js";

/**
 * Normalize unknown errors into a user-facing string.
 *
 * @param {unknown} error
 * @param {string} [fallback="Unexpected error"]
 * @returns {string}
 */
export function getErrorMessage(error, fallback = "Unexpected error") {
  if (error instanceof Error && error.message) {
    return t(error.message);
  }

  if (typeof error === "string" && error.length > 0) {
    return t(error);
  }

  return t(fallback);
}
