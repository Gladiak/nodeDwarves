'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const v8 = require('v8');
const { validateGameSession } = require('./game_session');

const ROOT = path.join(__dirname, '..');
const FORMAT = 'nodedwarves-game';
const VERSION = 1;
let engineFingerprint;
const LEGACY_V250_ENGINE = '8060cbc9b1f391ff3462d5fe392574233d796eb2f0f1fc70796bbcd6959cbc52';
const LEGACY_V250_GAMEPLAY = '87bac4b5ad6337c40a548da40904ce589c52ac26365124554deb09b650ecde9f';

// Fingerprint gameplay behavior; presentation-only changes must not invalidate an identical colony engine.
function getEngineFingerprint() {
  if (engineFingerprint) return engineFingerprint;
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['src/render', 'src/runtime', 'src/telemetry'].includes(relative)) visit(relative);
      } else if (entry.name.endsWith('.js') && !['src/persistence.js', 'src/chronicle_export.js',
        'src/render.js', 'src/runtime.js', 'src/terminal.js'].includes(relative)) files.push(relative);
    }
  };
  visit('src');
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(fs.readFileSync(path.join(ROOT, file)));
  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = appSource.indexOf('function getTransitionState(');
  const end = appSource.indexOf('// Function: buildFailureMessage.');
  if (start < 0 || end <= start) throw new Error('Cannot identify the cycle lifecycle for save compatibility.');
  hash.update('app-cycle-lifecycle\0').update(appSource.slice(start, end));
  engineFingerprint = hash.digest('hex');
  return engineFingerprint;
}

// Bound filesystem work independently of the saved gameplay configuration.
function getSaveSettings(config) {
  const raw = config.persistence || {};
  const positive = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;
  return {
    enabled: raw.enabled !== false,
    directory: path.resolve(ROOT, raw.directory || 'saves'),
    intervalTicks: positive(raw.autosave_interval_ticks, 600),
    minIntervalMs: positive(raw.autosave_min_interval_ms, 30000),
    saveOnExit: raw.save_on_exit !== false,
    maxBytes: positive(raw.max_save_bytes, 67108864),
    keepBackup: raw.keep_backup !== false,
  };
}

// Describe a slot without using wall time to advance gameplay.
function summarizeSession(session, reason) {
  return {
    id: session.id,
    scenario: session.scenario.name,
    seed: session.scenario.seed,
    tick: session.state.tick,
    cycle: Number(session.state.cycleStats && session.state.cycleStats.count || 0),
    population: session.state.dwarves.length,
    advances: session.controller.advances,
    width: session.runtime.gridWidth,
    height: session.runtime.gridHeight,
    reason,
  };
}

// Preserve shared job references, numeric sentinels, maps and typed arrays losslessly.
function encodeSave(session, reason = 'manual') {
  validateGameSession(session);
  const body = {
    format: FORMAT,
    version: VERSION,
    engine: getEngineFingerprint(),
    compatibility: 'gameplay-v1',
    nodeMajor: Number(process.versions.node.split('.')[0]),
    savedAt: new Date().toISOString(),
    summary: summarizeSession(session, reason),
    data: v8.serialize(session).toString('base64'),
  };
  const checksum = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return JSON.stringify({ ...body, checksum }) + '\n';
}

