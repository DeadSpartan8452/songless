'use strict';

const fs = require('fs');
const path = require('path');
const NodeID3 = require('node-id3');

const PROFILE_FRAME = 'SONGLESS_IMPORT_PROFILES';
const PROFILE_LIMIT = 50;

function normalizeProfile(origin) {
  const profileId = String(origin && origin.profileId || '').trim().slice(0, 64);
  const label = String(origin && origin.label || '').trim().slice(0, 100);
  if (!profileId || !label || !origin || origin.kind !== 'profile') return null;
  return { profileId, label };
}

function userText(tags) {
  if (!tags || !Array.isArray(tags.userDefinedText)) return [];
  return tags.userDefinedText.filter(item => item
    && typeof item.description === 'string'
    && typeof item.value === 'string');
}

function profileHistory(tags) {
  const frame = userText(tags).find(item => item.description === PROFILE_FRAME);
  if (!frame) return [];
  try {
    const parsed = JSON.parse(frame.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({
      profileId: String(item && item.profileId || '').slice(0, 64),
      label: String(item && item.label || '').slice(0, 100),
    })).filter(item => item.profileId && item.label).slice(-PROFILE_LIMIT);
  } catch (_) {
    return [];
  }
}

function sourceFromFile(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.mp3') return null;
  try {
    const history = profileHistory(NodeID3.read(filePath, { include: ['TXXX'] }));
    const latest = history[history.length - 1];
    return latest ? {
      id: `profile:${latest.profileId}`,
      label: latest.label,
      kind: 'profile',
      profileId: latest.profileId,
    } : null;
  } catch (_) {
    return null;
  }
}

function atomicReplace(filePath, buffer) {
  const tempPath = `${filePath}.songless-${process.pid}-${Date.now()}.tmp`;
  const backupPath = `${tempPath}.original`;
  fs.writeFileSync(tempPath, buffer, { flag: 'wx' });
  let movedOriginal = false;
  try {
    fs.renameSync(filePath, backupPath);
    movedOriginal = true;
    fs.renameSync(tempPath, filePath);
    fs.unlinkSync(backupPath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    if (movedOriginal && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, filePath); } catch (_) {}
    }
    throw error;
  }
}

function tagProfile(filePath, origin) {
  const profile = normalizeProfile(origin);
  if (!profile) return { status: 'no-profile' };
  if (path.extname(filePath).toLowerCase() !== '.mp3') {
    return { status: 'metadata-json-only' };
  }

  try {
    const tags = NodeID3.read(filePath);
    const history = profileHistory(tags);
    const prior = history.find(item => item.profileId === profile.profileId);
    if (!prior) history.push(profile);
    const nextHistory = history.slice(-PROFILE_LIMIT);
    const existingFrames = userText(tags).filter(item => item.description !== PROFILE_FRAME);
    const patched = NodeID3.update({
      userDefinedText: [
        ...existingFrames,
        { description: PROFILE_FRAME, value: JSON.stringify(nextHistory) },
      ],
    }, fs.readFileSync(filePath));
    if (!Buffer.isBuffer(patched)) throw new Error('Le tag ID3 n’a pas pu être produit.');
    atomicReplace(filePath, patched);
    return { status: 'tagged', profileCount: nextHistory.length };
  } catch (error) {
    return { status: 'metadata-json-only', error: error.message };
  }
}

module.exports = { tagProfile, sourceFromFile, PROFILE_FRAME };
