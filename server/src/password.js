// PBKDF2-HMAC-SHA256 with a random salt. The owner authorized a 10,000-round
// candidate for the Cloudflare Free CPU limit. This is 60 times lower than
// OWASP's 600,000-round recommendation and substantially weakens resistance to
// offline password guessing after a hash leak. Full request CPU, concurrency,
// and long-term reliability remain unverified.
// The encoded value retains its own parameters; a successful login never
// downgrades a stronger hash. A runtime rejecting a stored hash's iteration
// count cannot verify it; such accounts need a trusted migration or reset.
import {base64url, fromBase64url, randomBytes, timingSafeEqual} from './util.js';
import {PASSWORD_LIMITS, passwordPolicyError} from '../../shared/password-policy.mjs';

// The composition rule and its visible message are shared with the desktop UI.
// The upper bound is a technical guard against abusive bodies, not a password
// composition rule. Existing accounts are still verified against their hash.
export {PASSWORD_LIMITS, passwordPolicyError};
export const CURRENT_PARAMS = Object.freeze({
  algorithm: 'pbkdf2-sha256',
  version: 1,
  iterations: 10000,
  saltBytes: 16,
  keyBytes: 32,
});

const encoder = new TextEncoder();
const MIN_ITERATIONS = 10000;
const MAX_ITERATIONS = 2000000;

function normalizeIterations(value) {
  return Number.isSafeInteger(value) && value >= MIN_ITERATIONS && value <= MAX_ITERATIONS ? value : 0;
}

async function derive(password, salt, iterations, keyBytes) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, material, keyBytes * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password, {iterations = CURRENT_PARAMS.iterations} = {}) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');
  const rounds = normalizeIterations(iterations);
  if (!rounds) throw new TypeError('invalid PBKDF2 iteration count');
  const salt = randomBytes(CURRENT_PARAMS.saltBytes);
  const derived = await derive(password, salt, rounds, CURRENT_PARAMS.keyBytes);
  return `${CURRENT_PARAMS.algorithm}$v=${CURRENT_PARAMS.version}$${rounds}$${base64url(salt)}$${base64url(derived)}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return {ok: false, needsRehash: false};
  const parts = encoded.split('$');
  if (parts.length !== 5 || parts[0] !== CURRENT_PARAMS.algorithm) return {ok: false, needsRehash: false};
  const version = Number(parts[1].replace(/^v=/, ''));
  const iterations = normalizeIterations(Number(parts[2]));
  if (version !== CURRENT_PARAMS.version || !iterations) return {ok: false, needsRehash: false};
  let salt, expected;
  try { salt = fromBase64url(parts[3]); expected = parts[4]; }
  catch { return {ok: false, needsRehash: false}; }
  const derived = await derive(password, salt, iterations, CURRENT_PARAMS.keyBytes);
  const ok = timingSafeEqual(base64url(derived), expected);
  return {ok, needsRehash: ok && iterations < CURRENT_PARAMS.iterations};
}

// Unknown-account logins still perform the same expensive derivation so the
// response time does not trivially reveal whether an email is registered.
let dummyHash;
export async function burnPasswordCheck(password) {
  if (!dummyHash) dummyHash = await hashPassword('yukino-dummy-password-never-valid');
  await verifyPassword(typeof password === 'string' ? password : 'invalid', dummyHash);
}