// Verify version, integrity and engine before deserializing a complete session graph.
function decodeSave(text, options = {}) {
  const envelope = JSON.parse(text);
  if (!envelope || envelope.format !== FORMAT || envelope.version !== VERSION) {
    throw new Error('Unsupported saved-game format or version.');
  }
  const { checksum, ...body } = envelope;
  const expected = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (typeof checksum !== 'string' || checksum !== expected) throw new Error('Saved-game checksum mismatch.');
  const engine = getEngineFingerprint();
  const legacyCompatible = body.compatibility === undefined && body.engine === LEGACY_V250_ENGINE && engine === LEGACY_V250_GAMEPLAY;
  const currentCompatible = body.compatibility === 'gameplay-v1' && body.engine === engine;
  if ((!legacyCompatible && !currentCompatible) || body.nodeMajor !== Number(process.versions.node.split('.')[0])) {
    throw new Error('This save requires its original game build or a compatible gameplay engine and Node.js major version.');
  }
  if (typeof body.data !== 'string' || !body.summary || !Number.isFinite(Date.parse(body.savedAt))) {
    throw new Error('Invalid saved-game envelope.');
  }
  if (options.summaryOnly) return { summary: body.summary, savedAt: body.savedAt };
  const session = validateGameSession(v8.deserialize(Buffer.from(body.data, 'base64')));
  return { session, summary: summarizeSession(session, body.summary.reason), savedAt: body.savedAt };
}

// Check length before allocating or parsing a file from disk.
function readSave(filePath, settings, options) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > settings.maxBytes) {
      throw new Error('Saved-game file is empty, too large or not a regular file.');
    }
    return decodeSave(fs.readFileSync(fd, 'utf8'), options);
  } finally {
    fs.closeSync(fd);
  }
}

// Write and flush a sibling temporary file before replacing the visible checkpoint.
function atomicWrite(filePath, text) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filePath);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Persist one colony; preserve a valid previous checkpoint even after primary corruption.
function saveGame(session, settings, reason = 'manual') {
  if (!settings.enabled) throw new Error('Game saving is disabled in config.json.');
  const text = encodeSave(session, reason);
  if (Buffer.byteLength(text) > settings.maxBytes) throw new Error('Saved game exceeds max_save_bytes.');
  fs.mkdirSync(settings.directory, { recursive: true });
  const filePath = path.join(settings.directory, `${session.id}.json`);
  if (settings.keepBackup && fs.existsSync(filePath)) {
    let previous;
    try {
      readSave(filePath, settings);
      previous = fs.readFileSync(filePath, 'utf8');
    } catch (_) { /* Keep the existing backup when the primary is damaged. */ }
    if (previous) atomicWrite(`${filePath}.bak`, previous);
  }
  atomicWrite(filePath, text);
  return filePath;
}

// Recover a damaged checkpoint from its verified previous generation, with explicit notice.
function loadGame(filePath, settings) {
  const resolved = path.resolve(filePath);
  try {
    return { ...readSave(resolved, settings), filePath: resolved, recovered: false };
  } catch (primaryError) {
    if (!resolved.endsWith('.bak')) {
      try {
        return { ...readSave(`${resolved}.bak`, settings), filePath: resolved, recovered: true };
      } catch (_) { /* Report the primary failure, keeping both files untouched. */ }
    }
    throw new Error(`Cannot load ${path.basename(resolved)}: ${primaryError.message}`);
  }
}

// Include damaged and backup-only slots so the menu explains failures and offers recovery.
function listSavedGames(settings) {
  if (!fs.existsSync(settings.directory)) return [];
  const files = new Set(fs.readdirSync(settings.directory)
    .filter((name) => /^[a-f0-9]{24}\.json(?:\.bak)?$/.test(name))
    .map((name) => name.replace(/\.bak$/, '')));
  const slots = [];
  for (const name of files) {
    const filePath = path.join(settings.directory, name);
    try {
      let result;
      let recovered = false;
      try { result = readSave(filePath, settings, { summaryOnly: true }); }
      catch (_) { result = readSave(`${filePath}.bak`, settings, { summaryOnly: true }); recovered = true; }
      slots.push({ ...result.summary, savedAt: result.savedAt, filePath, recovered });
    } catch (error) {
      slots.push({ id: name.slice(0, 24), scenario: 'Unavailable save', filePath, error: error.message, savedAt: '' });
    }
  }
  return slots.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
}

module.exports = {
  getSaveSettings, getEngineFingerprint, encodeSave, decodeSave,
  saveGame, loadGame, listSavedGames,
};
