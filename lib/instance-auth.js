'use strict';

const crypto = require('crypto');
const COOKIE_NAME = 'songless_admin';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(header) {
  const result = {};
  String(header || '').split(';').forEach(part => {
    const separator = part.indexOf('=');
    if (separator < 1) return;
    result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  });
  return result;
}

function create(bootstrapToken, options = {}) {
  const bootstrap = String(bootstrapToken || crypto.randomBytes(32).toString('base64url'));
  const session = crypto.randomBytes(32).toString('base64url');
  return {
    bootstrapToken: bootstrap,
    authorize(value) { return safeEqual(value, bootstrap); },
    isAuthorized(req) {
      if (options.allowLocalForTests === true) return true;
      const parsed = cookies(req && req.headers && req.headers.cookie);
      return safeEqual(parsed[COOKIE_NAME], session);
    },
    setCookie(res) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict`);
    },
  };
}

module.exports = { COOKIE_NAME, cookies, create, safeEqual };
