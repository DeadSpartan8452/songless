'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

function scan(file, { timeout = 10 * 60 * 1000 } = {}) {
  const executable = findDefender();
  if (!executable) {
    return Promise.reject(new Error('Windows Defender est introuvable : ajout annulé par sécurité.'));
  }
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return Promise.reject(new Error('Fichier à analyser introuvable.'));

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-Scan', '-ScanType', '3', '-File', resolved, '-DisableRemediation'], {
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
      reject(new Error(`Windows Defender n’a pas pu démarrer : ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ clean: true, engine: 'Microsoft Defender' });
      reject(new Error(`Windows Defender a refusé ce fichier (code ${code}).`));
    });
  });
}

module.exports = { findDefender, scan };
