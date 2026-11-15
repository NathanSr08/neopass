'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ---------- Configuration ----------
const PORT = Number(process.env.PORT) || 3000;
const WA_NUMBER = String(process.env.WA_NUMBER || '').replace(/\D/g, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const CATEGORIES = ['packs', 'streaming', 'vpn', 'musique', 'tv', 'logiciels'];
const STATUSES = ['new', 'confirmed', 'cancelled'];
const PAYMENT_METHODS = ['', 'revolut', 'usdt', 'btc', 'eth', 'especes', 'virement', 'autre'];
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const SITE_URL = 'https://' + (process.env.DOMAIN || 'neonpass.uned.live');

function fatal(msg) {
  console.error('[config] ' + msg);
  process.exit(1);
}
if (!process.env.DATABASE_URL) fatal('DATABASE_URL est requis.');
if (!WA_NUMBER) fatal('WA_NUMBER est requis (format international, chiffres uniquement).');
if (ADMIN_PASSWORD.length < 8) fatal('ADMIN_PASSWORD est requis (8 caractères minimum).');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// ---------- Utilitaires ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => round2(n).toString().replace('.', ',') + ' €';
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

// ---------- Notifications admin (Telegram / Discord) ----------
const notifyChannels = () => ({
  telegram: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
  discord: /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(DISCORD_WEBHOOK_URL)
});

async function notify(text) {
  const ch = notifyChannels();
  const jobs = [];
  if (ch.telegram) {
    jobs.push(
      fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(6000)
      }).then(async (r) => { if (!r.ok) throw new Error('Telegram ' + r.status + ' ' + (await r.text()).slice(0, 200)); })
    );
  }
  if (ch.discord) {
    jobs.push(
      fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(6000)
      }).then(async (r) => { if (!r.ok) throw new Error('Discord ' + r.status + ' ' + (await r.text()).slice(0, 200)); })
    );
  }
  const results = await Promise.allSettled(jobs);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  errors.forEach((e) => console.error('[notify] ' + e));
  return { sent: jobs.length - errors.length, errors };
}
// Envoi en arrière-plan : ne bloque jamais la réponse au client
const notifyLater = (text) => { notify(text).catch(() => {}); };

// ---------- Codes promo ----------
const normCode = (v) => str(v, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
const PROMO_VALID = `active AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR uses < max_uses)`;

function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Trop de requêtes, réessaie dans une minute.' });
    }
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}

function toOffer(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    tag: r.tag,
    price: Number(r.price),
    was: r.was_price == null ? null : Number(r.was_price),
    description: r.description,
    features: r.features,
    hue: r.hue,
    isPack: r.is_pack,
    packItems: Array.isArray(r.pack_items) ? r.pack_items : [],
    lowStockThreshold: r.low_stock_threshold == null ? 2 : Number(r.low_stock_threshold),
    active: r.active,
    sort: r.sort,
    rating: r.rating_avg == null ? null : Math.round(Number(r.rating_avg) * 10) / 10,
    reviewCount: Number(r.review_count) || 0
  };
}

const REVIEW_AGG = `
  LEFT JOIN (SELECT offer_id, avg(rating) AS rating_avg, count(*) AS review_count
             FROM reviews WHERE approved GROUP BY offer_id) ra ON ra.offer_id = o.id`;

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    discountPct: clampInt(m.discount_pct, 0, 90, 10),
    discountMin: clampInt(m.discount_min, 2, 10, 3),
    stockAlertsEnabled: m.stock_alerts_enabled !== 'false'
  };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- Sécurité de l'administration ----------
const ADMIN_COOKIE = 'np_admin';
const ADMIN_SESSION_HOURS = 12;
const DEFAULT_ADMIN_PASSWORDS = ['change-moi-8-caracteres-minimum'];
const sha256hex = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function readCookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}
function setAdminCookie(res, token, maxAgeSec) {
  res.append('Set-Cookie', ADMIN_COOKIE + '=' + encodeURIComponent(token) +
    '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAgeSec);
}

async function audit(req, action, details) {
  try {
    await pool.query('INSERT INTO admin_audit (ip, action, details) VALUES ($1, $2, $3)', [
      String(req.ip || ''), action, JSON.stringify(details || {})
    ]);
  } catch (e) {
    console.error('[audit] ' + e.message);
  }
}

// Anti-bruteforce : 5 échecs en 15 min par IP → blocage 15 min
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // ip -> { count, first, lockedUntil }
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of loginFails) if (now - f.first > LOGIN_WINDOW_MS && now > f.lockedUntil) loginFails.delete(ip);
}, 5 * 60 * 1000).unref();
function lockRemainingMs(ip) {
  const f = loginFails.get(ip);
  return f && f.lockedUntil > Date.now() ? f.lockedUntil - Date.now() : 0;
}
function recordFail(ip) {
  const now = Date.now();
  let f = loginFails.get(ip);
  if (!f || now - f.first > LOGIN_WINDOW_MS) f = { count: 0, first: now, lockedUntil: 0 };
  f.count++;
  const locked = f.count >= LOGIN_MAX_FAILS;
  if (locked) f.lockedUntil = now + LOGIN_WINDOW_MS;
  loginFails.set(ip, f);
  return { count: f.count, locked };
}

// TOTP (RFC 6238) : codes à 6 chiffres compatibles Google Authenticator, Authy…
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
// Renvoie le compteur accepté (fenêtre ±30 s) ou -1
function totpCheck(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return -1;
  const now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) {
    if (safeEqual(totpAt(secret, now + d), c)) return now + d;
  }
  return -1;
}
async function getSetting(key) {
  const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}
async function putSetting(key, value) {
  if (value == null) return pool.query('DELETE FROM settings WHERE key = $1', [key]);
  return pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value)]
  );
}
// Empêche de réutiliser un même code (rejeu)
async function consumeTotp(secret, code) {
  const counter = totpCheck(secret, code);
  if (counter < 0) return false;
  const last = Number(await getSetting('admin_totp_last')) || 0;
  if (counter <= last) return false;
  await putSetting('admin_totp_last', counter);
  return true;
}

// ----- Codes de secours 2FA : 10 codes à usage unique, stockés hachés (sha256) -----
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function normalizeBackupCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function generateBackupCodes(n = 10) {
  const codes = [];
  while (codes.length < n) {
    let c = '';
    for (let i = 0; i < 10; i++) c += BACKUP_ALPHABET[crypto.randomInt(BACKUP_ALPHABET.length)];
    if (!codes.includes(c)) codes.push(c);
  }
  return codes;
}
async function getBackupHashes() {
  try {
    const a = JSON.parse((await getSetting('admin_backup_codes')) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}
// Remplace les codes existants ; renvoie les codes en clair (affichés une seule fois)
async function storeBackupCodes() {
  const codes = generateBackupCodes();
  await putSetting('admin_backup_codes', JSON.stringify(codes.map((c) => sha256hex(c))));
  return codes.map((c) => c.slice(0, 5) + '-' + c.slice(5));
}
async function consumeBackupCode(code) {
  const c = normalizeBackupCode(code);
  if (c.length !== 10) return false;
  const hashes = await getBackupHashes();
  const i = hashes.indexOf(sha256hex(c));
  if (i < 0) return false;
  hashes.splice(i, 1);
  await putSetting('admin_backup_codes', JSON.stringify(hashes));
  return true;
}
// Renvoie 'totp', 'backup' ou false
async function verifySecondFactor(secret, code) {
  const raw = String(code || '').trim();
  if (/^\d{6}$/.test(raw.replace(/\s/g, ''))) return (await consumeTotp(secret, raw)) ? 'totp' : false;
  return (await consumeBackupCode(raw)) ? 'backup' : false;
}

// ----- Liste blanche d'IP pour l'admin (IPv4, IPv4 CIDR, IPv6 exacte) -----
function normalizeIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  return s;
}
function ipv4ToInt(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const p = Number(m[i]);
    if (p > 255) return null;
    n = n * 256 + p;
  }
  return n;
}
function parseAllowEntry(raw) {
  const s = normalizeIp(raw);
  const cidr = /^([0-9.]+)\/(\d{1,2})$/.exec(s);
  if (cidr) {
    const base = ipv4ToInt(cidr[1]);
    const bits = Number(cidr[2]);
    if (base === null || bits > 32) return null;
    return { base, bits };
  }
  const single = ipv4ToInt(s);
  if (single !== null) return { base: single, bits: 32 };
  if (s.length <= 45 && s.includes(':') && /^[0-9a-f:]+$/.test(s)) return { v6: s };
  return null;
}
function ipMatches(entry, ip) {
  if (entry.v6) return entry.v6 === ip;
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const size = 2 ** (32 - entry.bits);
  return Math.floor(n / size) === Math.floor(entry.base / size);
}
async function getIpAllowlist() {
  try {
    const a = JSON.parse((await getSetting('admin_ip_allowlist')) || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch (e) {
    return [];
  }
}
// ADMIN_IP_ALLOW_OFF=1 dans .env ignore la liste (secours en cas de blocage)
async function ipGuard(req, res, next) {
  try {
    if (process.env.ADMIN_IP_ALLOW_OFF === '1') return next();
    const list = await getIpAllowlist();
    if (!list.length) return next();
    const ip = normalizeIp(req.ip);
    if (list.map(parseAllowEntry).some((e) => e && ipMatches(e, ip))) return next();
    console.warn('[admin] accès refusé par la liste blanche : ' + ip);
    if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'Accès refusé depuis cette adresse IP.' });
    res.status(403).type('text').send('Accès refusé.');
  } catch (e) {
    next(e);
  }
}

async function adminSession(req) {
  const token = readCookieValue(req, ADMIN_COOKIE);
  if (!token) return null;
  const r = await pool.query('SELECT token_hash FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()', [sha256hex(token)]);
  return r.rows[0] || null;
}

async function adminAuth(req, res, next) {
  try {
    const s = await adminSession(req);
    if (s) {
      // Anti-CSRF : les écritures doivent venir du panneau (en-tête impossible à poser depuis un autre site)
      if (req.method !== 'GET' && req.get('X-NP-Admin') !== '1') {
        return res.status(403).json({ error: 'Requête refusée.' });
      }
      return next();
    }
  } catch (e) {
    return next(e);
  }
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
  res.redirect(302, '/admin/login');
}

function parseOffer(b) {
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'Le nom est requis.');
  const price = Number(b.price);
  if (!(price >= 0 && price <= 9999)) throw new HttpError(400, 'Prix invalide.');
  let was = null;
  if (b.was !== '' && b.was != null) {
    was = Number(b.was);
    if (!(was >= 0 && was <= 99999)) throw new HttpError(400, 'Valeur barrée invalide.');
  }
  const category = str(b.category, 20);
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Catégorie invalide.');
  const slug = slugify(b.slug || name);
  if (!slug) throw new HttpError(400, 'Identifiant (slug) invalide.');
  const features = (Array.isArray(b.features) ? b.features : [])
    .map((f) => str(f, 100))
    .filter(Boolean)
    .slice(0, 8);
  return {
    slug,
    name,
    category,
    tag: str(b.tag, 30),
    price: round2(price),
    was,
    description: str(b.description, 300),
    features,
    hue: clampInt(b.hue, 0, 360, 330),
    isPack: !!b.isPack,
    packItems: Array.isArray(b.packItems)
      ? b.packItems.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [],
    lowStockThreshold: clampInt(b.lowStockThreshold, 0, 100, 2),
    active: b.active === undefined ? true : !!b.active,
    sort: clampInt(b.sort, -9999, 9999, 0)
  };
}

// ---------- Application ----------
const app = express();
app.set('trust proxy', 1); // derrière Traefik
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  next();
});
app.use(express.json({ limit: '20kb' }));

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.type('text').send('ok');
  } catch (e) {
    res.status(503).type('text').send('db indisponible');
  }
});

// ----- API publique -----
app.get(
  '/api/config',
  wrap(async (req, res) => {
    const s = await getSettings();
    res.json({ waNumber: WA_NUMBER, discountPct: s.discountPct, discountMin: s.discountMin });
  })
);

