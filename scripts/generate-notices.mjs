#!/usr/bin/env node
// Generates THIRD-PARTY-NOTICES.txt: the license texts of every Rust crate compiled
// into the app (normal dependencies, all platforms). The frontend ships no npm
// packages (its npm dependencies are build tools only), so none are listed.
//
// Also copies LICENSE and the notices into src/licenses/ so the About screen can
// show them inside the app.
//
// Usage: npm run notices   (needs cargo on PATH)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "Cargo.toml");

const metadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", manifest], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }),
);

const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const rootId = metadata.resolve.root;

// Walk only "normal" dependency edges (no build scripts, no dev/test tools).
const shipped = new Set();
const queue = [rootId];
while (queue.length > 0) {
  const id = queue.pop();
  if (shipped.has(id)) {
    continue;
  }
  shipped.add(id);
  for (const dep of nodes.get(id)?.deps ?? []) {
    if (dep.dep_kinds.some((kind) => kind.kind === null)) {
      queue.push(dep.pkg);
    }
  }
}
shipped.delete(rootId);

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;

/** @type {Map<string, { text: string, users: string[] }>} */
const texts = new Map();
const rows = [];

for (const id of shipped) {
  const pkg = packages.get(id);
  const label = `${pkg.name} ${pkg.version}`;
  rows.push(`${label.padEnd(44)} ${pkg.license ?? "(see license file)"}`);
  const dir = dirname(pkg.manifest_path);
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => LICENSE_FILE.test(name)).sort();
  } catch {
    files = [];
  }
  if (files.length === 0 && pkg.license_file) {
    files = [pkg.license_file];
  }
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim();
    } catch {
      continue;
    }
    const key = createHash("sha256").update(text).digest("hex");
    const entry = texts.get(key) ?? { text, users: [] };
    entry.users.push(`${label} (${file})`);
    texts.set(key, entry);
  }
}

rows.sort((a, b) => a.localeCompare(b));
const rule = "=".repeat(78);
let out =
  "THIRD-PARTY SOFTWARE NOTICES\n\n" +
  "This application includes the following open-source components.\n" +
  "Their license texts follow the list below.\n\n" +
  "It also uses Microsoft Edge WebView2 (part of Windows), which is not\n" +
  "distributed with this application.\n\n" +
  "All components are used unmodified. The source code of each one, including\n" +
  "those under the Mozilla Public License 2.0 (MPL-2.0), is available at\n" +
  "https://crates.io/crates/<name>/<version>.\n\n" +
  rows.join("\n") +
  "\n";

const sorted = [...texts.values()].sort((a, b) => a.users[0].localeCompare(b.users[0]));
for (const entry of sorted) {
  out += `\n${rule}\nUsed by: ${entry.users.join(", ")}\n${rule}\n\n${entry.text}\n`;
}

writeFileSync(join(root, "THIRD-PARTY-NOTICES.txt"), out);
mkdirSync(join(root, "src", "licenses"), { recursive: true });
writeFileSync(join(root, "src", "licenses", "THIRD-PARTY-NOTICES.txt"), out);
writeFileSync(join(root, "src", "licenses", "LICENSE.txt"), readFileSync(join(root, "LICENSE"), "utf8"));

console.log(`${shipped.size} crates, ${texts.size} distinct license texts, ${(out.length / 1024).toFixed(0)} KB`);
