// @ts-check

import { t, tn } from "../../shared/i18n/i18n.js";

/**
 * @typedef {"folders" | "bookmarks" | "duplicates" | "updates"} ImportMergePreviewSectionKey
 * @typedef {{
 *   key: ImportMergePreviewSectionKey,
 *   title: string,
 *   shortLabel: string,
 *   count: number,
 *   tone: "neutral" | "success" | "muted" | "warning",
 *   emptyMessage: string,
 *   rows: ImportMergePreviewRow[],
 * }} ImportMergePreviewSection
 * @typedef {{
 *   primary: string,
 *   secondary: string,
 *   meta?: string,
 *   before?: string,
 *   after?: string,
 * }} ImportMergePreviewRow
 */

/**
 * @param {MergePreview} preview
 * @returns {ImportMergePreviewSection[]}
 */
export function buildImportMergePreviewSections(preview) {
  return [
    {
      key: "folders",
      title: t("Folders to add"),
      shortLabel: t("Folders"),
      count: preview.foldersToAdd.length,
      tone: "success",
      emptyMessage: "No new folders will be created.",
      rows: preview.foldersToAdd.map((item) => ({
        primary: item.name,
        secondary: item.path || t("Root"),
      })),
    },
    {
      key: "bookmarks",
      title: t("Bookmarks to add"),
      shortLabel: t("Bookmarks"),
      count: preview.bookmarksToAdd.length,
      tone: "success",
      emptyMessage: "No new bookmarks will be added.",
      rows: preview.bookmarksToAdd.map((item) => ({
        primary: item.title || item.url,
        secondary: item.url,
        meta: item.folderPath || t("Root"),
      })),
    },
    {
      key: "duplicates",
      title: t("Duplicates ignored"),
      shortLabel: t("Duplicates"),
      count: preview.duplicateBookmarks.length,
      tone: "muted",
      emptyMessage: "No duplicates were detected.",
      rows: preview.duplicateBookmarks.map((item) => ({
        primary: item.title || item.url,
        secondary: item.url,
        meta: item.folderPath || t("Root"),
      })),
    },
    {
      key: "updates",
      title: t("Existing matches"),
      shortLabel: t("Matches"),
      count: preview.potentialUpdates.length,
      tone: "warning",
      emptyMessage: "No existing matches were found.",
      rows: preview.potentialUpdates.map((item) => ({
        primary: item.url,
        secondary: t("Already in {folder}", { folder: item.existingFolderPath || t("Root") }),
        before: item.existingTitle || item.url,
        after: item.incomingTitle || item.url,
      })),
    },
  ];
}

/**
 * @param {HTMLElement} host
 * @param {MergePreview | null} preview
 * @param {boolean} previewLoading
 * @returns {() => void}
 */
export function mountImportMergePreview(host, preview, previewLoading) {
  host.replaceChildren();

  if (previewLoading) {
    host.append(createLoadingCard());
    return () => {
      host.replaceChildren();
    };
  }

  if (!preview) {
    host.append(createEmptyState());
    return () => {
      host.replaceChildren();
    };
  }

  const sections = buildImportMergePreviewSections(preview);
  const visibleSections = sections.filter((section) => section.count > 0);
  const initialSection = visibleSections[0] ?? sections[0] ?? null;

  if (!initialSection) {
    host.append(createEmptyState());
    return () => {
      host.replaceChildren();
    };
  }

  const workspace = document.createElement("section");
  workspace.className = "import-merge-dialog__workspace";

  const summary = document.createElement("div");
  summary.className = "import-merge-dialog__summary";
  for (const section of sections) {
    summary.append(createSummaryCard(section));
  }

  const review = document.createElement("div");
  review.className = "import-merge-dialog__review-shell";

  const nav = document.createElement("div");
  nav.className = "import-merge-dialog__nav";

  const navHeader = document.createElement("div");
  navHeader.className = "import-merge-dialog__nav-header";
  navHeader.innerHTML = /*html*/ `
    <div class="eyebrow import-merge-dialog__nav-eyebrow">${t("Preview")}</div>
    <h3 class="import-merge-dialog__nav-title">${t("Review changes")}</h3>
  `;

  const navList = document.createElement("div");
  navList.className = "import-merge-dialog__nav-list";

  const content = document.createElement("div");
  content.className = "import-merge-dialog__content";

  /** @type {Map<ImportMergePreviewSectionKey, HTMLButtonElement>} */
  const navButtons = new Map();

  /**
   * @param {ImportMergePreviewSection} section
   * @returns {void}
   */
  function renderSection(section) {
    for (const candidate of sections) {
      const button = navButtons.get(candidate.key);
      if (!button) {
        continue;
      }
      const isActive = candidate.key === section.key;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }

    content.replaceChildren(createSectionPanel(section));
  }

  for (const section of sections) {
    const button = createSectionButton(section, () => {
      renderSection(section);
    });
    navButtons.set(section.key, button);
    navList.append(button);
  }

  nav.append(navHeader, navList);
  review.append(nav, content);
  workspace.append(summary, review);
  host.append(workspace);

  renderSection(initialSection);

  return () => {
    host.replaceChildren();
  };
}

/**
 * @returns {HTMLElement}
 */
function createLoadingCard() {
  const loadingCard = document.createElement("div");
  loadingCard.className = "import-merge-dialog__loading";

  const spinner = document.createElement("span");
  spinner.className = "spinner";

  const copy = document.createElement("div");
  copy.className = "import-merge-dialog__loading-copy";
  copy.innerHTML = /*html*/ `
    <strong class="import-merge-dialog__loading-title">${t("Computing merge preview")}</strong>
    <span class="import-merge-dialog__loading-text">${t("Scanning the imported bookmark file for additive changes.")}</span>
  `;

  loadingCard.append(spinner, copy);
  return loadingCard;
}