app.get(
  '/api/offers',
  wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT o.*, ra.rating_avg, ra.review_count FROM offers o ${REVIEW_AGG}
                                       WHERE o.active ORDER BY COALESCE(ra.review_count, 0) DESC, o.sort, o.id`);
    res.json(rows.map(toOffer));
  })
);

// ----- Avis -----
app.get(
  '/api/offers/:id/reviews',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.author, r.rating, r.comment, r.created_at
       FROM reviews r JOIN offers o ON o.id = r.offer_id
       WHERE r.offer_id = $1 AND r.approved AND o.active
       ORDER BY r.created_at DESC LIMIT 50`,
      [Number(req.params.id) || 0]
    );
    res.json(rows);
  })
);

app.post(
  '/api/offers/:id/reviews',
  rateLimit(3, 10 * 60 * 1000),
  wrap(async (req, res) => {
    const offerId = Number(req.params.id);
    const author = str(req.body.author, 40);
    const rating = parseInt(req.body.rating, 10);
    const comment = str(req.body.comment, 600);
    if (!author) throw new HttpError(400, 'Indique ton prénom.');
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Choisis une note de 1 à 5 étoiles.');
    if (comment.length < 5) throw new HttpError(400, 'Ton avis doit faire au moins 5 caractères.');
    const o = await pool.query('SELECT 1 FROM offers WHERE id = $1 AND active', [offerId || 0]);
    if (!o.rowCount) throw new HttpError(404, 'Offre introuvable.');
    await pool.query('INSERT INTO reviews (offer_id, author, rating, comment) VALUES ($1, $2, $3, $4)', [
      offerId, author, rating, comment
    ]);
    const on = await pool.query('SELECT name FROM offers WHERE id = $1', [offerId]);
    notifyLater(
      '⭐ Nouvel avis à valider\n' +
      (on.rows[0] ? on.rows[0].name : 'Offre #' + offerId) + ' — ' + '★'.repeat(rating) + '☆'.repeat(5 - rating) + '\n' +
      author + ' : « ' + comment.slice(0, 300) + ' »\n' + SITE_URL + '/admin'
    );
    res.status(201).json({ ok: true, message: 'Merci ! Ton avis sera publié après validation.' });
  })
);

app.post(
  '/api/promo/check',
  rateLimit(15, 60 * 1000),
  wrap(async (req, res) => {
    const code = normCode(req.body.code);
    if (!code) throw new HttpError(400, 'Saisis un code promo.');
    const r = await pool.query(`SELECT code, pct FROM promo_codes WHERE code = $1 AND ${PROMO_VALID}`, [code]);
    if (!r.rowCount) throw new HttpError(404, 'Ce code promo est invalide ou expiré.');
    res.json({ code: r.rows[0].code, pct: r.rows[0].pct });
  })
);

app.post(
  '/api/orders',
  rateLimit(10, 60 * 1000),
  wrap(async (req, res) => {
    const raw = Array.isArray(req.body.offerIds) ? req.body.offerIds : [];
    const ids = [...new Set(raw.map(Number).filter(Number.isInteger))].slice(0, 10);
    if (!ids.length) throw new HttpError(400, 'Aucune offre sélectionnée.');

    const { rows } = await pool.query('SELECT * FROM offers WHERE id = ANY($1) AND active ORDER BY sort, id', [ids]);
    if (rows.length !== ids.length) throw new HttpError(400, 'Une des offres n\'est plus disponible.');

    const settings = await getSettings();
    const sum = rows.reduce((s, r) => s + Number(r.price), 0);
    const discount = rows.length >= settings.discountMin && settings.discountPct > 0;
    const items = rows.map((r) => ({ id: r.id, name: r.name, price: Number(r.price) }));
    const name = str(req.body.name || req.body.firstName, 60);
    const lastName = str(req.body.lastName, 60);
    const phone = str(req.body.phone, 30);
    const affiliation = str(req.body.affiliation, 60);
    const promoCode = normCode(req.body.promoCode);

    // Transaction : l'utilisation du code promo n'est comptée que si la commande est bien créée
    const client = await pool.connect();
    let orderId, total, promo = null;
    try {
      await client.query('BEGIN');
      if (promoCode) {
        const pr = await client.query(
          `UPDATE promo_codes SET uses = uses + 1 WHERE code = $1 AND ${PROMO_VALID} RETURNING code, pct`,
          [promoCode]
        );
        if (!pr.rowCount) throw new HttpError(400, 'Ce code promo est invalide ou expiré.');
        promo = pr.rows[0];
      }
      let t = discount ? sum * (1 - settings.discountPct / 100) : sum;
      if (promo) t = t * (1 - promo.pct / 100);
      total = round2(t);
      const ins = await client.query(
        `INSERT INTO orders (customer_name, customer_last_name, customer_phone, items, total, discount, promo_code, promo_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [name, lastName, phone, JSON.stringify(items), total, discount, promo ? promo.code : null, promo ? promo.pct : null]
      );
      orderId = ins.rows[0].id;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    const message =
      'Bonjour, je souhaite commander (réf. #' + orderId + ') : ' +
      items.map((i) => i.name).join(' + ') +
      '. Total : ' + money(total) + '/an' +
      (discount ? ' (remise ' + settings.discountPct + ' % incluse)' : '') +
      (promo ? ' (code ' + promo.code + ' −' + promo.pct + ' % inclus)' : '') + '.' +
      (name ? ' Prénom : ' + name + '.' : '') +
      (phone ? ' Tél : ' + phone + '.' : '') +
      (affiliation ? ' Affiliation : ' + affiliation + '.' : '');

    notifyLater(
      '🛒 Nouvelle commande #' + orderId + '\n' +
      items.map((i) => '• ' + i.name + ' — ' + money(i.price)).join('\n') + '\n' +
      'Total : ' + money(total) + '/an' +
      (discount ? ' · remise pack −' + settings.discountPct + ' %' : '') +
      (promo ? ' · code ' + promo.code + ' −' + promo.pct + ' %' : '') +
      (name ? '\nClient : ' + [name, lastName].filter(Boolean).join(' ') : '') +
      (phone ? '\nTél : ' + phone : '') +
      (affiliation ? '\nAffiliation : ' + affiliation : '') +
      '\n' + SITE_URL + '/admin'
    );

    res.status(201).json({
      orderId,
      total,
      whatsappUrl: 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(message)
    });
  })
);

// ----- Espace Client / Fiche d'accès sécurisée par lien privé -----
app.get(
  '/api/acces/:token',
  wrap(async (req, res) => {
    const token = str(req.params.token, 64);
    if (!token) throw new HttpError(400, 'Lien invalide.');

    const ordRes = await pool.query(
      `SELECT id, customer_name, customer_last_name, customer_phone, items, total, status, created_at,
              to_char(expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at,
              expires_at AS raw_expires_at, access_token
       FROM orders
       WHERE access_token = $1`,
      [token]
    );
    if (!ordRes.rowCount) throw new HttpError(404, 'Fiche d\'accès introuvable ou lien expiré.');
    const ord = ordRes.rows[0];

    const accRes = await pool.query(
      `SELECT a.id, a.offer_id, a.service_name, a.login, a.password, a.slot_profile, a.notes,
              o.name AS offer_name, o.hue, o.is_pack, o.pack_items
       FROM accounts a
       JOIN offers o ON o.id = a.offer_id
       WHERE a.order_id = $1 AND a.status = 'assigned'
       ORDER BY a.id ASC`,
      [ord.id]
    );

    let daysRemaining = null;
    let isExpired = false;
    if (ord.raw_expires_at) {
      const now = new Date();
      const diffMs = new Date(ord.raw_expires_at).getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / (24 * 3600 * 1000));
      isExpired = daysRemaining < 0;
    }

    res.json({
      order: {
        id: ord.id,
        customerName: [ord.customer_name, ord.customer_last_name].filter(Boolean).join(' ') || 'Client',
        status: ord.status,
        createdAt: ord.created_at,
        expiresAt: ord.expires_at,
        daysRemaining,
        isExpired,
        items: ord.items
      },
      accounts: accRes.rows.map((a) => ({
        id: a.id,
        offerId: a.offer_id,
        serviceName: a.offer_name || a.service_name,
        login: a.login,
        password: a.password,
        slotProfile: a.slot_profile,
        notes: a.notes,
        hue: a.hue || 200,
        isPack: a.is_pack,
        packItems: a.pack_items || []
      })),
      waNumber: WA_NUMBER
    });
  })
);

app.get('/acces/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'access.html'));
});

// ----- Administration -----
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

// Liste blanche d'IP : s'applique à la page de connexion, à l'admin et à son API
app.use(['/admin', '/api/admin'], ipGuard);

app.get('/admin/login', noStore, wrap(async (req, res) => {
  if (await adminSession(req)) return res.redirect(302, '/admin');
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
}));

app.get('/admin', noStore, adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/api/admin/login-info', noStore, wrap(async (req, res) => {
  res.json({ totp: !!(await getSetting('admin_totp_secret')) });
}));

app.post(
  '/api/admin/login',
  noStore,
  wrap(async (req, res) => {
    const ip = String(req.ip || '');
    const wait = lockRemainingMs(ip);
    if (wait) throw new HttpError(429, 'Trop d\'essais. Réessaie dans ' + Math.ceil(wait / 60000) + ' min.');

    const user = String(req.body.user || '').slice(0, 100);
    const pass = String(req.body.password || '').slice(0, 200);
    let ok = safeEqual(user, ADMIN_USER) & safeEqual(pass, ADMIN_PASSWORD);
    let reason = ok ? '' : 'identifiants';
    const secret = await getSetting('admin_totp_secret');
    let usedBackup = false;
    if (ok && secret) {
      const factor = await verifySecondFactor(secret, req.body.code);
      if (!factor) { ok = 0; reason = 'code 2FA'; }
      else usedBackup = factor === 'backup';
    }

    if (!ok) {
      const f = recordFail(ip);
      await audit(req, 'login.echec', { user, raison: reason, essai: f.count });
      if (f.locked) {
        await audit(req, 'login.blocage', { minutes: LOGIN_WINDOW_MS / 60000 });
        notifyLater('🚨 Admin : ' + f.count + ' échecs de connexion, IP ' + ip + ' bloquée 15 min.');
      }
      await new Promise((r) => setTimeout(r, 600));
      throw new HttpError(401, f.locked
        ? 'Trop d\'essais. Réessaie dans 15 min.'
        : (reason === 'code 2FA' ? 'Code de double authentification incorrect.' : 'Identifiant ou mot de passe incorrect.') +
          ' (' + (LOGIN_MAX_FAILS - f.count) + ' essai(s) restant(s))');
    }

    loginFails.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO admin_sessions (token_hash, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, now() + interval '${ADMIN_SESSION_HOURS} hours')`,
      [sha256hex(token), ip, String(req.get('user-agent') || '').slice(0, 300)]
    );
    setAdminCookie(res, token, ADMIN_SESSION_HOURS * 3600);
    await audit(req, 'login.ok', { ua: String(req.get('user-agent') || '').slice(0, 150), codeSecours: usedBackup });
    if (usedBackup) {
      const left = (await getBackupHashes()).length;
      notifyLater('⚠️ Connexion à l\'admin NeonPass avec un code de secours. Codes restants : ' + left + '.');
    }
    notifyLater('🔐 Connexion à l\'admin NeonPass\nIP : ' + ip + '\n' + String(req.get('user-agent') || '').slice(0, 120));
    res.json({ ok: true });
  })
);

const admin = express.Router();
admin.use(noStore, adminAuth);

// Journal automatique de toutes les modifications réussies
const SECRET_KEYS = /pass|code|secret|token/i;
admin.use((req, res, next) => {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const body = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      body[k] = SECRET_KEYS.test(k) ? '•••' : typeof v === 'string' ? v.slice(0, 200) : v;
    }
    audit(req, req.method + ' ' + req.path, body);
  });
  next();
});

