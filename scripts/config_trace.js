'use strict';

// Config read tracer for the config audit (STRATEGY.md step R). Preload it with
//   NODE_OPTIONS="-r /abs/path/scripts/config_trace.js" CONFIG_TRACE_OUT=/abs/file.jsonl
// Every object parsed from config.json (required, loaded or JSON-cloned) is wrapped in a read-only
// recording Proxy; on exit the process appends the set of config paths it read to CONFIG_TRACE_OUT.
// Array indices are recorded as [*]. Reads made by JSON.stringify (hashing, saves) are ignored.
// Measurement only: values and identities seen by the game are unchanged.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const OUT = process.env.CONFIG_TRACE_OUT;
const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const read = new Set();
const proxies = new WeakMap();
const targets = new WeakMap();
let suspended = 0;

// Heuristic used for JSON clones: a full NodeDwarves config has these top-level sections.
function looksLikeConfig(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && 'resources' in value && 'structures' in value && 'ai' in value && 'population' in value;
}

function childPath(base, key, isArray) {
  if (isArray && /^\d+$/.test(key)) return `${base}[*]`;
  return base ? `${base}.${key}` : key;
}

function wrap(value, base) {
  if (!value || typeof value !== 'object') return value;
  if (targets.has(value)) return value;
  const cached = proxies.get(value);
  if (cached) return cached;
  const isArray = Array.isArray(value);
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      const result = Reflect.get(target, key, receiver);
      if (typeof key !== 'string' || suspended > 0) return result;
      if (!Object.prototype.hasOwnProperty.call(target, key)) return result;
      const p = childPath(base, key, isArray);
      read.add(p);
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor && descriptor.configurable === false && descriptor.writable === false) {
        read.add(`${p}.**`);
        return result;
      }
      return wrap(result, p);
    },
  });
  proxies.set(value, proxy);
  targets.set(proxy, value);
  return proxy;
}

// Unwrap a proxy for native APIs that cannot handle proxies (structuredClone).
function unwrap(value) {
  return targets.get(value) || value;
}

if (OUT) {
  const originalStringify = JSON.stringify;
  JSON.stringify = function stringify(...args) {
    suspended += 1;
    try { return originalStringify.apply(this, args); } finally { suspended -= 1; }
  };
  const originalParse = JSON.parse;
  JSON.parse = function parse(...args) {
    const result = originalParse.apply(this, args);
    return looksLikeConfig(result) ? wrap(result, '') : result;
  };
  if (typeof globalThis.structuredClone === 'function') {
    const originalClone = globalThis.structuredClone;
    globalThis.structuredClone = function clone(value, options) {
      suspended += 1;
      let result;
      try { result = originalClone(unwrap(value), options); } finally { suspended -= 1; }
      return looksLikeConfig(result) ? wrap(result, '') : result;
    };
  }
  // v8.serialize (saves) rejects proxies: swap them for their targets in place, then restore.
  const v8 = require('v8');
  const originalSerialize = v8.serialize;
  v8.serialize = function serialize(value) {
    const swapped = [];
    const seen = new Set();
    const visit = (node) => {
      const raw = unwrap(node);
      if (!raw || typeof raw !== 'object' || seen.has(raw)) return;
      seen.add(raw);
      if (raw instanceof Map) { raw.forEach((entry) => visit(entry)); return; }
      if (raw instanceof Set) { raw.forEach((entry) => visit(entry)); return; }
      for (const key of Object.keys(raw)) {
        const child = raw[key];
        if (child && typeof child === 'object' && targets.has(child)) {
          const descriptor = Object.getOwnPropertyDescriptor(raw, key);
          if (descriptor && descriptor.writable) {
            swapped.push([raw, key, child]);
            raw[key] = targets.get(child);
          }
        }
        visit(raw[key]);
      }
    };
    suspended += 1;
    try {
      visit(value);
      return originalSerialize.call(this, unwrap(value));
    } finally {
      for (const [owner, key, proxy] of swapped) owner[key] = proxy;
      suspended -= 1;
    }
  };
  const originalJsonLoader = Module._extensions['.json'];
  Module._extensions['.json'] = function loadJson(module, filename) {
    originalJsonLoader(module, filename);
    if (path.resolve(filename) === CONFIG_FILE || looksLikeConfig(module.exports)) {
      module.exports = wrap(module.exports, '');
    }
  };
  const flush = () => {
    if (read.size === 0) return;
    try {
      fs.appendFileSync(OUT, `${originalStringify([...read])}\n`);
    } catch (error) {
      // Measurement must never break the traced program.
    }
    read.clear();
  };
  process.on('exit', flush);
  module.exports = { flush };
}
