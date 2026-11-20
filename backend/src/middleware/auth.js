import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { getServiceClient, createAnonClient, createUserClient } from '../config/supabase.js';
import { AppError, Errors } from '../utils/app-error.js';
import { calcAge } from '../utils/helpers.js';

export const COOKIES = Object.freeze({ access: 'ec_at', refresh: 'ec_rt', remember: 'ec_rm' });

function baseCookie() {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: '/' };
}

/**
 * Tokens live in httpOnly, SameSite=Strict cookies (not reachable by JS).
 * Without "remember me" they are session cookies (cleared when the browser closes).
 */
export function setSessionCookies(res, session, remember) {
  const opts = baseCookie();
  if (remember) opts.maxAge = config.rememberMeDays * 24 * 3600 * 1000;
  res.cookie(COOKIES.access, session.access_token, opts);
  res.cookie(COOKIES.refresh, session.refresh_token, opts);
  if (remember) res.cookie(COOKIES.remember, '1', opts);
  else res.clearCookie(COOKIES.remember, baseCookie());
}

export function clearSessionCookies(res) {
  for (const name of Object.values(COOKIES)) res.clearCookie(name, baseCookie());
}

function isNetworkError(error) {
  return error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || /fetch failed/i.test(error.message || ''));
}

/* ---------- access-token verification cache ----------
   Verifying a token with Supabase Auth is a network round-trip on every API call.
   A successful verification is remembered briefly (≤60 s and never past the token's
   own expiry), keyed by a SHA-256 hash so raw tokens are not kept in memory.
   The profile (role / suspended status) is still read fresh on every request,
   and logout evicts the entry immediately. */
const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 5000;
const tokenCache = new Map();
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('base64url');

/** Unverified JWT payload — used only to start the profile lookup early; never trusted on its own. */
function peekClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

async function verifyAccessToken(svc, token) {
  const key = tokenKey(token);
  const hit = tokenCache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;
  if (hit) tokenCache.delete(key);
  const { data, error } = await svc.auth.getUser(token);
  if (isNetworkError(error)) throw Errors.unavailable('ไม่สามารถตรวจสอบการเข้าสู่ระบบได้ กรุณาลองใหม่');
  if (error || !data?.user) return null;
  const exp = Number(peekClaims(token)?.exp) * 1000;
  const until = Math.min(Date.now() + TOKEN_CACHE_TTL_MS, Number.isFinite(exp) ? exp - 5000 : 0);
  if (until > Date.now()) {
    if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value);
    tokenCache.set(key, { user: data.user, until });
  }
  return data.user;
}

/** Called on logout so a signed-out token is rejected immediately. */
export function forgetAccessToken(token) {
  if (token) tokenCache.delete(tokenKey(token));
}

const fetchProfile = (svc, id) => svc.from('profiles').select('*').eq('id', id).maybeSingle();

/**
 * Resolves the current user from cookies (optional). Refreshes an expired
 * access token transparently using the refresh token.
 */
export async function authenticate(req, res, next) {
  try {
    const at = req.cookies?.[COOKIES.access];
    const rt = req.cookies?.[COOKIES.refresh];
    if (!at && !rt) return next();

    const svc = getServiceClient();
    let token = at;
    let user = null;
    let profileRes = null;

    if (at) {
      // verify the token and load the profile in parallel; the profile is used only
      // if the verified user id matches the id it was looked up with
      const sub = peekClaims(at)?.sub;
      const profileP = typeof sub === 'string' ? fetchProfile(svc, sub) : null;
      const [verified, pr] = await Promise.all([verifyAccessToken(svc, at), profileP]);
      user = verified;
      if (user && pr && user.id === sub) profileRes = pr;
    }
    if (!user && rt) {
      const { data, error } = await createAnonClient().auth.refreshSession({ refresh_token: rt });
      if (isNetworkError(error)) throw Errors.unavailable('ไม่สามารถตรวจสอบการเข้าสู่ระบบได้ กรุณาลองใหม่');
      if (!error && data?.session) {
        token = data.session.access_token;
        user = data.user;
        setSessionCookies(res, data.session, req.cookies?.[COOKIES.remember] === '1');
      }
    }
    if (!user) {
      clearSessionCookies(res);
      return next();
    }

    const { data: profile, error: pErr } = profileRes ?? await fetchProfile(svc, user.id);
    if (pErr) throw Errors.unavailable();
    if (!profile) {
      clearSessionCookies(res);
      return next();
    }
    profile.age = calcAge(profile.birth_date);

    let db = null;
    req.auth = {
      userId: user.id,
      token,
      profile,
      isAdmin: profile.role === 'admin' && profile.status === 'active',
      // RLS-enforced client, created lazily
      get db() {
        if (!db) db = createUserClient(token);
        return db;
      },
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.auth) return next(Errors.unauthorized());
  if (req.auth.profile.status !== 'active') {
    clearSessionCookies(res);
    return next(new AppError(403, 'ACCOUNT_SUSPENDED', 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'));
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.auth) return next(Errors.unauthorized());
  if (!req.auth.isAdmin) return next(Errors.forbidden('เฉพาะผู้ดูแลระบบเท่านั้น'));
  return next();
}

export const requireAccountType = (...types) => (req, res, next) => {
  if (!req.auth) return next(Errors.unauthorized());
  if (!types.includes(req.auth.profile.account_type)) {
    return next(Errors.forbidden('ประเภทบัญชีของคุณไม่สามารถใช้งานฟังก์ชันนี้ได้'));
  }
  return next();
};
