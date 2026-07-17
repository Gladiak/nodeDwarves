'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SIMULATION_ROOT = path.join(ROOT, 'src', 'simulation');
const STRUCTURED_BOUNDARIES = new Set([
  'combat_events.js',
  'endgame_events.js',
  'events.js',
  'lifecycle_events.js',
  'political_events.js',
  'secondary_events.js',
  'social_events.js',
  'warrior_events.js',
]);

// Return all JavaScript files below one directory in stable order.
function listJavaScriptFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...listJavaScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(fullPath);
    }
  }
  return output.sort();
}

// Report direct pushEvent call sites outside approved structured boundaries.
function auditNarrativeProducers() {
  const remaining = [];
  let structuredCallSites = 0;
  for (const filePath of listJavaScriptFiles(SIMULATION_ROOT)) {
    const relativePath = path.relative(ROOT, filePath).split(path.sep).join('/');
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/\bpushEvent\s*\(/.test(line)) {
        return;
      }
      if (path.basename(filePath) === 'events.js' && /function\s+pushEvent\s*\(/.test(line)) {
        return;
      }
      const callSite = {
        file: relativePath,
        line: index + 1,
        snippet: line.trim(),
      };
      if (STRUCTURED_BOUNDARIES.has(path.basename(filePath))) {
        structuredCallSites += 1;
      } else {
        remaining.push(callSite);
      }
    });
  }
  return {
    schemaVersion: 1,
    structuredBoundaries: [...STRUCTURED_BOUNDARIES].sort(),
    structuredCallSites,
    remainingLegacyProducerCount: remaining.length,
    remainingLegacyProducers: remaining,
  };
}

function main() {
  const report = auditNarrativeProducers();
  const jsonMode = process.argv.includes('--json');
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.remainingLegacyProducerCount === 0) {
    process.stdout.write(
      `[audit:narrative-producers] PASS structured=${report.structuredCallSites} legacy=0\n`,
    );
  } else {
    process.stdout.write(
      `[audit:narrative-producers] FAIL structured=${report.structuredCallSites} legacy=${report.remainingLegacyProducerCount}\n`,
    );
    for (const producer of report.remainingLegacyProducers) {
      process.stdout.write(`- ${producer.file}:${producer.line} ${producer.snippet}\n`);
    }
  }
  if (report.remainingLegacyProducerCount > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { auditNarrativeProducers };
