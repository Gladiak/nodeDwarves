#!/usr/bin/env node
'use strict';

// Snapshot bank builder (STRATEGY.md S4d). Plays training games through ai_server (the same reset
// and scenario configs the trainer uses) with the council or a policy, and saves gzip snapshots at
// fixed ticks. The trainer can then start part of its episodes from these mid-game states
// (`train.py --snapshot-bank <dir> --snapshot-prob <p>`). Outputs stay outside models/.
//
// Usage:
//   node scripts/build_snapshot_bank.js --config <session config> --out <dir>
//     [--games 24] [--ticks 2000,4000,6000,8000,10000,12000,14000,16000] [--policy <file>]
//     [--policy-share 0.5] [--step-ticks 20] [--workers 7] [--seed 1]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { games: 24, ticks: '2000,4000,6000,8000,10000,12000,14000,16000', policy: null,
    policyShare: 0.5, stepTicks: 20, workers: 7, seed: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    options[key] = argv[i + 1];
    i += 1;
  }
  for (const key of ['games', 'policyShare', 'stepTicks', 'workers', 'seed']) options[key] = Number(options[key]);
  options.ticks = String(options.ticks).split(',').map(Number).filter((t) => t > 0).sort((a, b) => a - b);
  if (!options.config || !options.out) throw new Error('--config and --out are required');
  return options;
}

// One ai_server process speaking JSON lines.
function startServer(config) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'ai_server.js'), '--config', config], { cwd: ROOT });
  let buffer = '';
  const waiting = [];
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const resolve = waiting.shift();
      if (resolve) resolve(JSON.parse(line));
    }
  });
  const send = (message) => new Promise((resolve) => {
    waiting.push(resolve);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
  return { send, close: () => send({ cmd: 'close' }) };
}

// Deterministic per-game draw in [0, 1).
function unit(seed, salt) {
  let t = (seed * 2654435761 + salt * 40503) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

async function playGame(server, options, gameIndex, manifest) {
  const seed = (options.seed * 100003 + gameIndex * 7919) >>> 0;
  const usePolicy = options.policy && unit(seed, 1) < options.policyShare;
  const difficulty = Math.round((0.3 + 0.7 * unit(seed, 2)) * 100) / 100;
  const reset = await server.send({ cmd: 'reset', seed, training: true, difficulty });
  if (reset.error) throw new Error(`reset failed: ${reset.error}`);
  let tick = Number(reset.info && reset.info.tick || 0);
  const start = tick;
  for (const target of options.ticks) {
    const step = await server.send({ cmd: 'autostep', ticks: start + target - tick,
      policy: usePolicy ? path.resolve(options.policy) : null, stepTicks: options.stepTicks });
    if (step.error) throw new Error(`autostep failed: ${step.error}`);
    tick = step.tick;
    if (step.population === 0) break;
    const file = path.join(options.out, `snap_g${String(gameIndex).padStart(3, '0')}_t${target}.v8.gz`);
    const saved = await server.send({ cmd: 'save_snapshot', path: file });
    if (saved.error) throw new Error(`save failed: ${saved.error}`);
    manifest.push({ file: path.basename(file), game: gameIndex, seed, difficulty, player: usePolicy ? 'policy' : 'council',
      tick: saved.tick, population: saved.population, bytes: saved.bytes });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.out, { recursive: true });
  const manifest = [];
  let next = 0;
  const worker = async () => {
    const server = startServer(path.resolve(options.config));
    try {
      while (next < options.games) {
        const gameIndex = next;
        next += 1;
        await playGame(server, options, gameIndex, manifest);
        process.stdout.write(`[bank] game ${gameIndex + 1}/${options.games} done\n`);
      }
    } finally {
      await server.close();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.workers) }, worker));
  manifest.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(options.out, 'manifest.json'), `${JSON.stringify({ options, snapshots: manifest }, null, 1)}\n`);
  const bytes = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  process.stdout.write(`[bank] ${manifest.length} snapshots, ${(bytes / 1e6).toFixed(1)} MB in ${options.out}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