/**
 * @returns {HTMLElement}
 */
function createEmptyState() {
  const emptyState = document.createElement("section");
  emptyState.className = "panel import-merge-dialog__empty-state";
  emptyState.innerHTML = /*html*/ `
    <div class="eyebrow import-merge-dialog__empty-eyebrow">${t("Preview")}</div>
    <h3 class="import-merge-dialog__empty-title">${t("Choose a bookmark file to compare")}</h3>
    <p class="import-merge-dialog__empty-copy">
      ${t("The preview will show folders and bookmarks to add, duplicates to ignore, and links already in your library.")}
    </p>
  `;
  return emptyState;
}

/**
 * @param {ImportMergePreviewSection} section
 * @returns {HTMLElement}
 */
function createSummaryCard(section) {
  const card = document.createElement("article");
  card.className = `import-merge-dialog__summary-card import-merge-dialog__summary-card--${section.tone}`;
  card.innerHTML = /*html*/ `
    <div class="import-merge-dialog__summary-label">${section.shortLabel}</div>
    <div class="import-merge-dialog__summary-line">
      <span class="import-merge-dialog__summary-value">${section.count}</span>
      <span class="import-merge-dialog__summary-copy">${describeSectionCompact(section)}</span>
    </div>
  `;
  return card;
}

/**
 * @param {ImportMergePreviewSection} section
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function createSectionButton(section, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "import-merge-dialog__nav-button";
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = /*html*/ `
    <span class="import-merge-dialog__nav-button-copy">
      <span class="import-merge-dialog__nav-button-title">${section.title}</span>
      <span class="import-merge-dialog__nav-button-desc">${describeSection(section)}</span>
    </span>
    <span class="badge import-merge-dialog__nav-button-badge">${section.count}</span>
  `;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * @param {ImportMergePreviewSection} section
 * @returns {HTMLElement}
 */
function createSectionPanel(section) {
  const panel = document.createElement("section");
  panel.className = "import-merge-dialog__section-panel";

  const header = document.createElement("div");
  header.className = "import-merge-dialog__section-panel-header";
  header.innerHTML = /*html*/ `
    <div>
      <div class="eyebrow import-merge-dialog__section-eyebrow">${section.shortLabel}</div>
      <h3 class="import-merge-dialog__section-title">${section.title}</h3>
      <p class="import-merge-dialog__section-copy">${describeSection(section)}</p>
    </div>
    <span class="badge import-merge-dialog__section-badge">${section.count}</span>
  `;

  const rows = document.createElement("div");
  rows.className = "import-merge-dialog__rows";

  if (section.rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "import-merge-dialog__empty";
    empty.textContent = t(section.emptyMessage);
    rows.append(empty);
  } else {
    for (const row of section.rows) {
      rows.append(createPreviewRow(section, row));
    }
  }

  panel.append(header, rows);
  return panel;
}

/**
 * @param {ImportMergePreviewSection} section
 * @param {ImportMergePreviewRow} row
 * @returns {HTMLElement}
 */
function createPreviewRow(section, row) {
  const article = document.createElement("article");
  article.className = "import-merge-dialog__row";

  if (section.key === "updates") {
    article.classList.add("import-merge-dialog__row--update");
    const meta = document.createElement("div");
    meta.className = "import-merge-dialog__row-meta";
    meta.textContent = row.secondary;

    const title = document.createElement("div");
    title.className = "import-merge-dialog__row-title";
    title.textContent = row.primary;

    const updateGrid = document.createElement("div");
    updateGrid.className = "import-merge-dialog__update-grid";
    updateGrid.append(
      createUpdateSide("Existing title", row.before || ""),
      createUpdateSide("Imported title", row.after || ""),
    );

    article.append(meta, title, updateGrid);
    return article;
  }

  const main = document.createElement("div");
  main.className = "import-merge-dialog__row-main";

  const title = document.createElement("div");
  title.className = "import-merge-dialog__row-title";
  title.textContent = row.primary;

  const subtitle = document.createElement("div");
  subtitle.className = "import-merge-dialog__row-subtitle";
  subtitle.textContent = row.secondary;

  const meta = document.createElement("div");
  meta.className = "import-merge-dialog__row-meta";
  meta.textContent = row.meta || "";

  main.append(title, subtitle);
  article.append(main, meta);
  return article;
}

/**
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function createUpdateSide(label, value) {
  const side = document.createElement("div");
  side.className = "import-merge-dialog__update-side";

  const labelEl = document.createElement("div");
  labelEl.className = "import-merge-dialog__update-label";
  labelEl.textContent = t(label);

  const valueEl = document.createElement("div");
  valueEl.className = "import-merge-dialog__update-value";
  valueEl.textContent = value;

  side.append(labelEl, valueEl);
  return side;
}

/**
 * @param {ImportMergePreviewSection} section
 * @returns {string}
 */
function describeSection(section) {
  if (section.key === "duplicates") {
    return tn(section.count, "{count} duplicate will be ignored", "{count} duplicates will be ignored");
  }

  if (section.key === "updates") {
    return tn(
      section.count,
      "{count} link already in your library: kept, missing details filled in",
      "{count} links already in your library: kept, missing details filled in",
    );
  }

  if (section.key === "folders") {
    return tn(section.count, "{count} folder to add", "{count} folders to add");
  }
  return tn(section.count, "{count} bookmark to add", "{count} bookmarks to add");
}

/**
 * @param {ImportMergePreviewSection} section
 * @returns {string}
 */
function describeSectionCompact(section) {
  if (section.key === "duplicates") {
    return t(section.count === 1 ? "duplicate ignored" : "duplicates ignored");
  }

  if (section.key === "updates") {
    return t("already saved");
  }

  return t("to add");
}
