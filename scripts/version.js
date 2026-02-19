#!/usr/bin/env node
/**
 * Print the version from the repo root package.json.
 * Uses __dirname so it works regardless of current working directory
 * (e.g. when the release script runs from backend/).
 * Usage: node scripts/version.js   or   npm run version:current
 */
const path = require("path");
const pkg = require(path.resolve(__dirname, "..", "package.json"));
process.stdout.write(pkg.version);
