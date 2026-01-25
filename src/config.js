'use strict';

const fs = require('fs');
const path = require('path');

function loadConfig(configPath) {
  const resolvedPath = configPath || path.join(__dirname, '..', 'config.json');
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

module.exports = { loadConfig };
