'use strict';

const ALGORITHM = 'mulberry32-v1';

// Create a bounded, serializable gameplay random stream (including seed zero).
function createSessionRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Seed must be an integer between 0 and 4294967295.');
  }
  return { algorithm: ALGORITHM, seed, state: seed, draws: 0 };
}

// Validate persisted PRNG state before permitting any gameplay draws.
function validateSessionRandom(random) {
  if (!random || random.algorithm !== ALGORITHM
      || !Number.isInteger(random.seed) || random.seed < 0 || random.seed > 0xffffffff
      || !Number.isInteger(random.state) || random.state < 0 || random.state > 0xffffffff
      || !Number.isSafeInteger(random.draws) || random.draws < 0) {
    throw new Error('Invalid saved random stream.');
  }
}

// Match the existing seeded benchmark stream while retaining its exact cursor.
function nextRandom(random) {
  random.state = (random.state + 0x6d2b79f5) >>> 0;
  random.draws += 1;
  let value = random.state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

// Scope legacy Math.random consumers to one synchronous gameplay operation.
function withSessionRandom(random, callback) {
  const previous = Math.random;
  Math.random = () => nextRandom(random);
  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      throw new Error('Gameplay random scopes must be synchronous.');
    }
    return result;
  } finally {
    Math.random = previous;
  }
}

module.exports = { createSessionRandom, validateSessionRandom, withSessionRandom };
