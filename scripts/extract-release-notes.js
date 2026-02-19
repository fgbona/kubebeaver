#!/usr/bin/env node
/**
 * Extracts the release notes for the current version from CHANGELOG.md.
 * Outputs only the first version block (latest) so GitHub release body stays clean.
 * Usage: node scripts/extract-release-notes.js   or   npm run release:notes
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const pkgPath = path.join(repoRoot, "package.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;
const changelog = fs.readFileSync(changelogPath, "utf8");

// Find first version block: ## [x.y.z] or ## x.y.z (standard-version style)
const blockStart = changelog.match(/^## \[[\d.]+\]/m);
if (!blockStart) {
  console.error("Could not find a ## [x.y.z] block in CHANGELOG.md");
  process.exit(1);
}

const startIndex = changelog.indexOf(blockStart[0]);
const afterFirst = startIndex + blockStart[0].length;
let endIndex = changelog.length;

// End at next version block: ## [x.y.z] or ### x.y.z (old changelog format)
const rest = changelog.slice(afterFirst);
const nextBlock = rest.match(/\n(## \[[\d.]+\]|\###\s+[\d.]+\s)/);
if (nextBlock) {
  endIndex = afterFirst + nextBlock.index;
}

let notes = changelog.slice(startIndex, endIndex).trim();
if (!notes) {
  console.error("Empty release notes for current version");
  process.exit(1);
}

process.stdout.write(notes);
process.stdout.write("\n");
