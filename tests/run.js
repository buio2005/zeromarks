#!/usr/bin/env node

/**
 * Test runner entry point.
 *
 * Usage:
 *   node tests/run.js
 *   node tests/run.js --grep "normalize"
 *   node tests/run.js --grep "selection|expansion"
 */

import { collectTests, runTests } from "./lib/test.js";
import { resolve, dirname } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installStrictImportDOM } from "./lib/node-dom-shim.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const frontendRootPath = resolve(__dirname, '..');

/** @typedef {{ [path: string]: { lines: Record<string, number> } }} CoverageMap */

// Provide an import-time-only DOM shim so modules with tiny top-level
// `document` references can still load in Node. Any real DOM behavior should
// be covered by tests/browser instead.
installStrictImportDOM();

// Parse CLI args
const args = process.argv.slice(2);
let grepPattern = null;
let enableCoverage = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--grep" && i + 1 < args.length) {
    grepPattern = args[i + 1];
    i++;
  }
  if (args[i] === "--coverage") {
    enableCoverage = true;
  }
}

// Discover all .test.js files under tests/
const testDir = resolve(__dirname);
const testFiles = findTestFiles(testDir);

if (testFiles.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

// Import all test files (registers tests via describe/test)
for (const file of testFiles) {
  await import(pathToFileURL(file).href);
}

// Collect and run
const allTests = collectTests();
if (allTests.length === 0) {
  console.log("No tests registered.");
  process.exit(0);
}

console.log(`Running ${allTests.length} tests...`);
if (grepPattern) {
  console.log(`Filter: ${grepPattern}`);
}
console.log("");

const result = await runTests(allTests, { grep: grepPattern });

// Write coverage report if enabled
if (enableCoverage && !(/** @type {any} */ (globalThis).__coverage__)) {
  console.error('');
  console.error('Coverage requested, but no instrumentation data was collected.');
  console.error('Run this script through tests/lib/coverage-loader.js.');
  process.exit(1);
}

if (enableCoverage && /** @type {any} */ (globalThis).__coverage__) {
  const coverage = /** @type {CoverageMap} */ (/** @type {any} */ (globalThis).__coverage__);

  // Include all source files in coverage report (even uncovered ones)
  const { findExecutableLines } = await import('./lib/coverage-instrument.js');
  const { readFileSync } = await import('node:fs');
  const srcDir = resolve(frontendRootPath, 'src');
  const allSourceFiles = findSourceFiles(srcDir);

  for (const filePath of allSourceFiles) {
    const relPath = filePath.replace(frontendRootPath + '/', '');
    if (!coverage[relPath]) {
      const source = readFileSync(filePath, 'utf-8');
      const execLines = findExecutableLines(source);
      if (execLines.length > 0) {
        /** @type {Record<string, number>} */
        const lines = {};
        for (const n of execLines) lines[String(n)] = 0;
        coverage[relPath] = { lines };
      }
    }
  }

  const { writeLcovFile } = await import('./lib/coverage-lcov.js');
  const lcovPath = resolve(__dirname, '../coverage/lcov.info');
  writeLcovFile(coverage, lcovPath, frontendRootPath);
  console.log('');
  console.log(`Coverage report written to: ${lcovPath}`);

  // Print summary
  let totalLines = 0;
  let hitLines = 0;
  for (const [, data] of Object.entries(coverage)) {
    for (const [, count] of Object.entries(data.lines)) {
      totalLines++;
      if (count > 0) hitLines++;
    }
  }
  const pct = totalLines > 0 ? ((hitLines / totalLines) * 100).toFixed(1) : '0.0';
  console.log(`Line coverage: ${hitLines}/${totalLines} (${pct}%)`);
}

if (result.failed > 0) {
  process.exit(1);
}
process.exit(0);

/**
 * Recursively find all .test.js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function findTestFiles(dir) {
  /** @type {string[]} */
  const results = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory() && entry !== "lib" && entry !== "browser") {
      results.push(...findTestFiles(fullPath));
    } else if (stat.isFile() && entry.endsWith(".test.js")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

/**
 * Recursively find all .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function findSourceFiles(dir) {
  /** @type {string[]} */
  const results = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findSourceFiles(fullPath));
    } else if (stat.isFile() && entry.endsWith(".js")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}
