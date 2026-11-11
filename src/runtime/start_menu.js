'use strict';

const { listSavedGames, loadGame } = require('../persistence');

const { renderStartMenu } = require('../render/start_menu');

// Keep raw input, resize and menu errors local until a game has actually been selected.
function showStartMenu(config, settings, options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const slots = listSavedGames(settings);
  let screen = 'main';
  let selected = 0;
  let message = '';
  let pending = '';
  let escapeTimer;
  let finished = false;
  let items;
  const model = () => {
    let title;
    if (screen === 'new') {
      title = 'FOUND A NEW HOLD';
      const scenarios = config.startup?.scenarios || [{ id: 'free', name: 'Free colony', difficulty: 'Standard', description: 'A fresh mountain awaits.' }];
      items = scenarios.map((scenario) => ({
        label: `${scenario.name} | ${scenario.difficulty}`,
        detail: `${scenario.focus ? scenario.focus + ' | ' : ''}${scenario.description}`,
        scenarioId: scenario.id,
      }));
    } else if (screen === 'load') {
      title = 'THE HOLD ARCHIVES';
      items = slots.map((slot) => ({
        label: slot.error ? `${slot.id.slice(0, 8)} | Unavailable save`
          : `${slot.scenario} | C${slot.cycle} T${slot.tick} | ${slot.population} dwarves${slot.recovered ? ' | backup' : ''}`,
        detail: slot.error || `${slot.savedAt.replace('T', ' ').slice(0, 19)} UTC | Seed ${slot.seed} | ${slot.width}x${slot.height} | ${slot.id.slice(0, 8)}`,
        slot,
      }));
    } else {
      title = 'A MOUNTAIN AWAITS';
      items = [
        { label: '[N] New colony', action: 'new', detail: 'Choose a free colony or a configured scenario.' },
        { label: '[L] Load colony', action: 'load', detail: `${slots.length} colony archives available.` },
        { label: '[C] Continue latest', action: 'continue', detail: 'Resume the most recent compatible checkpoint.' },
        { label: '[Q] Quit', action: 'quit', detail: 'The mountain can wait.' },
      ];
    }
    return { title, items, selected, message };
  };
  const draw = () => {
    output.write('\x1b[H' + renderStartMenu(model(), output.columns || 80, (output.rows || 30) - 1, config));
  };
  return new Promise((resolve) => {
    const finish = (choice) => {
      if (finished) return;
      finished = true;
      clearTimeout(escapeTimer);
      input.removeListener('data', onData);
      output.removeListener('resize', draw);
      resolve(choice);
    };
    const openSlot = (slot) => {
      if (!slot) { message = 'No saved colonies yet. Found a new hold first.'; return; }
      try { finish({ loaded: loadGame(slot.filePath, settings) }); }
      catch (error) { message = error.message; }
    };
    const activate = () => {
      const item = items[selected];
      if (!item) return;
      message = '';
      if (screen === 'new') { finish({ scenarioId: item.scenarioId }); return; }
      if (screen === 'load') { openSlot(item.slot); return; }
      if (item.action === 'quit') { finish(null); return; }
      if (item.action === 'continue') { openSlot(slots.find((slot) => !slot.error)); return; }
      if (item.action === 'load' && !slots.length) { message = 'No saved colonies yet. Found a new hold first.'; return; }
      screen = item.action;
      selected = 0;
    };
    const back = () => { screen = 'main'; selected = 0; message = ''; draw(); };
    const onData = (chunk) => {
      if (finished) return;
      clearTimeout(escapeTimer);
      pending += chunk;
      while (pending.length) {
        model();
        if (pending === '\x1b' || pending === '\x1b[') {
          escapeTimer = setTimeout(() => { pending = ''; back(); }, 100);
          break;
        }
        let key = pending[0];
        let length = 1;
        if (pending.startsWith('\x1b[')) { key = pending.slice(0, 3); length = 3; }
        pending = pending.slice(length);
        if (key === '\u0003' || key.toLowerCase() === 'q') { finish(null); return; }
        if (key === '\x1b[A' || key === '\x1b[B') {
          selected = (selected + (key === '\x1b[A' ? -1 : 1) + items.length) % items.length;
          message = '';
        } else if (key === '\r' || key === '\n') activate();
        else if (key === '\x1b') back();
        else if (screen === 'main' && ['n', 'l', 'c'].includes(key.toLowerCase())) {
          selected = { n: 0, l: 1, c: 2 }[key.toLowerCase()];
          activate();
        }
        if (finished) return;
      }
      draw();
    };
    input.setEncoding('utf8');
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    output.write('\x1b[?25l\x1b[2J');
    input.on('data', onData);
    output.on('resize', draw);
    draw();
  });
}

module.exports = { renderStartMenu, showStartMenu };
