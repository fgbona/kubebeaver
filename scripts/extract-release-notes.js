#!/usr/bin/env node
/**
 * Extracts the release notes for the current version.
 * 1) If scripts/release-notes-current.txt exists and is non-empty, use it (curated body for GitHub).
 * 2) Otherwise use the first version block from CHANGELOG.md (standard-version output).
 * Usage: node scripts/extract-release-notes.js   or   npm run release:notes
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const curatedPath = path.join(__dirname, "release-notes-current.txt");

if (fs.existsSync(curatedPath)) {
  const content = fs.readFileSync(curatedPath, "utf8").trim();
  if (content) {
    process.stdout.write(content);
    process.stdout.write("\n");
    process.exit(0);
  }
}

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const changelog = fs.readFileSync(changelogPath, "utf8");

const blockStart = changelog.match(/^## \[[\d.]+\]/m);
if (!blockStart) {
  console.error("Could not find a ## [x.y.z] block in CHANGELOG.md");
  process.exit(1);
}

const startIndex = changelog.indexOf(blockStart[0]);
const afterFirst = startIndex + blockStart[0].length;
let endIndex = changelog.length;

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
