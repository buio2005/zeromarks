# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] ZeroMarks (TivuStream) – first release

Renamed to **ZeroMarks** (identifier `it.tivustream.zeromarks`). Based on JustBookmarks 0.3.x by SellswordSoftware.

### Fixed

- Browser data (tags, keywords, descriptions, toolbar folder) is no longer lost when saving
- Safe saving (no truncated file on crash) and automatic backups in `.zeromarks-backups`
- Special characters in titles (e.g. `&#39;`) are decoded
- Import recognizes duplicates across the whole library and fills in missing details
- Folder details show the right item count before the folder is expanded
- Light theme: text that inherits its color is no longer near-white
- Test runner works on Windows

### Added

- Find duplicates, dead-link check, folder sorting, recent files
- Detection of changes made to the file by other programs
- Italian interface (IT / EN switch), About screen with privacy note and credits
- THIRD-PARTY-NOTICES.txt (`npm run notices`)

### Changed

- Missing site icons are no longer requested from Google (privacy)

## [0.3.1-4]

### Changed

 - Github Action fixes
 - Resolved issue with parser to inrease compatibility with differently formatted bookmark files

 
## [0.3.0] - Next

### Changed

- Rewrote the frontend to remove the prior Svelte, Tailwind, and DaisyUI stack in favor of project-local, home-grown UI and state primitives.
- Replaced framework-driven component patterns with a local `naf-html` runtime and explicit feature/state modules to reduce dependency churn and make behavior easier to trace.
- Reworked styling around repo-owned CSS modules and local UI conventions instead of utility-framework and theme-library dependencies.
- Switched the desktop host from Wails to Tauri, moving app packaging and native integration to the current Rust/Tauri stack.

### Improved

- Increased frontend stability by reducing exposure to upstream framework, plugin, and design-system breakage.
- Reduced maintenance churn by moving core rendering, state wiring, and UI patterns into code owned directly by this repository.
- Improved maintainability by splitting large frontend modules into smaller state, feature, lifecycle, and styling boundaries.

### Notes

- This release is intended to keep the app simpler to evolve over time, with fewer moving parts outside the repository.
- The rewrite preserves the desktop bookmark manager workflow while shifting implementation ownership in-house.
