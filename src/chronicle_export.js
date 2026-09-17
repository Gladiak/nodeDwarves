'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  buildCurrentChronicleSnapshot,
  sanitizeChronicleRecord,
  verifyChronicleRecord,
} = require('./simulation/chronicle');

// Export the latest completed Chronicle, or the current cycle when none is complete.
function exportChronicle(state, config, options = {}) {
  const exportConfig = config?.chronicle?.export || {};
  if (exportConfig.enabled === false) throw new Error('Chronicle export is disabled.');
  const latest = Array.isArray(state?.chronicle?.archive) && state.chronicle.archive.length > 0
    ? state.chronicle.archive[state.chronicle.archive.length - 1]
    : buildCurrentChronicleSnapshot(state);
  const record = sanitizeChronicleRecord(latest).record;
  const verification = verifyChronicleRecord(record);
  if (!verification.valid) throw new Error(`Chronicle integrity failed: ${verification.errors[0]}`);
  const payload = { schemaVersion: 1, chronicle: record };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const outputDir = resolveSafeOutputDirectory(rootDir, options.outputDir || exportConfig.directory || 'chronicles');
  const baseName = `node_dwarves_chronicle_cycle_${String(record.cycle + 1).padStart(4, '0')}_${hash.slice(0, 12)}`;
  const files = [];
  fs.mkdirSync(outputDir, { recursive: true });
  if (options.json !== false && exportConfig.json !== false) {
    const jsonPath = path.join(outputDir, `${baseName}.json`);
    fs.writeFileSync(jsonPath, json, 'utf8');
    files.push(jsonPath);
  }
  if (options.markdown !== false && exportConfig.markdown !== false) {
    const markdownPath = path.join(outputDir, `${baseName}.md`);
    fs.writeFileSync(markdownPath, renderChronicleMarkdown(record, hash), 'utf8');
    files.push(markdownPath);
  }
  return { hash, baseName, outputDir, files, record };
}

// Keep configured export paths inside the application root.
function resolveSafeOutputDirectory(rootDir, configuredDirectory) {
  const candidate = path.resolve(rootDir, String(configuredDirectory || 'chronicles'));
  const relative = path.relative(rootDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.join(rootDir, 'chronicles');
  }
  return candidate;
}

// Render a deterministic human-readable Chronicle with inline source IDs.
function renderChronicleMarkdown(record, hash) {
  const lines = [
    `# ${record.summary?.title || `Cycle ${record.cycle + 1} Chronicle`}`,
    '',
    `- Status: ${record.status}`,
    `- Ticks: ${record.startedTick}-${record.completedTick ?? record.startedTick}`,
    `- Claims: ${record.summary?.claimCount || 0}`,
    `- Integrity hash: \`${hash}\``,
    '',
  ];
  for (const chapter of record.chapters || []) {
    lines.push(`## ${chapter.title}`, '');
    if (!Array.isArray(chapter.claims) || chapter.claims.length === 0) {
      lines.push('_No witnessed claims._', '');
      continue;
    }
    for (const claim of chapter.claims) {
      lines.push(`- ${claim.text} _(sources: ${claim.sourceEventIds.join(', ')})_`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { exportChronicle, resolveSafeOutputDirectory, renderChronicleMarkdown };
