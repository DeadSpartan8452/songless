'use strict';

let modulePromise = null;

function load() {
  if (!modulePromise) {
    modulePromise = import('music-metadata');
  }
  return modulePromise;
}

async function parseFile(...args) {
  const musicMetadata = await load();
  return musicMetadata.parseFile(...args);
}

module.exports = { parseFile };