admin.post('/logout', wrap(async (req, res) => {
  const token = readCookieValue(req, ADMIN_COOKIE);
  if (token) await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256hex(token)]);
  setAdminCookie(res, '', 0);
  res.json({ ok: true });
}));

admin.post('/logout-all', wrap(async (req, res) => {
  await pool.query('DELETE FROM admin_sessions');
  setAdminCookie(res, '', 0);
  res.json({ ok: true });
}));

admin.get('/security', wrap(async (req, res) => {
  const sessions = await pool.query(
    'SELECT ip, user_agent, created_at, expires_at FROM admin_sessions WHERE expires_at > now() ORDER BY created_at DESC'
  );
  res.json({
    totp: !!(await getSetting('admin_totp_secret')),
    defaultPassword: DEFAULT_ADMIN_PASSWORDS.includes(ADMIN_PASSWORD) || ADMIN_PASSWORD.length < 12,
    sessions: sessions.rows,
    backupCodesLeft: (await getBackupHashes()).length,
    ipAllowlist: await getIpAllowlist(),
    ipAllowlistOff: process.env.ADMIN_IP_ALLOW_OFF === '1',
    currentIp: normalizeIp(req.ip)
  });
}));

admin.get('/audit', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, at, ip, action, details FROM admin_audit ORDER BY at DESC LIMIT 300');
  res.json(rows);
}));

// Activation de la 2FA : 1) générer un secret en attente, 2) confirmer avec un code
admin.post('/totp/setup', wrap(async (req, res) => {
  if (await getSetting('admin_totp_secret')) throw new HttpError(400, 'La double authentification est déjà active.');
  const secret = base32Encode(crypto.randomBytes(20));
  await putSetting('admin_totp_pending', secret);
  const label = encodeURIComponent('NeonPass:' + ADMIN_USER);
  res.json({ secret, uri: 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=NeonPass&digits=6&period=30' });
}));

admin.post('/totp/enable', wrap(async (req, res) => {
  const pending = await getSetting('admin_totp_pending');
  if (!pending) throw new HttpError(400, 'Relance la configuration.');
  if (totpCheck(pending, req.body.code) < 0) throw new HttpError(400, 'Code incorrect. Vérifie l\'heure de ton téléphone et réessaie.');
  await putSetting('admin_totp_secret', pending);
  await putSetting('admin_totp_pending', null);
  await putSetting('admin_totp_last', null);
  const backupCodes = await storeBackupCodes();
  notifyLater('🔐 Double authentification ACTIVÉE sur l\'admin NeonPass.');
  res.json({ ok: true, backupCodes });
}));

admin.post('/totp/disable', wrap(async (req, res) => {
  const secret = await getSetting('admin_totp_secret');
  if (!secret) throw new HttpError(400, 'La double authentification n\'est pas active.');
  if (!(await verifySecondFactor(secret, req.body.code))) throw new HttpError(400, 'Code incorrect.');
  await putSetting('admin_totp_secret', null);
  await putSetting('admin_backup_codes', null);
  notifyLater('⚠️ Double authentification DÉSACTIVÉE sur l\'admin NeonPass.');
  res.json({ ok: true });
}));

// Régénération des codes de secours (exige un code actuel de l'application)
admin.post('/totp/backup-codes', wrap(async (req, res) => {
  const secret = await getSetting('admin_totp_secret');
  if (!secret) throw new HttpError(400, 'La double authentification n\'est pas active.');
  if (!(await consumeTotp(secret, req.body.code))) throw new HttpError(400, 'Code incorrect.');
  const backupCodes = await storeBackupCodes();
  notifyLater('🔑 Codes de secours 2FA régénérés sur l\'admin NeonPass.');
  res.json({ backupCodes });
}));

// Liste blanche d'IP : l'IP actuelle doit y figurer pour ne pas se bloquer soi-même
admin.put('/ip-allowlist', wrap(async (req, res) => {
  const input = Array.isArray(req.body.list) ? req.body.list : String(req.body.list || '').split(/[\s,;]+/);
  const list = [];
  for (const raw of input) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (!parseAllowEntry(s)) throw new HttpError(400, 'Adresse invalide : ' + s.slice(0, 50));
    const norm = normalizeIp(s);
    if (!list.includes(norm)) list.push(norm);
  }
  if (list.length > 50) throw new HttpError(400, '50 adresses maximum.');
  const me = normalizeIp(req.ip);
  if (list.length && !list.map(parseAllowEntry).some((e) => ipMatches(e, me))) {
    throw new HttpError(400, 'Ton adresse actuelle (' + me + ') doit figurer dans la liste, sinon tu serais bloqué.');
  }
  await putSetting('admin_ip_allowlist', list.length ? JSON.stringify(list) : null);
  res.json({ list, currentIp: me });
}));

// ----- Exports CSV (séparateur « ; » et BOM UTF-8 pour Excel en français) -----
function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Neutralise les formules (=, +, -, @) sauf les valeurs purement numériques ou téléphoniques
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[0-9][0-9 ().,-]*$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function sendCsv(res, filename, header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + filename + '"'
  });
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
}
function csvMoney(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '';
}
const STATUS_LABELS = { new: 'Nouvelle', confirmed: 'Confirmée', cancelled: 'Annulée' };

admin.get('/export/orders.csv', wrap(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT id, customer_name, customer_last_name, customer_phone, items, total::float AS total, discount,
            promo_code, promo_pct, payment_method, notes, source, status,
            to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS created,
            to_char(expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at
     FROM orders WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 20000`,
    [status]
  );
  const header = ['Réf.', 'Date', 'Prénom', 'Nom', 'Téléphone', 'Offres', 'Total (€)', 'Remise (€)', 'Code promo',
    'Promo (%)', 'Paiement', 'Source', 'Statut', 'Échéance', 'Notes'];
  const data = rows.map((o) => [
    o.id,
    o.created,
    o.customer_name,
    o.customer_last_name,
    o.customer_phone,
    (Array.isArray(o.items) ? o.items : []).map((it) => (it && it.name ? String(it.name) : '')).filter(Boolean).join(' + '),
    csvMoney(o.total),
    csvMoney(o.discount),
    o.promo_code,
    o.promo_pct,
    o.payment_method,
    o.source,
    STATUS_LABELS[o.status] || o.status,
    o.expires_at,
    o.notes
  ]);
  await audit(req, 'export.orders', { lignes: rows.length, statut: status || 'toutes' });
  sendCsv(res, 'commandes-' + new Date().toISOString().slice(0, 10) + '.csv', header, data);
}));

admin.get('/export/audit.csv', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT to_char(at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI:SS') AS at_paris, ip, action, details
     FROM admin_audit ORDER BY at DESC LIMIT 20000`
  );
  const data = rows.map((r) => [r.at_paris, r.ip, r.action, JSON.stringify(r.details || {})]);
  await audit(req, 'export.audit', { lignes: rows.length });
  sendCsv(res, 'journal-' + new Date().toISOString().slice(0, 10) + '.csv', ['Date', 'IP', 'Action', 'Détails'], data);
}));

// État du système : processus Node, connexion à la base et volumes de données
admin.get('/system', wrap(async (req, res) => {
  const t0 = process.hrtime.bigint();
  await pool.query('SELECT 1');
  const dbMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const info = await pool.query(
    `SELECT current_setting('server_version') AS version,
            pg_database_size(current_database())::float AS size,
            (SELECT count(*) FROM orders)::int AS orders,
            (SELECT count(*) FROM admin_sessions WHERE expires_at > now())::int AS sessions,
            (SELECT count(*) FROM admin_audit)::int AS audit`
  );
  const mem = process.memoryUsage();
  res.json({
    node: process.version,
    uptime: Math.round(process.uptime()),
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    dbMs: Math.round(dbMs * 10) / 10,
    pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    pg: info.rows[0],
    serverTime: new Date().toISOString()
  });
}));

// Tableau de bord des ventes
admin.get('/sales', wrap(async (req, res) => {
  const months = await pool.query(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
        date_trunc('month', now() AT TIME ZONE 'Europe/Paris'),
        interval '1 month') AS m
    )
    SELECT to_char(months.m, 'YYYY-MM') AS month,
           count(o.id)::int AS orders,
           COALESCE(sum(o.total), 0)::float AS revenue
    FROM months
    LEFT JOIN orders o ON o.status = 'confirmed'
      AND date_trunc('month', o.created_at AT TIME ZONE 'Europe/Paris') = months.m
    GROUP BY months.m
    ORDER BY months.m`);
  const offers = await pool.query(`
    SELECT it->>'name' AS name,
           count(*)::int AS qty,
           COALESCE(sum(CASE WHEN (it->>'price') ~ '^[0-9]+([.][0-9]+)?$' THEN (it->>'price')::numeric ELSE 0 END), 0)::float AS amount
    FROM orders o,
         jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
    WHERE o.status = 'confirmed'
    GROUP BY it->>'name'
    ORDER BY amount DESC, qty DESC
    LIMIT 15`);
  const kpis = await pool.query(`
    SELECT
      count(*)::int AS total_orders,
      count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_count,
      count(*) FILTER (WHERE status = 'new')::int AS pending_count,
      COALESCE(sum(total) FILTER (WHERE status = 'confirmed'), 0)::float AS confirmed_revenue,
      COALESCE(sum(total) FILTER (WHERE status = 'new'), 0)::float AS pending_revenue,
      CASE WHEN count(*) FILTER (WHERE status = 'confirmed') > 0
        THEN round(COALESCE(sum(total) FILTER (WHERE status = 'confirmed'), 0) / count(*) FILTER (WHERE status = 'confirmed'), 2)::float
        ELSE 0 END AS avg_basket,
      COALESCE(sum(total) FILTER (WHERE status = 'confirmed' AND date_trunc('month', created_at AT TIME ZONE 'Europe/Paris') = date_trunc('month', now() AT TIME ZONE 'Europe/Paris')), 0)::float AS month_revenue,
      count(*) FILTER (WHERE status = 'confirmed' AND date_trunc('month', created_at AT TIME ZONE 'Europe/Paris') = date_trunc('month', now() AT TIME ZONE 'Europe/Paris'))::int AS month_orders,
      CASE WHEN count(*) > 0
        THEN round((count(*) FILTER (WHERE status = 'confirmed')::numeric / count(*)::numeric) * 100, 1)::float
        ELSE 0 END AS conv_rate
    FROM orders`);

  const costQuery = await pool.query(`
    SELECT
      COALESCE(sum(cost), 0)::float AS total_expenses,
      COALESCE(sum(cost) FILTER (WHERE status = 'assigned'), 0)::float AS assigned_cost,
      count(*)::int AS total_stock,
      count(*) FILTER (WHERE status = 'available')::int AS available_stock
    FROM accounts
  `);
  const costs = costQuery.rows[0];
  const totalRevenue = kpis.rows[0].confirmed_revenue;
  const netMargin = Math.round((totalRevenue - costs.total_expenses) * 100) / 100;
  const marginPct = totalRevenue > 0 ? Math.round(((netMargin / totalRevenue) * 100) * 10) / 10 : 0;
  const enrichedKpis = {
    ...kpis.rows[0],
    total_expenses: costs.total_expenses,
    net_margin: netMargin,
    margin_pct: marginPct,
    total_stock: costs.total_stock,
    available_stock: costs.available_stock
  };
  res.json({ months: months.rows, offers: offers.rows, kpis: enrichedKpis });
}));

admin.get(
  '/stats',
  wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'new')::int AS new_count,
             count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_count,
             count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
             COALESCE(sum(total) FILTER (WHERE status = 'confirmed'), 0)::float AS confirmed_total,
             count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7
      FROM orders`);
    const o = await pool.query('SELECT count(*)::int AS n FROM offers WHERE active');
    const rv = await pool.query('SELECT count(*) FILTER (WHERE NOT approved)::int AS pending FROM reviews');
    res.json({ ...rows[0], activeOffers: o.rows[0].n, pendingReviews: rv.rows[0].pending });
  })
);

