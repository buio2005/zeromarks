# Renaming the app

Checklist for when the final name is chosen. Do it **before the first public
release**: the identifier decides where Windows installs the app and keeps its
settings, so changing it later means duplicate installs and lost preferences.

| What | Where | Example |
| --- | --- | --- |
| Name shown in the app (title bar, About) | `src/shared/app-info.js` → `name` | `ZeroBook` |
| Installer / program name | `src-tauri/tauri.conf.json` → `productName` | `ZeroBook` |
| Window title | `src-tauri/tauri.conf.json` → `app.windows[0].title` | `ZeroBook` |
| **Unique identifier** (reverse domain) | `src-tauri/tauri.conf.json` → `identifier` | `it.tivustream.zerobook` |
| Page title | `src/index.html` → `<title>` | `ZeroBook` |
| npm package name | `package.json` → `name` | `zerobook` |
| Rust package / executable name | `src-tauri/Cargo.toml` → `[package] name` (and `[lib] name`) | `zerobook` |
| Icons | `app-icon.png`, then `npx tauri icon app-icon.png` to regenerate `src-tauri/icons/` | new artwork |
| Docs | `README.md`, `CHANGELOG.md` | |
| Backup folder name (optional) | `src-tauri/src/bookmarks.rs` → `BACKUP_DIR_NAME` (also update the Italian text in `src/shared/i18n/it.js`) | `.zerobook-backups` |

Keep the credit to the original project (`basedOn` in `app-info.js`) and both
copyright lines in `LICENSE`.

After changing names, run `npm run notices`, `npm test`, `cargo test` (in
`src-tauri`) and a test build with `npm run tauri build`.
