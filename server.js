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
const CATEGORIES = ['packs', 'streaming', 'vpn', 'musique', 'tv'];
const STATUSES = ['new', 'confirmed', 'cancelled'];
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
    discountMin: clampInt(m.discount_min, 2, 10, 3)
  };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const user = i >= 0 ? decoded.slice(0, i) : decoded;
    const pass = i >= 0 ? decoded.slice(i + 1) : '';
    const okUser = safeEqual(user, ADMIN_USER);
    const okPass = safeEqual(pass, ADMIN_PASSWORD);
    if (okUser && okPass) return next();
  }
  setTimeout(() => {
    res.set('WWW-Authenticate', 'Basic realm="NeonPass admin", charset="UTF-8"');
    res.status(401).send('Authentification requise');
  }, 400);
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
                                       WHERE o.active ORDER BY o.sort, o.id`);
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
    const name = str(req.body.name, 60);
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
        `INSERT INTO orders (customer_name, items, total, discount, promo_code, promo_pct)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [name, JSON.stringify(items), total, discount, promo ? promo.code : null, promo ? promo.pct : null]
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
      (affiliation ? ' Affiliation : ' + affiliation + '.' : '');

    notifyLater(
      '🛒 Nouvelle commande #' + orderId + '\n' +
      items.map((i) => '• ' + i.name + ' — ' + money(i.price)).join('\n') + '\n' +
      'Total : ' + money(total) + '/an' +
      (discount ? ' · remise pack −' + settings.discountPct + ' %' : '') +
      (promo ? ' · code ' + promo.code + ' −' + promo.pct + ' %' : '') +
      (name ? '\nPrénom : ' + name : '') +
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

// ----- Administration -----
app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

const admin = express.Router();
admin.use(adminAuth);

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
      `SELECT id, customer_name, items, total::float AS total, discount, promo_code, promo_pct, status, created_at
       FROM orders WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 500`,
      [status]
    );
    res.json(rows);
  })
);

admin.patch(
  '/orders/:id',
  wrap(async (req, res) => {
    const status = str(req.body.status, 20);
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Statut invalide.');
    const r = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id', [status, Number(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Commande introuvable.');
    res.json({ ok: true });
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

const OFFER_COLS = 'slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort';
function offerValues(o) {
  return [o.slug, o.name, o.category, o.tag, o.price, o.was, o.description, JSON.stringify(o.features), o.hue, o.isPack, o.active, o.sort];
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
        `INSERT INTO offers (${OFFER_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
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
                features=$8, hue=$9, is_pack=$10, active=$11, sort=$12 WHERE id=$13 RETURNING *`,
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
    res.json(await getSettings());
  })
);

admin.put(
  '/settings',
  wrap(async (req, res) => {
    const pct = clampInt(req.body.discountPct, 0, 90, 10);
    const min = clampInt(req.body.discountMin, 2, 10, 3);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('discount_pct', $1), ('discount_min', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(pct), String(min)]
    );
    res.json({ discountPct: pct, discountMin: min });
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

initDb()
  .then(() => {
    const server = app.listen(PORT, () => console.log('[http] NeonPass écoute sur le port ' + PORT));
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