admin.get(
  '/orders',
  wrap(async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT o.id, o.customer_name, o.customer_last_name, o.customer_phone, o.items, o.total::float AS total, o.discount,
              o.promo_code, o.promo_pct, o.payment_method, o.notes, o.source, o.status, o.created_at, o.access_token,
              to_char(o.expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at, o.reminder_sent_at,
              COALESCE(acc.cnt, 0)::int AS assigned_accounts_count
       FROM orders o
       LEFT JOIN (
         SELECT order_id, count(*)::int AS cnt FROM accounts GROUP BY order_id
       ) acc ON acc.order_id = o.id
       WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 500`,
      [status]
    );
    res.json(rows);
  })
);

// Champs client/paiement communs à la création et à la modification
function parseOrderInfo(b) {
  const out = {};
  if (b.firstName !== undefined) out.customer_name = str(b.firstName, 60);
  if (b.lastName !== undefined) out.customer_last_name = str(b.lastName, 60);
  if (b.phone !== undefined) {
    const phone = str(b.phone, 30);
    if (phone && !/^\+?[0-9 ().-]{6,30}$/.test(phone)) throw new HttpError(400, 'Numéro de téléphone invalide.');
    out.customer_phone = phone;
  }
  if (b.paymentMethod !== undefined) {
    const pm = str(b.paymentMethod, 20);
    if (!PAYMENT_METHODS.includes(pm)) throw new HttpError(400, 'Moyen de paiement invalide.');
    out.payment_method = pm;
  }
  if (b.notes !== undefined) out.notes = str(b.notes, 2000);
  if (b.status !== undefined) {
    const st = str(b.status, 20);
    if (!STATUSES.includes(st)) throw new HttpError(400, 'Statut invalide.');
    out.status = st;
  }
  if (b.expiresAt !== undefined) {
    const d = str(b.expiresAt, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "Date d'échéance invalide.");
    out.expires_at = d ? d + ' 12:00 Europe/Paris' : null;
  }
  return out;
}

// À la confirmation, l'échéance est fixée à +12 mois si elle n'est pas déjà renseignée
const setDefaultExpiry = (id) => pool.query(
  `UPDATE orders SET expires_at = now() + interval '12 months'
   WHERE id = $1 AND status = 'confirmed' AND expires_at IS NULL`, [id]);

admin.post(
  '/orders',
  wrap(async (req, res) => {
    const raw = Array.isArray(req.body.offerIds) ? req.body.offerIds : [];
    const ids = raw.map(Number).filter(Number.isInteger).slice(0, 20);
    if (!ids.length) throw new HttpError(400, 'Choisis au moins un produit.');
    // L'admin peut ajouter des offres masquées ; une offre peut apparaître plusieurs fois
    const { rows } = await pool.query('SELECT id, name, price FROM offers WHERE id = ANY($1)', [ids]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (ids.some((id) => !byId.has(id))) throw new HttpError(400, 'Un des produits est introuvable.');
    const items = ids.map((id) => ({ id, name: byId.get(id).name, price: Number(byId.get(id).price) }));

    const info = parseOrderInfo(req.body);
    if (!info.customer_name && !info.customer_last_name) throw new HttpError(400, 'Indique au moins le nom ou le prénom du client.');

    let total;
    let discount = false;
    if (req.body.total !== '' && req.body.total != null) {
      total = Number(req.body.total);
      if (!(total >= 0 && total <= 99999)) throw new HttpError(400, 'Total invalide.');
      total = round2(total);
    } else {
      const settings = await getSettings();
      const sum = items.reduce((s, i) => s + i.price, 0);
      discount = items.length >= settings.discountMin && settings.discountPct > 0;
      total = round2(discount ? sum * (1 - settings.discountPct / 100) : sum);
    }

    const token = crypto.randomBytes(16).toString('hex');
    const r = await pool.query(
      `INSERT INTO orders (customer_name, customer_last_name, customer_phone, items, total, discount,
                           payment_method, notes, status, source, access_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'admin', $10) RETURNING id, access_token`,
      [info.customer_name || '', info.customer_last_name || '', info.customer_phone || '', JSON.stringify(items),
       total, discount, info.payment_method || '', info.notes || '', info.status || 'confirmed', token]
    );
    await setDefaultExpiry(r.rows[0].id);
    res.status(201).json({ ok: true, id: r.rows[0].id, total, accessToken: token });
  })
);

admin.patch(
  '/orders/:id',
  wrap(async (req, res) => {
    const info = parseOrderInfo(req.body);
    if (Array.isArray(req.body.offerIds) && req.body.offerIds.length > 0) {
      const raw = req.body.offerIds;
      const ids = raw.map(Number).filter(Number.isInteger).slice(0, 20);
      if (ids.length) {
        const { rows } = await pool.query('SELECT id, name, price FROM offers WHERE id = ANY($1)', [ids]);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const items = ids.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id).name, price: Number(byId.get(id).price) }));
        if (items.length) {
          info.items = JSON.stringify(items);
        }
      }
    }
    if (req.body.total !== '' && req.body.total != null) {
      const total = Number(req.body.total);
      if (!(total >= 0 && total <= 99999)) throw new HttpError(400, 'Total invalide.');
      info.total = round2(total);
    }
    const cols = Object.keys(info);
    if (!cols.length) throw new HttpError(400, 'Rien à modifier.');
    const sets = cols.map((c, i) => c + ' = $' + (i + 1)).join(', ');
    const r = await pool.query(
      'UPDATE orders SET ' + sets + ' WHERE id = $' + (cols.length + 1) + ' RETURNING id',
      [...cols.map((c) => info[c]), Number(req.params.id) || 0]
    );
    if (!r.rowCount) throw new HttpError(404, 'Commande introuvable.');
    await setDefaultExpiry(Number(req.params.id) || 0);
    res.json({ ok: true });
  })
);

// ----- Échéances -----
// Numéro au format international pour wa.me (un numéro français en 0X est converti en 33X)
function waPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{9}$/.test(d)) d = '33' + d.slice(1);
  return d.length >= 8 ? d : '';
}
const frDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

admin.get(
  '/renewals',
  wrap(async (req, res) => {
    const days = clampInt(req.query.days, 1, 365, 30);
    const { rows } = await pool.query(
      `SELECT id, customer_name, customer_last_name, customer_phone, items, total::float AS total,
              expires_at, reminder_sent_at,
              ceil(extract(epoch FROM expires_at - now()) / 86400)::int AS days_left
       FROM orders
       WHERE status = 'confirmed' AND expires_at IS NOT NULL
         AND expires_at <= now() + make_interval(days => $1)
         AND expires_at >= now() - interval '30 days'
       ORDER BY expires_at`,
      [days]
    );
    res.json(rows.map((r) => ({ ...r, hasPhone: !!waPhone(r.customer_phone) })));
  })
);

admin.post(
  '/orders/:id/reminder',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const r = await pool.query(
      'UPDATE orders SET reminder_sent_at = now() WHERE id = $1 RETURNING customer_name, customer_phone, items, expires_at',
      [id]
    );
    if (!r.rowCount) throw new HttpError(404, 'Commande introuvable.');
    const o = r.rows[0];
    const phone = waPhone(o.customer_phone);
    const msg =
      'Bonjour' + (o.customer_name ? ' ' + o.customer_name : '') + ', ton abonnement ' +
      (o.items || []).map((i) => i.name).join(' + ') +
      (o.expires_at ? ' arrive à échéance le ' + frDate(o.expires_at) : ' arrive bientôt à échéance') +
      ' (réf. #' + id + '). Souhaites-tu le renouveler ? Réponds simplement à ce message.';
    res.json({ ok: true, whatsappUrl: phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg) : null });
  })
);

admin.delete(
  '/orders/:id',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM orders WHERE id = $1', [Number(req.params.id)]);
    res.status(204).end();
  })
);

admin.get(
  '/offers',
  wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT o.*, ra.rating_avg, ra.review_count FROM offers o ${REVIEW_AGG}
                                       ORDER BY o.sort, o.id`);
    res.json(rows.map(toOffer));
  })
);

const OFFER_COLS = 'slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort, pack_items, low_stock_threshold';
function offerValues(o) {
  return [o.slug, o.name, o.category, o.tag, o.price, o.was, o.description, JSON.stringify(o.features), o.hue, o.isPack, o.active, o.sort, JSON.stringify(o.packItems || []), o.lowStockThreshold || 2];
}
function dupGuard(e) {
  if (e && e.code === '23505') throw new HttpError(409, 'Ce slug existe déjà, choisis-en un autre.');
  throw e;
}

admin.post(
  '/offers',
  wrap(async (req, res) => {
    const o = parseOffer(req.body);
    try {
      const r = await pool.query(
        `INSERT INTO offers (${OFFER_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        offerValues(o)
      );
      res.status(201).json(toOffer(r.rows[0]));
    } catch (e) {
      dupGuard(e);
    }
  })
);

admin.put(
  '/offers/:id',
  wrap(async (req, res) => {
    const o = parseOffer(req.body);
    try {
      const r = await pool.query(
        `UPDATE offers SET slug=$1, name=$2, category=$3, tag=$4, price=$5, was_price=$6, description=$7,
                features=$8, hue=$9, is_pack=$10, active=$11, sort=$12, pack_items=$13, low_stock_threshold=$14 WHERE id=$15 RETURNING *`,
        [...offerValues(o), Number(req.params.id)]
      );
      if (!r.rowCount) throw new HttpError(404, 'Offre introuvable.');
      res.json(toOffer(r.rows[0]));
    } catch (e) {
      dupGuard(e);
    }
  })
);

admin.delete(
  '/offers/:id',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM offers WHERE id = $1', [Number(req.params.id)]);
    res.status(204).end();
  })
);

admin.get(
  '/reviews',
  wrap(async (req, res) => {
    const f = req.query.status === 'pending' ? false : req.query.status === 'approved' ? true : null;
    const { rows } = await pool.query(
      `SELECT r.id, r.offer_id, o.name AS offer_name, r.author, r.rating, r.comment, r.approved, r.created_at
       FROM reviews r JOIN offers o ON o.id = r.offer_id
       WHERE ($1::boolean IS NULL OR r.approved = $1) ORDER BY r.created_at DESC LIMIT 500`,
      [f]
    );
    res.json(rows);
  })
);

admin.patch(
  '/reviews/:id',
  wrap(async (req, res) => {
    const r = await pool.query('UPDATE reviews SET approved = $1 WHERE id = $2 RETURNING id', [
      !!req.body.approved, Number(req.params.id) || 0
    ]);
    if (!r.rowCount) throw new HttpError(404, 'Avis introuvable.');
    res.json({ ok: true });
  })
);

admin.delete(
  '/reviews/:id',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM reviews WHERE id = $1', [Number(req.params.id) || 0]);
    res.status(204).end();
  })
);

admin.get(
  '/promos',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT code, pct, expires_at, max_uses, uses, active, created_at,
              (${PROMO_VALID}) AS usable FROM promo_codes ORDER BY created_at DESC`
    );
    res.json(rows);
  })
);

admin.post(
  '/promos',
  wrap(async (req, res) => {
    const code = normCode(req.body.code);
    if (code.length < 3) throw new HttpError(400, 'Le code doit faire au moins 3 caractères (lettres, chiffres, - ou _).');
    const pct = parseInt(req.body.pct, 10);
    if (!(pct >= 1 && pct <= 90)) throw new HttpError(400, 'La remise doit être comprise entre 1 et 90 %.');
    let expires = null;
    if (req.body.expiresAt) {
      expires = new Date(req.body.expiresAt);
      if (isNaN(expires)) throw new HttpError(400, "Date d'expiration invalide.");
    }
    let maxUses = null;
    if (req.body.maxUses !== '' && req.body.maxUses != null) {
      maxUses = parseInt(req.body.maxUses, 10);
      if (!(maxUses >= 1 && maxUses <= 100000)) throw new HttpError(400, "Nombre d'utilisations invalide.");
    }
    try {
      await pool.query('INSERT INTO promo_codes (code, pct, expires_at, max_uses) VALUES ($1, $2, $3, $4)', [code, pct, expires, maxUses]);
    } catch (e) {
      if (e && e.code === '23505') throw new HttpError(409, 'Ce code existe déjà.');
      throw e;
    }
    res.status(201).json({ ok: true, code });
  })
);

admin.patch(
  '/promos/:code',
  wrap(async (req, res) => {
    const r = await pool.query('UPDATE promo_codes SET active = $1 WHERE code = $2 RETURNING code', [!!req.body.active, normCode(req.params.code)]);
    if (!r.rowCount) throw new HttpError(404, 'Code introuvable.');
    res.json({ ok: true });
  })
);

admin.delete(
  '/promos/:code',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM promo_codes WHERE code = $1', [normCode(req.params.code)]);
    res.status(204).end();
  })
);

