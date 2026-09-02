'use strict';

const assert = require('assert');
const crypto = require('crypto');
const auth = require('../lib/instance-auth');

const bootstrap = crypto.randomBytes(32).toString('base64url');
const instance = auth.create(bootstrap);
assert.strictEqual(instance.authorize(bootstrap), true);
assert.strictEqual(instance.authorize(crypto.randomBytes(32).toString('base64url')), false);
assert.deepStrictEqual(auth.cookies('a=1; songless_admin=abc%20123'), {
  a: '1', songless_admin: 'abc 123',
});

let cookie = '';
instance.setCookie({ setHeader(name, value) { if (name === 'Set-Cookie') cookie = value; } });
assert.match(cookie, /^songless_admin=/);
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Strict/);
assert.strictEqual(instance.isAuthorized({ headers: { cookie: cookie.split(';')[0] } }), true);
assert.strictEqual(instance.isAuthorized({ headers: { cookie: 'songless_admin=forged' } }), false);

console.log('OK  clé éphémère, cookie HttpOnly et faux jeton contrôlés');
