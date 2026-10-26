import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getOrCreateVerifier, takeVerifier, challengeFor, parseOidcReturn } from './nativeOidc.js';

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

test('a pending verifier survives a remount and is used once', () => {
  const storage = memoryStorage();
  const v = getOrCreateVerifier(storage);
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  // The login screen remounting mid-login must not orphan the code in flight.
  assert.equal(getOrCreateVerifier(storage), v);
  assert.equal(takeVerifier(storage), v);
  assert.equal(takeVerifier(storage), null, 'taken means gone');
  assert.notEqual(getOrCreateVerifier(storage), v, 'the next login gets a fresh one');
});

test('challenge is RFC 7636 S256 and matches what the server checks', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  // The worked example from RFC 7636 appendix B.
  assert.equal(await challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  // And the exact derivation backend/src/utils/oidc.js consumeNativeCode uses.
  assert.equal(await challengeFor(verifier), createHash('sha256').update(verifier).digest('base64url'));
});

test('only bindarr://oidc return links are recognised', () => {
  assert.deepEqual(parseOidcReturn('bindarr://oidc?code=abc'), { code: 'abc' });
  assert.deepEqual(parseOidcReturn('bindarr://oidc/?code=abc'), { code: 'abc' });
  assert.deepEqual(parseOidcReturn('bindarr://oidc?oidc_error=Access%20denied'), { error: 'Access denied' });
  assert.equal(parseOidcReturn('bindarr://oidc'), null);
  assert.equal(parseOidcReturn('bindarr://oidcx?code=abc'), null);
  assert.equal(parseOidcReturn('bindarr://other?code=abc'), null);
  assert.equal(parseOidcReturn('https://cards.example.com/?code=abc'), null);
  assert.equal(parseOidcReturn(undefined), null);
});