async function checkLowStockAlert(offerId) {
  if (!offerId) return;
  try {
    const { stockAlertsEnabled } = await getSettings();
    if (!stockAlertsEnabled) return;

    const oRes = await pool.query('SELECT id, name, is_pack, low_stock_threshold FROM offers WHERE id = $1', [offerId]);
    if (!oRes.rowCount || oRes.rows[0].is_pack) return;
    const off = oRes.rows[0];
    const thresh = off.low_stock_threshold != null ? Number(off.low_stock_threshold) : 2;

    const cntRes = await pool.query(
      "SELECT count(*)::int AS cnt FROM accounts WHERE offer_id = $1 AND status = 'available'",
      [off.id]
    );
    const avail = cntRes.rows[0].cnt;
    if (avail <= thresh) {
      const supRes = await pool.query(
        "SELECT supplier, supplier_url, cost FROM accounts WHERE offer_id = $1 AND supplier != '' ORDER BY id DESC LIMIT 1",
        [off.id]
      );
      const sup = supRes.rows[0] || {};
      let msg = `⚠️ ALERTE STOCK BAS : ${off.name}\n` +
                `Il ne reste que ${avail} compte(s) disponible(s) en stock (seuil critique configuré : ${thresh}) !`;
      if (sup.supplier) msg += `\nFournisseur habituel : ${sup.supplier} (coût : ${sup.cost || 0} €)`;
      if (sup.supplier_url) msg += `\nLien réapprovisionnement direct : ${sup.supplier_url}`;
      notifyLater(msg);
    }
  } catch (e) {
    console.error('[stock-alert] error:', e.message);
  }
}

// ----- Coffre-fort de comptes & licences (Stock et attribution) -----
admin.get(
  '/accounts',
  wrap(async (req, res) => {
    const offerId = Number(req.query.offerId) || null;
    const status = ['available', 'assigned', 'archived'].includes(req.query.status) ? req.query.status : null;
    const supplier = str(req.query.supplier, 120);
    const q = str(req.query.search, 80).toLowerCase();
    const sort = req.query.sort || 'default';
    const warrantyOnly = req.query.warranty === 'true';

    let filterOfferIds = null;
    if (offerId) {
      const oRes = await pool.query('SELECT is_pack, pack_items FROM offers WHERE id = $1', [offerId]);
      if (oRes.rowCount && oRes.rows[0].is_pack && Array.isArray(oRes.rows[0].pack_items) && oRes.rows[0].pack_items.length) {
        filterOfferIds = oRes.rows[0].pack_items;
      } else {
        filterOfferIds = [offerId];
      }
    }

    let sql = `
      SELECT a.*, o.name AS offer_name, o.is_pack,
             ord.customer_name, ord.customer_last_name, ord.customer_phone
      FROM accounts a
      JOIN offers o ON o.id = a.offer_id
      LEFT JOIN orders ord ON ord.id = a.order_id
      WHERE ($1::int[] IS NULL OR a.offer_id = ANY($1))
        AND ($2::text IS NULL OR a.status = $2)
        AND ($3::text IS NULL OR a.supplier = $3)
    `;
    const params = [filterOfferIds, status, supplier || null];
    if (warrantyOnly) {
      sql += ` AND a.warranty_claim = TRUE`;
    }
    if (q) {
      sql += ` AND (lower(a.login) LIKE $4 OR lower(a.slot_profile) LIKE $4 OR lower(a.notes) LIKE $4 OR lower(COALESCE(a.private_notes, '')) LIKE $4 OR lower(a.supplier) LIKE $4 OR lower(o.name) LIKE $4 OR lower(COALESCE(ord.customer_name, '')) LIKE $4 OR lower(COALESCE(ord.customer_phone, '')) LIKE $4 OR lower(COALESCE(a.defect_reason, '')) LIKE $4)`;
      params.push('%' + q + '%');
    }

    if (sort === 'recent') {
      sql += ` ORDER BY a.created_at DESC LIMIT 500`;
    } else if (sort === 'oldest') {
      sql += ` ORDER BY a.created_at ASC LIMIT 500`;
    } else if (sort === 'cost_desc') {
      sql += ` ORDER BY a.cost DESC, a.created_at DESC LIMIT 500`;
    } else if (sort === 'cost_asc') {
      sql += ` ORDER BY a.cost ASC, a.created_at DESC LIMIT 500`;
    } else if (sort === 'name_asc') {
      sql += ` ORDER BY o.name ASC, a.created_at DESC LIMIT 500`;
    } else {
      sql += ` ORDER BY CASE a.status WHEN 'available' THEN 1 WHEN 'assigned' THEN 2 ELSE 3 END, a.created_at DESC LIMIT 500`;
    }

    const { rows } = await pool.query(sql, params);

    const stock = await pool.query(`
      SELECT o.id AS offer_id, o.name AS offer_name, o.is_pack, o.pack_items, o.low_stock_threshold,
             count(*) FILTER (WHERE a.status = 'available')::int AS available_count,
             count(*) FILTER (WHERE a.status = 'assigned')::int AS assigned_count,
             count(a.id)::int AS total_count,
             COALESCE(sum(a.cost), 0)::float AS total_cost
      FROM offers o
      LEFT JOIN accounts a ON a.offer_id = o.id
      WHERE o.active
      GROUP BY o.id, o.name, o.sort, o.is_pack, o.pack_items, o.low_stock_threshold
      ORDER BY o.sort, o.id
    `);

    // Map counts per base service
    const availMap = {};
    const nameMap = {};
    stock.rows.forEach((r) => {
      availMap[r.offer_id] = Number(r.available_count || 0);
      nameMap[r.offer_id] = r.offer_name;
    });

    // Compute pack virtual deliverable stock from base component stocks
    stock.rows.forEach((r) => {
      if (r.is_pack) {
        const subIds = Array.isArray(r.pack_items) ? r.pack_items : [];
        if (subIds.length) {
          r.pack_deliverable_count = Math.min(...subIds.map((id) => availMap[id] || 0));
          r.pack_components = subIds.map((id) => ({
            id,
            name: nameMap[id] || ('Service #' + id),
            available: availMap[id] || 0
          }));
        } else {
          r.pack_deliverable_count = 0;
          r.pack_components = [];
        }
      }
    });

    // Alertes stock bas pour les offres unitaires sous le seuil
    const { stockAlertsEnabled } = await getSettings();
    const lowStockAlerts = [];
    if (stockAlertsEnabled) {
      stock.rows.forEach((r) => {
        if (!r.is_pack) {
          const thresh = r.low_stock_threshold == null ? 2 : Number(r.low_stock_threshold);
          const avail = Number(r.available_count || 0);
          if (avail <= thresh) {
            lowStockAlerts.push({
              offerId: r.offer_id,
              offerName: r.offer_name,
              available: avail,
              threshold: thresh
            });
          }
        }
      });
    }

    const wRes = await pool.query('SELECT count(*)::int AS cnt FROM accounts WHERE warranty_claim = TRUE');
    const warrantyClaimsCount = wRes.rows[0].cnt;

    const suppliersRes = await pool.query(`
      SELECT DISTINCT supplier FROM accounts WHERE supplier != '' ORDER BY supplier
    `);

    res.json({
      accounts: rows,
      stock: stock.rows,
      summary: stock.rows,
      suppliers: suppliersRes.rows.map((r) => r.supplier),
      alerts: lowStockAlerts,
      stockAlertsEnabled,
      warrantyClaimsCount
    });
  })
);

admin.post(
  '/accounts',
  wrap(async (req, res) => {
    const offerId = Number(req.body.offerId);
    const login = str(req.body.login, 120);
    const password = str(req.body.password, 120);
    const slotProfile = str(req.body.slotProfile, 80);
    const notes = str(req.body.notes, 1000);
    const privateNotes = str(req.body.privateNotes, 2000);
    const supplier = str(req.body.supplier, 120);
    const supplierUrl = str(req.body.supplierUrl, 255);
    const cost = Math.max(0, parseFloat(req.body.cost) || 0);

    if (!offerId) throw new HttpError(400, 'Choisis une offre.');
    if (!login) throw new HttpError(400, "L'identifiant / login est requis.");

    const o = await pool.query('SELECT name FROM offers WHERE id = $1', [offerId]);
    if (!o.rowCount) throw new HttpError(404, 'Offre introuvable.');

    const r = await pool.query(
      `INSERT INTO accounts (offer_id, service_name, login, password, slot_profile, notes, private_notes, supplier, supplier_url, cost, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'available') RETURNING *`,
      [offerId, o.rows[0].name, login, password, slotProfile, notes, privateNotes, supplier, supplierUrl, cost]
    );
    res.status(201).json(r.rows[0]);
  })
);

admin.patch(
  '/accounts/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const out = {};
    if (req.body.offerId !== undefined) {
      out.offer_id = Number(req.body.offerId);
      const o = await pool.query('SELECT name FROM offers WHERE id = $1', [out.offer_id]);
      if (o.rowCount) out.service_name = o.rows[0].name;
    }
    if (req.body.login !== undefined) out.login = str(req.body.login, 120);
    if (req.body.password !== undefined) out.password = str(req.body.password, 120);
    if (req.body.slotProfile !== undefined) out.slot_profile = str(req.body.slotProfile, 80);
    if (req.body.notes !== undefined) out.notes = str(req.body.notes, 1000);
    if (req.body.privateNotes !== undefined) out.private_notes = str(req.body.privateNotes, 2000);
    if (req.body.supplier !== undefined) out.supplier = str(req.body.supplier, 120);
    if (req.body.supplierUrl !== undefined) out.supplier_url = str(req.body.supplierUrl, 255);
    if (req.body.cost !== undefined) out.cost = Math.max(0, parseFloat(req.body.cost) || 0);
    if (req.body.orderId === null) {
      out.order_id = null;
      out.assigned_at = null;
      out.status = 'available';
    }
    if (req.body.status !== undefined && ['available', 'assigned', 'archived'].includes(req.body.status)) {
      out.status = req.body.status;
      if (out.status === 'available') {
        out.order_id = null;
        out.assigned_at = null;
      }
    }
    const cols = Object.keys(out);
    if (!cols.length) throw new HttpError(400, 'Rien à modifier.');
    const sets = cols.map((c, i) => c + ' = $' + (i + 1)).join(', ');
    const r = await pool.query(
      'UPDATE accounts SET ' + sets + ' WHERE id = $' + (cols.length + 1) + ' RETURNING *',
      [...cols.map((c) => out[c]), id]
    );
    if (!r.rowCount) throw new HttpError(404, 'Compte introuvable.');
    res.json(r.rows[0]);
  })
);

admin.delete(
  '/accounts/:id',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM accounts WHERE id = $1', [Number(req.params.id) || 0]);
    res.status(204).end();
  })
);

admin.get(
  '/orders/:id/accounts',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const { rows } = await pool.query(
      `SELECT a.*, o.name AS offer_name
       FROM accounts a
       JOIN offers o ON o.id = a.offer_id
       WHERE a.order_id = $1
       ORDER BY a.assigned_at ASC, a.id ASC`,
      [orderId]
    );
    res.json(rows);
  })
);

