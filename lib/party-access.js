'use strict';

const crypto = require('crypto');

const TOKEN_MIN_TTL_MS = 5 * 60 * 1000;
const TOKEN_MAX_TTL_MS = 12 * 60 * 60 * 1000;
const ACCESS_ROLES = new Set(['remote_admin', 'tv']);

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function purgeAccessTokens(party, now = Date.now()) {
  party.accessTokens = (party.accessTokens || []).filter(entry => (
    !entry.revokedAt && Number(entry.expiresAt) > now
  ));
}

function isHost(party, hostToken) {
  return Boolean(party && hostToken && party.hostToken === hostToken);
}

function hashesMatch(left, right) {
  const first = Buffer.from(String(left || ''), 'hex');
  const second = Buffer.from(String(right || ''), 'hex');
  return first.length === second.length
    && first.length > 0
    && crypto.timingSafeEqual(first, second);
}

function issueAccessToken(party, hostToken, role, ttlMs = 2 * 60 * 60 * 1000) {
  if (!isHost(party, hostToken)) throw new Error('Appairage réservé à l’hôte.');
  const cleanRole = String(role || '');
  if (!ACCESS_ROLES.has(cleanRole)) throw new Error('Rôle d’appairage inconnu.');
  purgeAccessTokens(party);
  const rawToken = crypto.randomBytes(24).toString('base64url');
  const createdAt = Date.now();
  const duration = Math.min(TOKEN_MAX_TTL_MS,
    Math.max(TOKEN_MIN_TTL_MS, Number(ttlMs) || 2 * 60 * 60 * 1000));
  const entry = {
    id: crypto.randomBytes(9).toString('base64url'),
    role: cleanRole,
    tokenHash: tokenHash(rawToken),
    createdAt,
    expiresAt: createdAt + duration,
    revokedAt: null,
  };
  party.accessTokens.push(entry);
  party.updatedAt = createdAt;
  return {
    id: entry.id,
    role: entry.role,
    accessToken: rawToken,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}

function accessRole(party, accessToken) {
  if (!party || !accessToken) return null;
  purgeAccessTokens(party);
  const hash = tokenHash(accessToken);
  const entry = party.accessTokens.find(candidate => hashesMatch(candidate.tokenHash, hash));
  return entry ? entry.role : null;
}

function revokeAccessToken(party, hostToken, id) {
  if (!isHost(party, hostToken)) throw new Error('Révocation réservée à l’hôte.');
  const entry = (party.accessTokens || []).find(candidate => candidate.id === String(id || ''));
  if (!entry) throw new Error('Appairage introuvable ou déjà expiré.');
  entry.revokedAt = Date.now();
  purgeAccessTokens(party);
  party.updatedAt = Date.now();
  return true;
}

module.exports = {
  accessRole,
  issueAccessToken,
  purgeAccessTokens,
  revokeAccessToken,
};
