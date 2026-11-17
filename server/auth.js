// Sign-in for Certify: 4-digit PIN per person, signed session cookie, and a
// stamp endpoint that only serves the signed-in person's own stamp.
// Plain Node (req, res) handlers so they run on Vercel and in the Vite server.
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { certifierById } from '../src/certifiers.js';

const COOKIE = 'certify_session';
const SESSION_HOURS = 12;
const MAX_FAILS = 5;            // per person + IP, then locked out
const LOCK_MS = 15 * 60 * 1000;
const FAIL_DELAY_MS = 900;      // slows down guessing

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

function checkPin(pin, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const want = Buffer.from(hex, 'hex');
  const got = scryptSync(pin, salt, want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

const pinHashFor = (id) => process.env[`PIN_${id.toUpperCase()}`];

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is not set');
  return s;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => createHmac('sha256', secret()).update(data).digest('base64url');

// The session carries a fingerprint of the PIN hash, so changing someone's
// PIN signs them out everywhere.
const pinTag = (id) => createHmac('sha256', secret()).update(pinHashFor(id) || '').digest('base64url').slice(0, 12);

function makeSession(id) {
  const body = b64(JSON.stringify({ u: id, t: pinTag(id), exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return `${body}.${sign(body)}`;
}

function readSession(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [body, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    const user = certifierById(s.u);
    if (!user || s.exp < Date.now() || s.t !== pinTag(user.id) || !pinHashFor(user.id)) return null;
    return user;
  } catch { return null; }
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (Buffer.isBuffer(data)) return res.end(data);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e4) throw new Error('too large'); }
  return raw ? JSON.parse(raw) : {};
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
const publicUser = (u) => ({ id: u.id, label: u.label, name: u.name });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Best-effort lockout. It lives in this server instance's memory, so it resets
// when the instance is recycled; the per-attempt delay still applies.
const fails = new Map();

export async function login(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  let input;
  try { input = await readJson(req); } catch { return send(res, 400, { error: 'Bad request' }); }
  const user = certifierById(input.user);
  const pin = String(input.pin ?? '');
  if (!user || !/^\d{4}$/.test(pin)) return send(res, 400, { error: 'Choose your name and enter your 4-digit PIN.' });

  const key = `${user.id}|${clientIp(req)}`;
  const rec = fails.get(key);
  if (rec && rec.until > Date.now()) {
    const mins = Math.ceil((rec.until - Date.now()) / 60000);
    return send(res, 429, { error: `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }

  const stored = pinHashFor(user.id);
  if (!stored) return send(res, 403, { error: `${user.label} doesn't have a PIN set up yet.` });

  if (!checkPin(pin, stored)) {
    const n = (rec?.n || 0) + 1;
    fails.set(key, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    await sleep(FAIL_DELAY_MS);
    return send(res, 401, { error: n >= MAX_FAILS ? 'Too many wrong PINs. Try again in 15 minutes.' : 'Wrong PIN.' });
  }

  fails.delete(key);
  return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': cookie(makeSession(user.id), SESSION_HOURS * 3600) });
}

export function logout(req, res) {
  return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
}

export function me(req, res) {
  const user = readSession(req);
  return user ? send(res, 200, { user: publicUser(user) }) : send(res, 401, { user: null });
}

export async function stamp(req, res) {
  const user = readSession(req);
  if (!user) return send(res, 401, { error: 'Not signed in' });
  try {
    const png = await readFile(path.join(process.cwd(), 'stamps', `${user.id}.png`));
    return send(res, 200, png, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
  } catch {
    return send(res, 404, { error: `No stamp has been added for ${user.label} yet.` });
  }
}

// Wraps a handler so a crash returns JSON rather than a bare 500 page.
export const safe = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Server error. Please try again.' });
  }
};