admin.post(
  '/orders/:id/assign-account',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const ord = await pool.query('SELECT id, status, customer_name, customer_phone FROM orders WHERE id = $1', [orderId]);
    if (!ord.rowCount) throw new HttpError(404, 'Commande introuvable.');

    if (req.body.accountId) {
      const accId = Number(req.body.accountId);
      const r = await pool.query('SELECT * FROM accounts WHERE id = $1 AND status = $2', [accId, 'available']);
      if (!r.rowCount) throw new HttpError(400, 'Ce compte n\'est pas disponible.');
      const account = r.rows[0];
      const upd = await pool.query(
        `UPDATE accounts SET status = 'assigned', order_id = $1, assigned_at = now() WHERE id = $2 RETURNING *`,
        [orderId, account.id]
      );
      checkLowStockAlert(account.offer_id);
      return res.json({ ok: true, account: upd.rows[0], accounts: [upd.rows[0]] });
    }

    if (req.body.offerId) {
      const offerId = Number(req.body.offerId);
      const offRes = await pool.query('SELECT id, name, is_pack, pack_items FROM offers WHERE id = $1', [offerId]);
      if (!offRes.rowCount) throw new HttpError(404, 'Offre introuvable.');
      const targetOffer = offRes.rows[0];

      if (targetOffer.is_pack) {
        const subIds = Array.isArray(targetOffer.pack_items) ? targetOffer.pack_items : [];
        if (!subIds.length) {
          throw new HttpError(400, 'Ce pack ne contient aucun service configuré.');
        }

        const accountsToAssign = [];
        for (const subId of subIds) {
          const subOff = await pool.query('SELECT id, name FROM offers WHERE id = $1', [subId]);
          const subName = subOff.rowCount ? subOff.rows[0].name : 'Service #' + subId;
          const r = await pool.query(
            'SELECT * FROM accounts WHERE offer_id = $1 AND status = $2 ORDER BY id ASC LIMIT 1',
            [subId, 'available']
          );
          if (!r.rowCount) {
            throw new HttpError(400, 'Stock insuffisant pour ' + subName + ' dans le ' + targetOffer.name + '.');
          }
          accountsToAssign.push(r.rows[0]);
        }

        const assigned = [];
        for (const acc of accountsToAssign) {
          const upd = await pool.query(
            `UPDATE accounts SET status = 'assigned', order_id = $1, assigned_at = now() WHERE id = $2 RETURNING *`,
            [orderId, acc.id]
          );
          assigned.push(upd.rows[0]);
        }
        for (const subId of subIds) {
          checkLowStockAlert(subId);
        }
        return res.json({ ok: true, isPack: true, accounts: assigned, account: assigned[0] });
      } else {
        const r = await pool.query(
          'SELECT * FROM accounts WHERE offer_id = $1 AND status = $2 ORDER BY id ASC LIMIT 1',
          [offerId, 'available']
        );
        if (!r.rowCount) throw new HttpError(400, 'Aucun compte disponible en stock pour cette offre.');
        const account = r.rows[0];
        const upd = await pool.query(
          `UPDATE accounts SET status = 'assigned', order_id = $1, assigned_at = now() WHERE id = $2 RETURNING *`,
          [orderId, account.id]
        );
        checkLowStockAlert(offerId);
        return res.json({ ok: true, account: upd.rows[0], accounts: [upd.rows[0]] });
      }
    }

    throw new HttpError(400, 'Indique un accountId ou un offerId.');
  })
);

function formatAccountForWaServer(acc) {
  const svcName = acc.offer_name || acc.service_name || 'Accès';
  const fullRaw = [acc.login, acc.notes].filter(Boolean).join('\n');

  const isXtream = fullRaw.includes("Codes Xtream") || fullRaw.includes("Nom d'utilisateur") || fullRaw.includes("msostvip") || fullRaw.includes("m3u");
  if (isXtream) {
    const userM = fullRaw.match(/(?:Nom d'utilisateur|Username|User)\s*:\s*([^\r\n]+)/i);
    const passM = fullRaw.match(/(?:Mot de passe|Password|Pass)\s*:\s*([^\r\n]+)/i);
    const srvM = fullRaw.match(/(?:URL du serveur \(pour la plupart des applications\)|URL du serveur|Serveur|DNS|Host)\s*:\s*(https?:\/\/[^\s\r\n]+)/i);
    const lgM = fullRaw.match(/(?:URL du serveur \(IPTV Smarters sur Samsung\/LG\)|Serveur DNS Samsung et LG|Samsung\/LG)\s*:\s*(https?:\/\/[^\s\r\n]+)/i);
    const m3uM = fullRaw.match(/(?:URL de la playlist M3U|Lien M3U|M3U)\s*:\s*(https?:\/\/[^\s\r\n]+)/i) || fullRaw.match(/(https?:\/\/[^\s\r\n]+\.php\?[^\s\r\n]+)/i);

    const userVal = userM ? userM[1].split(/(?:🔑|Mot de passe|Password)/i)[0].trim() : '';
    const passVal = passM ? passM[1].split(/(?:🌐|URL|Serveur|DNS|Host|🔗|M3U)/i)[0].trim() : '';
    const srvVal = srvM ? srvM[1].trim() : '';
    const lgVal = lgM ? lgM[1].trim() : '';
    const m3uVal = m3uM ? (m3uM[1] || m3uM[0]).trim() : '';

    let out = `📺 *${svcName.toUpperCase()}*\n`;
    if (userVal) out += `👤 *Identifiant / User :* ${userVal}\n`;
    if (passVal) out += `🔑 *Mot de passe :* ${passVal}\n`;
    if (srvVal) out += `🌐 *Serveur (Applications) :* ${srvVal}\n`;
    if (lgVal) out += `📺 *Serveur (Samsung / LG) :* ${lgVal}\n`;
    if (m3uVal) out += `🔗 *Lien Playlist M3U :*\n${m3uVal}\n`;
    return out.trim();
  }

  let cleanLogin = acc.login || '';
  let cleanPass = acc.password || '';

  if (cleanLogin.includes(':') && !cleanPass) {
    const parts = cleanLogin.split(':');
    cleanLogin = parts[0].trim();
    cleanPass = parts.slice(1).join(':').trim();
  }

  let out = `📺 *${svcName}*\n`;
  out += `👤 *Identifiant :* ${cleanLogin}\n`;
  if (cleanPass) out += `🔑 *Mot de passe :* ${cleanPass}\n`;
  if (acc.slot_profile) out += `📱 *Profil / Écran :* ${acc.slot_profile}\n`;
  if (acc.notes && acc.notes.trim() !== cleanLogin && acc.notes.trim() !== cleanPass && !acc.notes.includes(cleanLogin)) {
    out += `📌 *Consignes :* ${acc.notes.trim()}\n`;
  }
  return out.trim();
}

admin.post(
  '/orders/:id/activate-sav/:accountId',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const accountId = Number(req.params.accountId) || 0;
    const reason = str(req.body.reason, 255) || 'Signalement client / Non fonctionnel';

    const ordRes = await pool.query(
      'SELECT id, customer_name, customer_last_name, customer_phone, access_token FROM orders WHERE id = $1',
      [orderId]
    );
    if (!ordRes.rowCount) throw new HttpError(404, 'Commande introuvable.');

    const accRes = await pool.query(
      'SELECT a.*, o.name AS offer_name FROM accounts a JOIN offers o ON o.id = a.offer_id WHERE a.id = $1 AND a.order_id = $2',
      [accountId, orderId]
    );
    if (!accRes.rowCount) throw new HttpError(404, 'Ce compte n\'est pas associé à cette commande.');
    const acc = accRes.rows[0];

    const now = new Date();
    const upd = await pool.query(
      `UPDATE accounts
       SET warranty_claim = TRUE, defect_reason = $1, defect_at = $2
       WHERE id = $3 RETURNING *`,
      [reason, now, accountId]
    );

    res.json({
      ok: true,
      account: { ...upd.rows[0], offer_name: acc.offer_name },
      invoice: acc.private_notes || '',
      supplier: acc.supplier || '',
      supplierUrl: acc.supplier_url || '',
      defectAt: now.toISOString(),
      defectReason: reason
    });
  })
);

admin.post(
  '/orders/:id/resolve-sav/:accountId',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const accountId = Number(req.params.accountId) || 0;

    const ordRes = await pool.query(
      'SELECT id, customer_name, customer_last_name, customer_phone, access_token FROM orders WHERE id = $1',
      [orderId]
    );
    if (!ordRes.rowCount) throw new HttpError(404, 'Commande introuvable.');
    const ord = ordRes.rows[0];

    const accRes = await pool.query(
      'SELECT a.*, o.name AS offer_name FROM accounts a JOIN offers o ON o.id = a.offer_id WHERE a.id = $1 AND a.order_id = $2',
      [accountId, orderId]
    );
    if (!accRes.rowCount) throw new HttpError(404, 'Ce compte n\'est pas associé à cette commande.');
    const acc = accRes.rows[0];

    // Nouveaux identifiants reçus du fournisseur
    const login = str(req.body.login, 500) || acc.login;
    const password = req.body.password !== undefined ? str(req.body.password, 120) : acc.password;
    const slotProfile = req.body.slotProfile !== undefined ? str(req.body.slotProfile, 80) : acc.slot_profile;
    const notes = req.body.notes !== undefined ? str(req.body.notes, 2000) : acc.notes;
    const privateNotes = req.body.privateNotes !== undefined ? str(req.body.privateNotes, 2000) : acc.private_notes;

    const upd = await pool.query(
      `UPDATE accounts
       SET login = $1, password = $2, slot_profile = $3, notes = $4, private_notes = $5,
           warranty_claim = FALSE, defect_at = NULL, defect_reason = ''
       WHERE id = $6 RETURNING *`,
      [login, password, slotProfile, notes, privateNotes, accountId]
    );
    const updatedAcc = { ...upd.rows[0], offer_name: acc.offer_name };

    // Formatage WhatsApp retour SAV propre
    const clientPhone = waPhone(ord.customer_phone);
    const clientName = [ord.customer_name, ord.customer_last_name].filter(Boolean).join(' ') || 'Client';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const accessUrl = ord.access_token ? `${baseUrl}/acces/${ord.access_token}` : '';

    const formattedAccStr = formatAccountForWaServer(updatedAcc);

    let msg = `✨ *NEONPASS — Remplacement sous Garantie SAV* ✨\n\n` +
      `Bonjour *${clientName}*,\n\n` +
      `Suite à votre signalement, votre accès pour *${updatedAcc.offer_name || updatedAcc.service_name}* a été entièrement renouvelé et vérifié par notre équipe technique sous votre garantie NeonPass.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      formattedAccStr + '\n' +
      `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (accessUrl) {
      msg += `🔗 *VOTRE ESPACE ABONNÉ SÉCURISÉ (À jour) :*\n` +
        `👉 ${accessUrl}\n` +
        `_(Retrouvez vos nouveaux accès et tutoriels 24/7)_\n\n`;
    }

    msg += `Toutes nos excuses pour cette interruption de service. Votre abonnement continue normalement !\n\n` +
      `Restant à votre entière écoute sur WhatsApp.\n` +
      `*Bon divertissement !* 🍿🚀`;

    const whatsappUrl = clientPhone ? 'https://wa.me/' + clientPhone + '?text=' + encodeURIComponent(msg) : null;

    res.json({
      ok: true,
      account: updatedAcc,
      message: msg,
      whatsappUrl
    });
  })
);

