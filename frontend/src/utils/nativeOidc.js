// SSO from the Android/iOS app (issue #94).
//
// The app sends the login to the system browser -- never an embedded WebView,
// which would see the user's IdP password (RFC 8252) -- and the server sends the
// result back through bindarr://oidc. Any app on the device can register that
// scheme, so the server never puts a session token in it: it sends a one-time code
// bound to the challenge we passed at the start, and only the verifier kept HERE
// can redeem it. See issueNativeCode in backend/src/utils/oidc.js.
//
// The verifier lives in localStorage, not memory: Android may kill the app while
// the user is in the browser, and the cold-started app still has to redeem the
// code that relaunched it.

const VERIFIER_KEY = 'bindarr_oidc_verifier';
const RETURN_PREFIX = 'bindarr://oidc';

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Reuse a pending verifier rather than minting a new one: the login screen can
// remount (cold start, server URL edits) while a login is still in flight, and
// replacing the verifier then would orphan the code on its way back.
export function getOrCreateVerifier(storage = localStorage) {
  let verifier = storage.getItem(VERIFIER_KEY);
  if (!verifier) {
    verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    storage.setItem(VERIFIER_KEY, verifier);
  }
  return verifier;
}

// Read and forget: a verifier is good for one redemption, then the next login
// starts with a fresh one. Null when no login was started from this app, which
// is how an unsolicited bindarr://oidc link gets ignored.
export function takeVerifier(storage = localStorage) {
  const verifier = storage.getItem(VERIFIER_KEY);
  storage.removeItem(VERIFIER_KEY);
  return verifier;
}

// RFC 7636 S256.
export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// { code } or { error } for a bindarr://oidc return link, null for any other URL.
// Parsed by hand rather than with URL(): how a custom scheme's host and query are
// split has varied between WebView versions, and this one shape is all we accept.
export function parseOidcReturn(url) {
  if (typeof url !== 'string') return null;
  if (url !== RETURN_PREFIX && !url.startsWith(`${RETURN_PREFIX}?`) && !url.startsWith(`${RETURN_PREFIX}/?`)) {
    return null;
  }
  const q = url.indexOf('?');
  const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
  const error = params.get('oidc_error');
  if (error) return { error };
  const code = params.get('code');
  return code ? { code } : null;
}
