'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function defenderCandidates() {
  const out = [];
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const platform = path.join(programData, 'Microsoft', 'Windows Defender', 'Platform');
  try {
    const versions = fs.readdirSync(platform, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) out.push(path.join(platform, version, 'MpCmdRun.exe'));
  } catch (_) {}
  if (process.env.ProgramFiles) {
    out.push(path.join(process.env.ProgramFiles, 'Windows Defender', 'MpCmdRun.exe'));
  }
  return out;
}

function findDefender() {
  return defenderCandidates().find(file => fs.existsSync(file)) || null;
}

function findClamAv() {
  const candidates = [process.env.SONGLESS_CLAMSCAN, 'clamscan'].filter(Boolean);
  for (const command of candidates) {
    try {
      const check = spawnSync(command, ['--version'], {
        encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false,
      });
      if (check.status === 0 && /clamav/i.test(`${check.stdout || ''}${check.stderr || ''}`)) {
        return command;
      }
    } catch (_) { /* candidat suivant */ }
  }
  return null;
}

function findEngine() {
  const defender = findDefender();
  if (defender) return { id: 'defender', name: 'Microsoft Defender', command: defender };
  const clamav = findClamAv();
  if (clamav) return { id: 'clamav', name: 'ClamAV', command: clamav };
  return null;
}

function status() {
  const engine = findEngine();
  return engine
    ? { available: true, id: engine.id, name: engine.name }
    : { available: false, id: null, name: null };
}

function scanArguments(engine, file) {
  if (!engine || !engine.id) throw new Error('Moteur antivirus inconnu.');
  if (engine.id === 'defender') {
    return ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'];
  }
  if (engine.id === 'clamav') return ['--no-summary', '--', file];
  throw new Error(`Moteur antivirus non pris en charge : ${engine.id}`);
}

function scan(file, { timeout = 10 * 60 * 1000 } = {}) {
  const engine = findEngine();
  if (!engine) {
    return Promise.reject(new Error('Aucun moteur antivirus compatible : ajout annulé par sécurité.'));
  }
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return Promise.reject(new Error('Fichier à analyser introuvable.'));

  return new Promise((resolve, reject) => {
    const child = spawn(engine.command, scanArguments(engine, resolved), {
      windowsHide: true,
      shell: false,
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Analyse antivirus trop longue : ajout annulé.'));
    }, timeout);
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${engine.name} n’a pas pu démarrer : ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ clean: true, engine: engine.name });
      if (engine.id === 'clamav' && code === 1) {
        return reject(new Error('ClamAV a détecté une menace : fichier refusé.'));
      }
      reject(new Error(`${engine.name} a refusé ce fichier (code ${code}).`));
    });
  });
}

module.exports = {
  defenderCandidates, findClamAv, findDefender, findEngine, scan,
  scanArguments, status,
};