admin.post(
  '/orders/:id/replace-account/:accountId',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const accountId = Number(req.params.accountId) || 0;
    const reason = str(req.body.reason, 255) || 'Signalement client / Non fonctionnel';

    const ordRes = await pool.query(
      'SELECT id, customer_name, customer_last_name, customer_phone, access_token FROM orders WHERE id = $1',
      [orderId]
    );
    if (!ordRes.rowCount) throw new HttpError(404, 'Commande introuvable.');
    const ord = ordRes.rows[0];

    const oldRes = await pool.query(
      'SELECT * FROM accounts WHERE id = $1 AND order_id = $2',
      [accountId, orderId]
    );
    if (!oldRes.rowCount) throw new HttpError(404, 'Ce compte n\'est pas associé à cette commande.');
    const oldAcc = oldRes.rows[0];

    const repRes = await pool.query(
      'SELECT * FROM accounts WHERE offer_id = $1 AND status = $2 ORDER BY id ASC LIMIT 1',
      [oldAcc.offer_id, 'available']
    );
    if (!repRes.rowCount) {
      throw new HttpError(400, `Stock épuisé pour ${oldAcc.service_name || 'ce service'}. Impossible de remplacer immédiatement.`);
    }
    const newAcc = repRes.rows[0];

    await pool.query(
      `UPDATE accounts
       SET status = 'archived', warranty_claim = TRUE, defect_reason = $1, defect_at = now(), replaced_by_account_id = $2, order_id = NULL
       WHERE id = $3`,
      [reason, newAcc.id, oldAcc.id]
    );

    const updNew = await pool.query(
      `UPDATE accounts SET status = 'assigned', order_id = $1, assigned_at = now() WHERE id = $2 RETURNING *`,
      [orderId, newAcc.id]
    );

    checkLowStockAlert(oldAcc.offer_id);

    const clientPhone = waPhone(ord.customer_phone);
    const clientName = [ord.customer_name, ord.customer_last_name].filter(Boolean).join(' ') || 'Client';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const accessUrl = ord.access_token ? `${baseUrl}/acces/${ord.access_token}` : '';
    let msg = `Bonjour ${clientName},\n\nSuite à votre signalement, nous avons procédé au remplacement immédiat de votre accès pour *${oldAcc.service_name}* sous garantie NeonPass.\n\n` +
      `🔑 *Nouvel Identifiant :* ${newAcc.login}\n` +
      `🔒 *Nouveau Mot de passe :* ${newAcc.password}\n`;
    if (newAcc.slot_profile) msg += `👤 *Profil / Écran :* ${newAcc.slot_profile}\n`;
    if (newAcc.notes) msg += `📌 *Consignes :* ${newAcc.notes}\n`;
    if (accessUrl) msg += `\n🔗 *Votre fiche d'accès sécurisée :* ${accessUrl}\n`;
    msg += `\nToutes nos excuses pour ce contretemps. Si vous avez la moindre question, nous restons à votre entière disposition !`;

    const whatsappUrl = clientPhone ? 'https://wa.me/' + clientPhone + '?text=' + encodeURIComponent(msg) : null;

    res.json({
      ok: true,
      oldAccountId: oldAcc.id,
      newAccount: updNew.rows[0],
      replacementMessage: msg,
      whatsappUrl
    });
  })
);

admin.post(
  '/accounts/:id/close-warranty',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const r = await pool.query('UPDATE accounts SET warranty_claim = FALSE WHERE id = $1 RETURNING id', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Compte introuvable.');
    res.json({ ok: true });
  })
);

admin.post(
  '/orders/:id/unassign-account/:accountId',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const accountId = Number(req.params.accountId) || 0;
    const r = await pool.query(
      `UPDATE accounts SET status = 'available', order_id = NULL, assigned_at = NULL
       WHERE id = $1 AND order_id = $2 RETURNING id`,
      [accountId, orderId]
    );
    if (!r.rowCount) throw new HttpError(404, 'Ce compte n\'est pas lié à cette commande.');
    res.json({ ok: true });
  })
);

// ----- Clients (Annuaire & Historique unifié) -----
admin.get(
  '/clients',
  wrap(async (req, res) => {
    const q = str(req.query.search, 80).toLowerCase();
    let sql = `
      WITH unified_clients AS (
        SELECT
          c.id AS client_id,
          c.name,
          c.phone,
          c.notes,
          c.airtable_id,
          c.created_at,
          COALESCE(NULLIF(regexp_replace(c.phone, '[^0-9]', '', 'g'), ''), lower(c.name)) AS match_key
        FROM clients c
        UNION
        SELECT
          NULL AS client_id,
          trim(concat(o.customer_name, ' ', o.customer_last_name)) AS name,
          o.customer_phone AS phone,
          '' AS notes,
          NULL AS airtable_id,
          min(o.created_at) AS created_at,
          COALESCE(NULLIF(regexp_replace(o.customer_phone, '[^0-9]', '', 'g'), ''), lower(concat(o.customer_name, ' ', o.customer_last_name))) AS match_key
        FROM orders o
        WHERE o.customer_name != '' OR o.customer_phone != ''
        GROUP BY match_key, o.customer_name, o.customer_last_name, o.customer_phone
      ),
      dedup AS (
        SELECT
          max(client_id) AS id,
          max(name) AS name,
          max(phone) AS phone,
          max(notes) AS notes,
          max(airtable_id) AS airtable_id,
          min(created_at) AS created_at,
          match_key
        FROM unified_clients
        WHERE match_key IS NOT NULL AND match_key != ''
        GROUP BY match_key
      )
      SELECT
        d.*,
        count(o.id)::int AS orders_count,
        COALESCE(sum(o.total) FILTER (WHERE o.status = 'confirmed'), 0)::float AS total_spent,
        max(o.created_at) AS last_order_at
      FROM dedup d
      LEFT JOIN orders o ON
        (NULLIF(d.phone, '') IS NOT NULL AND o.customer_phone = d.phone)
        OR (lower(d.name) = lower(trim(concat(o.customer_name, ' ', o.customer_last_name))))
    `;
    const params = [];
    if (q) {
      sql += ` WHERE (lower(d.name) LIKE $1 OR lower(d.phone) LIKE $1 OR lower(d.notes) LIKE $1)`;
      params.push('%' + q + '%');
    }
    sql += ` GROUP BY d.id, d.name, d.phone, d.notes, d.airtable_id, d.created_at, d.match_key
             ORDER BY total_spent DESC, last_order_at DESC NULLS LAST LIMIT 300`;

    const { rows } = await pool.query(sql, params);
    res.json({ clients: rows });
  })
);

admin.post(
  '/clients',
  wrap(async (req, res) => {
    const name = str(req.body.name, 100);
    const phone = str(req.body.phone, 40);
    const notes = str(req.body.notes, 500);
    if (!name && !phone) throw new HttpError(400, 'Nom ou numéro de téléphone requis.');
    const r = await pool.query(
      `INSERT INTO clients (name, phone, notes) VALUES ($1, $2, $3) RETURNING *`,
      [name, phone, notes]
    );
    res.status(201).json(r.rows[0]);
  })
);

admin.patch(
  '/clients/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const out = {};
    if (req.body.name !== undefined) out.name = str(req.body.name, 100);
    if (req.body.phone !== undefined) out.phone = str(req.body.phone, 40);
    if (req.body.notes !== undefined) out.notes = str(req.body.notes, 500);
    const cols = Object.keys(out);
    if (!cols.length) throw new HttpError(400, 'Rien à modifier.');
    const sets = cols.map((c, i) => c + ' = $' + (i + 1)).join(', ');
    const r = await pool.query(
      'UPDATE clients SET ' + sets + ' WHERE id = $' + (cols.length + 1) + ' RETURNING *',
      [...cols.map((c) => out[c]), id]
    );
    if (!r.rowCount) throw new HttpError(404, 'Client introuvable.');
    res.json(r.rows[0]);
  })
);

admin.delete(
  '/clients/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    await pool.query('DELETE FROM clients WHERE id = $1', [id]);
    res.status(204).end();
  })
);

admin.get(
  '/clients/:key',
  wrap(async (req, res) => {
    const rawKey = req.params.key.trim();
    const cleanPhone = rawKey.replace(/[^0-9]/g, '');

    // 1. Profil client
    let client = null;
    if (cleanPhone) {
      const cr = await pool.query(
        `SELECT * FROM clients WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 LIMIT 1`,
        [cleanPhone]
      );
      if (cr.rowCount) client = cr.rows[0];
    }
    if (!client) {
      const cr = await pool.query(
        `SELECT * FROM clients WHERE lower(name) = lower($1) OR id = $2::int LIMIT 1`,
        [rawKey, Number.isInteger(Number(rawKey)) ? Number(rawKey) : 0]
      );
      if (cr.rowCount) client = cr.rows[0];
    }

    // 2. Commandes du client
    const ordersRes = await pool.query(
      `SELECT * FROM orders
       WHERE (NULLIF($1, '') IS NOT NULL AND regexp_replace(customer_phone, '[^0-9]', '', 'g') = $1)
          OR (NULLIF($2, '') IS NOT NULL AND lower(trim(concat(customer_name, ' ', customer_last_name))) = lower($2))
       ORDER BY created_at DESC`,
      [cleanPhone, client ? client.name : rawKey]
    );
    const orders = ordersRes.rows;
    const orderIds = orders.map((o) => o.id);

    // 3. Accès / comptes attribués
    let accounts = [];
    if (orderIds.length) {
      const accRes = await pool.query(
        `SELECT a.*, o.name AS offer_name
         FROM accounts a
         JOIN offers o ON o.id = a.offer_id
         WHERE a.order_id = ANY($1)
         ORDER BY a.assigned_at DESC NULLS LAST, a.id DESC`,
        [orderIds]
      );
      accounts = accRes.rows;
    }

    const firstOrder = orders[0] || {};
    const defaultName = [firstOrder.customer_name, firstOrder.customer_last_name].filter(Boolean).join(' ') || rawKey;
    const defaultPhone = firstOrder.customer_phone || (cleanPhone ? '+' + cleanPhone : '');

    res.json({
      client: client || {
        id: null,
        name: defaultName,
        phone: defaultPhone,
        notes: ''
      },
      orders,
      accounts
    });
  })
);

// ----- Import & Synchronisation Airtable (SubManager) -----
admin.post(
  '/sync-airtable',
  wrap(async (req, res) => {
    const baseId = str(req.body.baseId, 60) || process.env.AIRTABLE_BASE_ID || '';
    const token = str(req.body.token, 200) || process.env.AIRTABLE_TOKEN || '';
    if (!baseId || !token) {
      throw new HttpError(400, "Identifiants Airtable manquants (AIRTABLE_BASE_ID / AIRTABLE_TOKEN non configurés).");
    }

    async function fetchAirtable(table) {
      let records = [];
      let offset = null;
      do {
        const u = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}` + (offset ? `?offset=${offset}` : '');
        const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new HttpError(r.status, `Erreur Airtable (${table}) : ` + (err.error?.message || r.statusText));
        }
        const data = await r.json();
        if (data.records) records.push(...data.records);
        offset = data.offset;
      } while (offset);
      return records;
    }

    const [achats, clientsAirtable, produitsAirtable, ventesAirtable] = await Promise.all([
      fetchAirtable('Achats / Fournisseurs'),
      fetchAirtable('Clients'),
      fetchAirtable('Services / Produits').catch(() => []),
      fetchAirtable('Ventes').catch(() => [])
    ]);

    // Map Airtable product recordId -> Name
    const airtableProdMap = {};
    produitsAirtable.forEach((p) => {
      airtableProdMap[p.id] = p.fields['Nom du Service'] || p.fields['Nom'] || 'Service';
    });

    // 1. Sync / match existing offers in DB
    const existingOffersRes = await pool.query('SELECT id, name, slug, is_pack FROM offers');
    const existingOffers = existingOffersRes.rows;

    function findOrCreateOffer(serviceName) {
      const clean = (serviceName || '').trim().toLowerCase();
      const match = existingOffers.find((o) => {
        if (o.is_pack) return false; // Ne jamais associer du stock fournisseur à un pack commercial
        const oName = o.name.toLowerCase();
        return oName === clean || oName.includes(clean) || clean.includes(oName);
      });
      return match || null;
    }

    // For any Airtable product without match, create an offer in offers
    for (const [prodId, prodName] of Object.entries(airtableProdMap)) {
      if (prodName && !prodName.startsWith('rec') && !findOrCreateOffer(prodName)) {
        const slug = prodName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service-' + Date.now();
        const ins = await pool.query(
          `INSERT INTO offers (slug, name, category, tag, price, description, features, hue, is_pack, active, sort)
           VALUES ($1, $2, 'streaming', 'Import', 35, 'Importé depuis SubManager', '[]'::jsonb, 200, FALSE, TRUE, 150)
           RETURNING id, name, slug, is_pack`,
          [slug, prodName]
        );
        existingOffers.push(ins.rows[0]);
      }
    }

    const defaultOffer = existingOffers.find((o) => !o.is_pack) || existingOffers[0];

    function parseCreds(notes) {
      if (!notes) return { login: 'Compte', password: '' };
      const strVal = String(notes).trim();
      const firstLine = strVal.split('\n')[0].trim();
      const part = firstLine.split('|')[0].trim();
      if (part.includes(':') && !part.startsWith('http')) {
        const idx = part.indexOf(':');
        const login = part.slice(0, idx).trim();
        const pass = part.slice(idx + 1).split(/\s+/)[0].trim();
        return { login: login || 'Compte', password: pass };
      }
      return { login: part || strVal.slice(0, 100) || 'Compte', password: '' };
    }

    // 2. Import / Sync Achats into accounts
    let importedStocks = 0;
    for (const a of achats) {
      const f = a.fields;
      const rawProd = f['Produit acheté'] || f['Produit'] || '';
      const prodName = Array.isArray(rawProd) ? (airtableProdMap[rawProd[0]] || 'Service') : (rawProd || 'Service');
      const offer = findOrCreateOffer(prodName) || defaultOffer;

      const rawNotes = f['Notes / Identifiants fournisseur'] || f['Notes'] || '';
      const creds = parseCreds(rawNotes);
      const supplier = str(f['Fournisseur / Plateforme'] || f['Fournisseur'] || '', 120);
      const supplierUrl = str(f['Lien du site (URL)'] || f['URL'] || '', 255);
      const cost = Math.max(0, parseFloat(f["Prix d'Achat Unitaire (€)"] || f["Prix d'Achat"] || '0') || 0);
      const rawStatus = String(f['Statut du Stock'] || f['Statut'] || '').toLowerCase();
      const status = rawStatus.includes('disponible') ? 'available' : 'assigned';

      await pool.query(
        `INSERT INTO accounts (offer_id, service_name, login, password, notes, supplier, supplier_url, cost, status, airtable_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (airtable_id) DO UPDATE SET
           offer_id = EXCLUDED.offer_id,
           service_name = EXCLUDED.service_name,
           login = EXCLUDED.login,
           password = CASE WHEN EXCLUDED.password != '' THEN EXCLUDED.password ELSE accounts.password END,
           notes = EXCLUDED.notes,
           supplier = EXCLUDED.supplier,
           supplier_url = EXCLUDED.supplier_url,
           cost = EXCLUDED.cost,
           status = EXCLUDED.status`,
        [offer.id, offer.name, creds.login, creds.password, rawNotes, supplier, supplierUrl, cost, status, a.id]
      );
      importedStocks++;
    }

    // 3. Import / Sync Clients into clients
    let importedClients = 0;
    const clientMapByAirtableId = {};
    for (const c of clientsAirtable) {
      const f = c.fields;
      const name = str(f['Nom & Prénom'] || f['Nom Client'] || f['Nom'] || 'Client', 100);
      const rawPhone = String(f['Numéro WhatsApp / Téléphone'] || f['Téléphone'] || f['WhatsApp'] || '').trim();
      const phone = str(rawPhone.replace(/[\u202A\u202C\s]/g, ''), 40);

      const ins = await pool.query(
        `INSERT INTO clients (name, phone, airtable_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (airtable_id) DO UPDATE SET
           name = EXCLUDED.name,
           phone = EXCLUDED.phone
         RETURNING id, name, phone`,
        [name, phone, c.id]
      );
      clientMapByAirtableId[c.id] = ins.rows[0];
      importedClients++;
    }

    // 4. Link Ventes to accounts and orders
    let linkedSales = 0;
    for (const v of ventesAirtable) {
      const f = v.fields;
      const linkedPurchases = f['Achats / Fournisseurs'];
      const linkedClients = f['Clients'];
      if (!Array.isArray(linkedPurchases) || !linkedPurchases.length) continue;
      const purchaseAirtableId = linkedPurchases[0];

      const accRes = await pool.query('SELECT id, offer_id, service_name FROM accounts WHERE airtable_id = $1', [purchaseAirtableId]);
      if (!accRes.rowCount) continue;
      const acc = accRes.rows[0];

      let clientInfo = { name: 'Client SubManager', phone: '' };
      if (Array.isArray(linkedClients) && linkedClients.length && clientMapByAirtableId[linkedClients[0]]) {
        clientInfo = clientMapByAirtableId[linkedClients[0]];
      }

      const saleDate = f['Date & Heure de vente'] ? new Date(f['Date & Heure de vente']) : new Date();
      const expiresAt = new Date(saleDate.getTime() + 365 * 24 * 3600 * 1000);

      const checkOrd = await pool.query('SELECT id FROM accounts WHERE id = $1 AND order_id IS NOT NULL', [acc.id]);
      if (!checkOrd.rowCount) {
        const ordRes = await pool.query(
          `INSERT INTO orders (customer_name, customer_phone, items, total, status, source, created_at, expires_at)
           VALUES ($1, $2, $3, $4, 'confirmed', 'airtable', $5, $6)
           RETURNING id`,
          [clientInfo.name, clientInfo.phone, JSON.stringify([{ id: acc.offer_id, name: acc.service_name, price: 35 }]), 35, saleDate, expiresAt]
        );
        const newOrderId = ordRes.rows[0].id;
        await pool.query('UPDATE accounts SET order_id = $1, status = $2, assigned_at = $3 WHERE id = $4', [
          newOrderId,
          'assigned',
          saleDate,
          acc.id
        ]);
        linkedSales++;
      }
    }

    await audit(req, 'sync.airtable', { importedStocks, importedClients, linkedSales });

    res.json({
      ok: true,
      importedStocks,
      importedClients,
      linkedSales,
      message: `${importedStocks} stocks, ${importedClients} clients et ${linkedSales} ventes synchronisés depuis SubManager !`
    });
  })
);

admin.get('/notify', (req, res) => res.json(notifyChannels()));

admin.post(
  '/notify/test',
  rateLimit(5, 60 * 1000),
  wrap(async (req, res) => {
    const ch = notifyChannels();
    if (!ch.telegram && !ch.discord) throw new HttpError(400, 'Aucun canal configuré dans le fichier .env.');
    const r = await notify('✅ Test NeonPass : les notifications fonctionnent.');
    if (r.errors.length) throw new HttpError(502, 'Échec : ' + r.errors.join(' | '));
    res.json({ ok: true, sent: r.sent });
  })
);

admin.get(
  '/settings',
  wrap(async (req, res) => {
    const settings = await getSettings();
    const stockRes = await pool.query(`
      SELECT o.id, o.name, o.category, o.low_stock_threshold,
             count(*) FILTER (WHERE a.status = 'available')::int AS available_count
      FROM offers o
      LEFT JOIN accounts a ON a.offer_id = o.id
      WHERE o.active AND NOT o.is_pack
      GROUP BY o.id, o.name, o.category, o.low_stock_threshold, o.sort
      ORDER BY o.sort ASC, o.id ASC
    `);
    res.json({
      ...settings,
      stockThresholds: stockRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        threshold: r.low_stock_threshold == null ? 2 : Number(r.low_stock_threshold),
        available: Number(r.available_count || 0)
      }))
    });
  })
);

admin.put(
  '/settings',
  wrap(async (req, res) => {
    const pct = clampInt(req.body.discountPct, 0, 90, 10);
    const min = clampInt(req.body.discountMin, 2, 10, 3);
    const stockAlertsEnabled = req.body.stockAlertsEnabled !== false && req.body.stockAlertsEnabled !== 'false';

    await pool.query(
      `INSERT INTO settings (key, value) VALUES
         ('discount_pct', $1),
         ('discount_min', $2),
         ('stock_alerts_enabled', $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(pct), String(min), String(stockAlertsEnabled)]
    );

    if (req.body.thresholds && typeof req.body.thresholds === 'object') {
      for (const [idStr, val] of Object.entries(req.body.thresholds)) {
        const id = Number(idStr);
        const thresh = Math.max(0, Math.min(999, parseInt(val, 10) || 0));
        if (id) {
          await pool.query('UPDATE offers SET low_stock_threshold = $1 WHERE id = $2', [thresh, id]);
        }
      }
    }

    res.json({ ok: true, discountPct: pct, discountMin: min, stockAlertsEnabled });
  })
);

admin.put(
  '/settings/stock-thresholds',
  wrap(async (req, res) => {
    const stockAlertsEnabled = req.body.stockAlertsEnabled !== false && req.body.stockAlertsEnabled !== 'false';
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('stock_alerts_enabled', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(stockAlertsEnabled)]
    );

    if (req.body.thresholds && typeof req.body.thresholds === 'object') {
      for (const [idStr, val] of Object.entries(req.body.thresholds)) {
        const id = Number(idStr);
        const thresh = Math.max(0, Math.min(999, parseInt(val, 10) || 0));
        if (id) {
          await pool.query('UPDATE offers SET low_stock_threshold = $1 WHERE id = $2', [thresh, id]);
        }
      }
    }

    res.json({ ok: true, stockAlertsEnabled });
  })
);

app.use('/api/admin', admin);

// ----- Fichiers statiques et erreurs -----
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable.' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

// ---------- Démarrage ----------
async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  for (let i = 1; i <= 30; i++) {
    try {
      await pool.query(sql);
      console.log('[db] schéma prêt');
      return;
    } catch (e) {
      console.log('[db] pas encore prête (' + i + '/30) : ' + e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Base de données inaccessible.');
}

// ---------- Tâches planifiées (dans l'application, toutes les 15 min) ----------
function parisNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return { weekday: parts.weekday, hour: Number(parts.hour), date: parts.year + '-' + parts.month + '-' + parts.day };
}

// Résumé des échéances chaque lundi à partir de 9 h (heure de Paris)
async function renewalsDigestJob() {
  const now = parisNow();
  if (now.weekday !== 'Mon' || now.hour < 9) return;
  if ((await getSetting('renewals_digest_sent')) === now.date) return;
  await putSetting('renewals_digest_sent', now.date);
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE expires_at BETWEEN now() AND now() + interval '7 days')::int AS week,
            count(*) FILTER (WHERE expires_at BETWEEN now() AND now() + interval '30 days')::int AS month,
            count(*) FILTER (WHERE expires_at < now() AND expires_at >= now() - interval '30 days'
                             AND reminder_sent_at IS NULL)::int AS expired
     FROM orders WHERE status = 'confirmed'`
  );
  const c = rows[0];
  notifyLater(
    '📅 Échéances NeonPass\n' +
    '• ' + c.week + ' cette semaine\n' +
    '• ' + c.month + ' dans les 30 jours\n' +
    (c.expired ? '• ' + c.expired + ' expirée(s) sans relance\n' : '') +
    SITE_URL + '/admin'
  );
}

const JOBS = [renewalsDigestJob];
async function runJobs() {
  for (const job of JOBS) {
    try { await job(); } catch (e) { console.error('[job] ' + job.name + ' : ' + e.message); }
  }
}

initDb()
  .then(() => {
    const server = app.listen(PORT, () => console.log('[http] NeonPass écoute sur le port ' + PORT));
    setTimeout(runJobs, 60 * 1000).unref();
    setInterval(runJobs, 15 * 60 * 1000).unref();
    const stop = () => {
      server.close(() => pool.end().then(() => process.exit(0)));
      setTimeout(() => process.exit(0), 8000).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
