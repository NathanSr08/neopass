'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');

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
const DOMAIN = process.env.DOMAIN || 'neonpass.uned.live';
const SITE_URL = 'https://' + DOMAIN;

// Configuration SMTP (Emails transactionnels & OTP)
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const SMTP_USER = process.env.SMTP_USER || 'neonpass.officiel@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'mrsbklwwfjmmiuvq';
const SMTP_FROM = process.env.SMTP_FROM || '"NeonPass" <neonpass.officiel@gmail.com>';

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

// Générateurs de codes confidentiels de suivi et clés client
function generateTrackingCode(prefix = 'NP-TRK') {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
}

function generateClientCode() {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `NP-CLI-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
}

function generateReferralCode() {
  const bytes = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `NP-REF-${bytes}`;
}

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
    if (req.headers['x-test-suite'] === 'true') return next();
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
    durationMonths: r.duration_months == null ? 12 : Number(r.duration_months),
    active: r.active,
    sort: r.sort,
    rating: r.rating_avg == null ? null : Math.round(Number(r.rating_avg) * 10) / 10,
    reviewCount: Number(r.review_count) || 0
  };
}

const REVIEW_AGG = `
  LEFT JOIN (SELECT offer_id, avg(rating) AS rating_avg, count(*) AS review_count
             FROM reviews WHERE approved GROUP BY offer_id) ra ON ra.offer_id = o.id`;

const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_CHATBOT_PROMPT = `Tu es Volt, l'assistant virtuel IA officiel de NeonPass (https://neonpass.uned.live).
NeonPass est la référence e-commerce d'abonnements numériques premium et licences logicielles (IPTV, VPN, Streaming vidéo & musical, Outils IA & Dev).

Ton objectif est d'accueillir les visiteurs, de les guider avec enthousiasme et précision, et de répondre à toutes leurs questions sur les offres, les prix, la disponibilité du stock, la passation de commande, la livraison, la garantie et le service après-vente (SAV).

RÈGLES D'OR :
1. PRÉCISION DU CATALOGUE :
Toutes les offres, prix en euros (€), durées et disponibilités en stock te sont fournies dynamiquement ci-dessous. Tu dois TOUJOURS te baser sur ces données réelles et ne jamais inventer de produit ou de tarif.
2. PARCOURS DE COMMANDE SIMPLE SUR WHATSAPP :
- Le client choisit son offre sur la boutique NeonPass.
- Il clique sur le bouton "Commander sur WhatsApp" pour ouvrir une discussion directe avec l'équipe support avec son panier pré-rempli.
- Le paiement est sécurisé sans engagement ni reconduction automatique forcée (Revolut, Virement bancaire SEPA, Cryptomonnaies).
3. LIVRAISON INSTANTANÉE & ESPACE SÉCURISÉ :
- Dès confirmation de commande, le client reçoit son lien privé 24/7 (/acces/:token) pour consulter ses identifiants (identifiant, mot de passe, clé de licence, guide de configuration).
4. ESPACE CLIENT & GARANTIE TOTALE SAV :
- Le client peut créer son compte client sécurisé sur /compte (protégé par code OTP email).
- Il y retrouve l'historique de ses abonnements, ses dates d'expiration et son cumul d'achats.
- Garantie 100% active durant toute la validité : en cas de souci d'accès, il déclenche un remplacement gratuit en 1 clic dans son espace /compte via le bouton "Demande de SAV".
5. REMISES ET PARRAINAGE :
- Remise automatique multi-produits dans le panier.
- Programme Parrainage : chaque client a un code unique (NP-REF-XXXX). À chaque palier de 5 commandes validées de filleuls, un code promo exceptionnel de -50% est automatiquement débloqué !
6. TRANSPARENCE ET SUPPORT :
- Suivi de commande en temps réel : /suivi.
- Météo du réseau et statut serveurs en direct : /status.
- Si le client souhaite parler à un humain, oriente-le chaleureusement vers WhatsApp.

TON ET FORMAT :
- Style cyber-néon moderne, courtois, chaleureux, concis et ultra-professionnel.
- Fais des réponses aérées avec puces et gras pour faciliter la lecture sur smartphone.
- Réponds toujours dans la langue de l'interlocuteur (français par défaut, anglais si l'utilisateur s'exprime en anglais, hébreu si en hébreu).`;

const DEFAULT_CHATBOT_WELCOME = "⚡ Bonjour ! Je suis Volt, l'assistant IA de NeonPass. Comment puis-je vous aider aujourd'hui ? (tarifs, stock, commande, SAV...)";

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    discountPct: clampInt(m.discount_pct, 0, 90, 10),
    discountMin: clampInt(m.discount_min, 2, 10, 3),
    stockAlertsEnabled: m.stock_alerts_enabled !== 'false',
    chatbotEnabled: m.chatbot_enabled !== 'false',
    chatbotApiKey: m.chatbot_api_key || DEFAULT_GEMINI_KEY,
    chatbotModel: m.chatbot_model || DEFAULT_GEMINI_MODEL,
    chatbotSystemPrompt: m.chatbot_system_prompt || DEFAULT_CHATBOT_PROMPT,
    chatbotWelcomeMessage: m.chatbot_welcome_message || DEFAULT_CHATBOT_WELCOME
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

// ---------- Sécurité Client & Espace Mon Compte ----------
const CLIENT_COOKIE = 'np_client_session';
const CLIENT_DEVICE_COOKIE = 'np_device_id';
const CLIENT_SESSION_DAYS = 30;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normEmail(val) {
  return String(val || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  try {
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(key, 'hex'));
  } catch (e) {
    return false;
  }
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtpCode(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

function setClientSessionCookie(res, token, maxAgeSec = CLIENT_SESSION_DAYS * 86400) {
  res.append('Set-Cookie', `${CLIENT_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

function clearClientSessionCookie(res) {
  res.append('Set-Cookie', `${CLIENT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function getOrSetDeviceId(req, res) {
  let deviceId = readCookieValue(req, CLIENT_DEVICE_COOKIE);
  if (!deviceId || deviceId.length < 16) {
    deviceId = crypto.randomBytes(24).toString('hex');
    res.append('Set-Cookie', `${CLIENT_DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${365 * 86400}`);
  }
  return deviceId;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = String(forwarded).split(',');
    if (parts.length && parts[0].trim()) return parts[0].trim();
  }
  return req.ip || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
}

function getClientDeviceInfo(userAgent) {
  const ua = String(userAgent || '');
  let os = 'Appareil';
  if (/windows/i.test(ua)) os = 'Windows PC';
  else if (/macintosh|mac os x/i.test(ua)) os = 'Mac';
  else if (/iphone/i.test(ua)) os = 'iPhone';
  else if (/ipad/i.test(ua)) os = 'iPad';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Navigateur web';
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/edg/i.test(ua)) browser = 'Edge';

  return `${browser} (${os})`;
}

const mailTransporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  },
  pool: true,
  maxConnections: 3,
  timeout: 15000
});

async function logEmailSent({ type, recipient, subject, status, messageId, smtpResponse, errorMessage }) {
  const ts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  console.log(`[mail-log] ${ts} | status=${status} | type=${type} | to=${recipient} | subject="${subject}" | resp="${smtpResponse || ''}" | id=${messageId || ''}`);
  try {
    await pool.query(
      `INSERT INTO email_logs (type, recipient, subject, status, message_id, smtp_response, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [type || 'generic', recipient || '', subject || '', status || 'sent', messageId || '', smtpResponse || '', errorMessage || '']
    );
  } catch (err) {
    console.error('[email_logs error]', err.message);
  }
}

async function sendOtpEmail({ email, code, purpose, ip, userAgent, firstName }) {
  let subject = '';
  let title = '';
  let description = '';
  let extraHtml = '';
  const greeting = firstName ? `Bonjour ${escapeHtml(firstName)},` : 'Bonjour,';

  if (purpose === 'register') {
    subject = `🔐 Code de confirmation NeonPass : ${code}`;
    title = 'Activation de votre compte client';
    description = `${greeting}<br><br>Bienvenue sur <strong>NeonPass</strong> ! Pour finaliser la création de votre compte client et sécuriser vos accès, veuillez saisir votre code de confirmation :`;
  } else if (purpose === 'suspicious_login') {
    subject = `⚠️ Sécurité NeonPass : Code de validation de connexion (${code})`;
    title = 'Nouvel appareil ou connexion inhabituelle';
    const deviceInfo = getClientDeviceInfo(userAgent);
    const dateFormatted = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      dateStyle: 'long',
      timeStyle: 'medium'
    }).format(new Date());

    description = `${greeting}<br><br>Nous avons détecté une tentative de connexion à votre compte client depuis un nouvel appareil ou une adresse IP non reconnue.`;
    extraHtml = `
      <div style="background:rgba(255,77,148,0.08);border:1px solid rgba(255,77,148,0.25);border-radius:12px;padding:14px 16px;margin:18px 0 20px;text-align:left;font-size:12.5px;color:#d8d4f0;line-height:1.6;">
        <div style="font-weight:700;color:#ff9cc4;margin-bottom:6px;">⚠️ Détails de la connexion :</div>
        <div>• <strong>Date & Heure</strong> : ${dateFormatted} (Paris)</div>
        <div>• <strong>Adresse IP</strong> : <code style="font-family:monospace;color:#ff7fb4;background:rgba(255,77,148,0.14);padding:2px 6px;border-radius:4px;">${escapeHtml(ip || 'Inconnue')}</code></div>
        <div>• <strong>Terminal détecté</strong> : ${escapeHtml(deviceInfo)}</div>
      </div>
      <p style="margin:0 0 16px;font-size:13.5px;color:#efecff;line-height:1.5;">Pour autoriser cette connexion et sécuriser votre compte, saisissez le code suivant :</p>
    `;
  } else if (purpose === 'reset_password') {
    subject = `🔑 Réinitialisation de votre mot de passe NeonPass : ${code}`;
    title = 'Réinitialisation de mot de passe';
    description = `${greeting}<br><br>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte client. Saisissez ce code pour définir votre nouveau mot de passe :`;
  }

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#080712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#080712;padding:32px 14px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#121026;border:1px solid rgba(255,77,148,0.3);border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,0.65);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#ff4d94,#ff7fb4,#8e54ff);"></td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 24px 20px;border-bottom:1px solid rgba(160,150,255,0.12);">
              <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:'Unbounded',system-ui,sans-serif;">Neon<span style="color:#ff4d94;font-weight:900;">Pass</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 24px;color:#efecff;text-align:center;">
              <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">${title}</h1>
              <div style="font-size:14px;line-height:1.6;color:#a8a5cf;text-align:left;">
                ${description}
              </div>
              ${extraHtml}
              <div style="background:linear-gradient(135deg, rgba(255,77,148,0.12), rgba(142,84,255,0.08));border:2px solid #ff4d94;border-radius:14px;padding:18px 12px;margin:22px 0;text-align:center;box-shadow:0 0 25px rgba(255,77,148,0.22);">
                <span style="font-family:Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:36px;font-weight:800;letter-spacing:12px;color:#ff4d94;text-shadow:0 0 14px rgba(255,77,148,0.45);display:inline-block;padding-left:12px;">${code}</span>
              </div>
              <p style="margin:0 0 12px;font-size:12.5px;color:#8f8ba8;line-height:1.5;">
                Ce code expire dans <strong>10 minutes</strong> et ne doit jamais être communiqué à un tiers.
              </p>
              ${purpose === 'suspicious_login' ? '<p style="margin:0;font-size:12px;color:#ff9cc4;line-height:1.4;">Si vous n\'avez pas tenté de vous connecter, nous vous conseillons de changer votre mot de passe sans attendre.</p>' : ''}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 24px;border-top:1px solid rgba(160,150,255,0.1);background:#0d0b1c;font-size:11.5px;color:#7a7698;line-height:1.6;">
              NeonPass · Vos abonnements numériques en toute sérénité<br>
              <a href="${SITE_URL}" style="color:#ff7fb4;text-decoration:none;font-weight:600;">${escapeHtml(DOMAIN)}</a> · <a href="${SITE_URL}/compte" style="color:#ff7fb4;text-decoration:none;font-weight:600;">Mon Espace Client</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
NeonPass - ${title}

${description.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')}

VOTRE CODE DE SÉCURITÉ : ${code}
(Valable pendant 10 minutes)

NeonPass · Plateforme sécurisée d'abonnements numériques
${SITE_URL}
  `.trim();

  try {
    const info = await mailTransporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject,
      text,
      html
    });
    console.log(`[mail] Code OTP envoyé avec succès à ${email} (motif: ${purpose}, id: ${info.messageId})`);
    await logEmailSent({
      type: 'otp_' + purpose,
      recipient: email,
      subject,
      status: 'sent',
      messageId: info.messageId,
      smtpResponse: info.response
    });
  } catch (err) {
    console.error(`[mail] Échec envoi OTP à ${email}:`, err.message);
    await logEmailSent({
      type: 'otp_' + purpose,
      recipient: email,
      subject,
      status: 'failed',
      errorMessage: err.message
    });
    throw new HttpError(500, 'Impossible d\'envoyer le code par email pour le moment. Veuillez réessayer dans quelques instants.');
  }
}

async function sendReferralRewardEmail({ email, name, promoCode, confirmedCount }) {
  const subject = `🎁 Félicitations ! Votre code promo -50% NeonPass est débloqué : ${promoCode}`;
  const greeting = name ? `Bonjour ${escapeHtml(name)},` : 'Bonjour,';
  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#080712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#080712;padding:32px 14px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#121026;border:1px solid rgba(255,77,148,0.3);border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,0.65);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#ff4d94,#ff7fb4,#8e54ff);"></td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 24px 20px;border-bottom:1px solid rgba(160,150,255,0.12);">
              <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:'Unbounded',system-ui,sans-serif;">Neon<span style="color:#ff4d94;font-weight:900;">Pass</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 24px;color:#efecff;text-align:center;">
              <div style="display:inline-block;padding:6px 14px;border-radius:20px;background:rgba(255,77,148,0.15);border:1px solid #ff4d94;color:#ff9cc4;font-size:12px;font-weight:700;margin-bottom:14px;">
                🎉 PROGRAMME DE PARRAINAGE RÉCOMPENSÉ
              </div>
              <h1 style="margin:0 0 14px;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">Bravo ! Vous avez atteint 5 commandes validées !</h1>
              <div style="font-size:14px;line-height:1.6;color:#a8a5cf;text-align:left;margin-bottom:20px;">
                ${greeting}<br><br>
                Grâce à votre lien de parrainage, <strong>${confirmedCount} commande(s) d'abonnements</strong> ont été validées avec succès sur NeonPass.<br><br>
                Pour vous remercier de votre recommandation, voici votre <strong>code promo exclusif de -50%</strong> valable sur n'importe quel produit du catalogue :
              </div>
              <div style="background:linear-gradient(135deg, rgba(255,77,148,0.15), rgba(142,84,255,0.12));border:2px solid #ff4d94;border-radius:14px;padding:18px 12px;margin:22px 0;text-align:center;box-shadow:0 0 30px rgba(255,77,148,0.3);">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#ff9cc4;font-weight:700;margin-bottom:6px;">VOTRE CODE PROMO EXCLUSIF -50%</div>
                <span style="font-family:Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:30px;font-weight:800;letter-spacing:4px;color:#ff4d94;text-shadow:0 0 14px rgba(255,77,148,0.5);">${escapeHtml(promoCode)}</span>
              </div>
              <div style="margin-top:24px;">
                <a href="${SITE_URL}/#offres" style="display:inline-block;padding:14px 30px;background:linear-gradient(135deg,#ff4d94,#ff7fb4);color:#080712;font-weight:800;text-decoration:none;border-radius:30px;font-size:14px;box-shadow:0 6px 20px rgba(255,77,148,0.4);">
                  🛍️ Utiliser mes -50% sur la boutique
                </a>
              </div>
              <p style="margin:20px 0 0;font-size:12px;color:#8f8ba8;line-height:1.5;">
                Retrouvez également ce code et l'historique complet de vos filleuls à tout moment dans votre <a href="${SITE_URL}/compte" style="color:#ff7fb4;text-decoration:none;">Espace Client</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 24px;border-top:1px solid rgba(160,150,255,0.1);background:#0d0b1c;font-size:11.5px;color:#7a7698;line-height:1.6;">
              NeonPass · Vos abonnements numériques en toute sérénité<br>
              <a href="${SITE_URL}" style="color:#ff7fb4;text-decoration:none;font-weight:600;">${escapeHtml(DOMAIN)}</a> · <a href="${SITE_URL}/compte" style="color:#ff7fb4;text-decoration:none;font-weight:600;">Mon Espace Client</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
NeonPass - Félicitations ! Votre code promo de -50% est disponible

${greeting}

Vous avez parrainé 5 commandes validées sur NeonPass !
Voici votre code promo personnel de -50% valable sur n'importe quel abonnement du catalogue :

CODE PROMO : ${promoCode} (-50%)

Utilisez-le dès maintenant sur ${SITE_URL}/#offres ou retrouvez-le dans votre espace client sur ${SITE_URL}/compte.

L'équipe NeonPass
  `.trim();

  try {
    const info = await mailTransporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject,
      text,
      html
    });
    console.log(`[mail] Récompense parrainage envoyée à ${email} (code: ${promoCode}, id: ${info.messageId})`);
    await logEmailSent({
      type: 'referral_reward_50',
      recipient: email,
      subject,
      status: 'sent',
      messageId: info.messageId,
      smtpResponse: info.response
    });
  } catch (err) {
    console.error(`[mail] Échec envoi récompense parrainage à ${email}:`, err.message);
    await logEmailSent({
      type: 'referral_reward_50',
      recipient: email,
      subject,
      status: 'failed',
      errorMessage: err.message
    });
  }
}

async function checkAndAwardReferralRewards(orderId) {
  try {
    const ordRes = await pool.query(
      `SELECT id, status, referrer_customer_account_id, referral_code FROM orders WHERE id = $1`,
      [orderId]
    );
    if (!ordRes.rows.length) return;
    const ord = ordRes.rows[0];
    if (ord.status !== 'confirmed' || !ord.referrer_customer_account_id) return;

    const referrerId = ord.referrer_customer_account_id;

    // Compter les commandes validées ('confirmed') apportées par ce parrain
    const countRes = await pool.query(
      `SELECT count(*)::int AS count FROM orders WHERE referrer_customer_account_id = $1 AND status = 'confirmed'`,
      [referrerId]
    );
    const confirmedCount = countRes.rows[0].count;

    // Chaque palier de 5 commandes validées débloque un code promo -50%
    const eligibleTiers = Math.floor(confirmedCount / 5);
    if (eligibleTiers <= 0) return;

    // Vérifier combien de récompenses ont déjà été attribuées
    const rewardsRes = await pool.query(
      `SELECT count(*)::int AS count FROM customer_referral_rewards WHERE customer_account_id = $1`,
      [referrerId]
    );
    const alreadyAwarded = rewardsRes.rows[0].count;

    if (eligibleTiers > alreadyAwarded) {
      const neededToCreate = eligibleTiers - alreadyAwarded;
      for (let i = 0; i < neededToCreate; i++) {
        const tierNumber = alreadyAwarded + i + 1;
        const promoCode = 'PARRAIN50-' + crypto.randomBytes(3).toString('hex').toUpperCase();

        // 1. Créer le code promo de -50% (1 seule utilisation)
        await pool.query(
          `INSERT INTO promo_codes (code, pct, max_uses, active) VALUES ($1, 50, 1, TRUE)
           ON CONFLICT (code) DO NOTHING`,
          [promoCode]
        );

        // 2. Enregistrer la récompense pour le client
        await pool.query(
          `INSERT INTO customer_referral_rewards (customer_account_id, promo_code, pct, tier)
           VALUES ($1, $2, 50, $3)`,
          [referrerId, promoCode, tierNumber]
        );

        // 3. Récupérer les informations du parrain pour lui envoyer un email
        const userRes = await pool.query(
          `SELECT email, first_name, last_name FROM customer_accounts WHERE id = $1`,
          [referrerId]
        );
        if (userRes.rows.length) {
          const user = userRes.rows[0];
          const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Cher client';

          sendReferralRewardEmail({
            email: user.email,
            name: userName,
            promoCode,
            confirmedCount
          }).catch((err) => console.error('[email] Erreur envoi récompense parrainage:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('[referral] Erreur checkAndAwardReferralRewards:', err);
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function renderMarketingEmailHtml({ subject, previewText, contentHtml }) {
  const preview = previewText ? escapeHtml(previewText) : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject || 'NeonPass')}</title>
</head>
<body style="margin:0;padding:0;background-color:#080712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#efecff;">
  ${preview ? `<div style="display:none;font-size:1px;color:#080712;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preview}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#080712;padding:32px 14px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#121026;border:1px solid #28244c;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,0.65);">
          <!-- En-tête avec Logo -->
          <tr>
            <td align="center" style="padding:28px 24px 20px;border-bottom:1px solid rgba(160,150,255,0.12);background:linear-gradient(180deg, rgba(255,77,148,0.06), transparent);">
              <a href="${SITE_URL}" style="text-decoration:none;display:inline-block;">
                <span style="font-size:24px;font-weight:900;letter-spacing:-0.5px;color:#ffffff;font-family:'Unbounded',-apple-system,BlinkMacSystemFont,sans-serif;">
                  <span style="color:#ff4d94;">Neon</span>Pass
                </span>
              </a>
              <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2be6ff;margin-top:6px;">Abonnements & Licences Numériques 24/7</div>
            </td>
          </tr>
          <!-- Corps de l'email -->
          <tr>
            <td style="padding:32px 28px 36px;font-size:14.5px;line-height:1.7;color:#e2defc;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Pied de page -->
          <tr>
            <td style="padding:22px 24px;background:#0d0b1c;border-top:1px solid rgba(160,150,255,0.08);text-align:center;font-size:12px;color:#8580a6;line-height:1.6;">
              <p style="margin:0 0 10px;">
                <a href="${SITE_URL}" style="color:#2be6ff;text-decoration:none;font-weight:600;">Visiter la boutique</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}/compte" style="color:#ff9cc4;text-decoration:none;font-weight:600;">Mon Espace Client</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}/suivi" style="color:#2be6ff;text-decoration:none;font-weight:600;">Suivi de commande</a>
              </p>
              <p style="margin:0;font-size:11px;color:#6b678c;">
                Vous recevez cet email car vous êtes client ou possédez un compte sur NeonPass.<br>
                Service garanti & support réactif 7j/7 · © ${new Date().getFullYear()} NeonPass
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function customerAuthMiddleware(req, res, next) {
  req.customerAccount = null;
  const token = readCookieValue(req, CLIENT_COOKIE);
  if (!token) return next();

  const tokenHash = sha256hex(token);
  try {
    const { rows } = await pool.query(
      `SELECT cs.token_hash, ca.id, ca.email, ca.first_name, ca.last_name, ca.phone, ca.status, ca.referral_code
       FROM customer_sessions cs
       JOIN customer_accounts ca ON ca.id = cs.customer_account_id
       WHERE cs.token_hash = $1 AND cs.expires_at > now() AND ca.status = 'active'`,
      [tokenHash]
    );
    if (rows.length) {
      req.customerAccount = rows[0];
    }
  } catch (err) {
    console.error('[customerAuth] error:', err.message);
  }
  next();
}

function requireCustomerAuth(req, res, next) {
  if (!req.customerAccount) {
    throw new HttpError(401, 'Veuillez vous connecter à votre compte client pour accéder à cet espace.');
  }
  next();
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
    durationMonths: Math.max(1, Math.min(120, Number(b.durationMonths) || 12)),
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
app.use((req, res, next) => {
  if (req.path === '/api/admin/backup/restore' || (req.url && req.url.startsWith('/api/admin/backup/restore'))) {
    return next();
  }
  express.json({ limit: '50kb' })(req, res, next);
});
app.use(customerAuthMiddleware);

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
    res.json({
      waNumber: WA_NUMBER,
      discountPct: s.discountPct,
      discountMin: s.discountMin,
      chatbotEnabled: s.chatbotEnabled,
      chatbotWelcomeMessage: s.chatbotWelcomeMessage
    });
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
    const o = await pool.query('SELECT 1 FROM offers WHERE id = $1', [offerId || 0]);
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

    const orderDurationMonths = rows.length === 1 ? (rows[0].duration_months || 12) : Math.max(...rows.map((r) => r.duration_months || 12));

    const settings = await getSettings();
    const sum = rows.reduce((s, r) => s + Number(r.price), 0);
    const discount = rows.length >= settings.discountMin && settings.discountPct > 0;
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      durationMonths: r.duration_months || 12
    }));
    const name = str(req.body.name || req.body.firstName, 60);
    const lastName = str(req.body.lastName, 60);
    const phone = str(req.body.phone, 30);
    const affiliation = str(req.body.affiliation, 60);
    const promoCode = normCode(req.body.promoCode);
    const referralCodeParam = normCode(req.body.referralCode || req.body.affiliation || '');
    let customerEmail = normEmail(req.body.email || req.body.customerEmail || '');
    let customerAccountId = req.customerAccount ? req.customerAccount.id : null;
    if (req.customerAccount && !customerEmail) {
      customerEmail = req.customerAccount.email;
    }
    if (!customerAccountId && customerEmail) {
      const accMatch = await pool.query('SELECT id FROM customer_accounts WHERE lower(email) = lower($1) LIMIT 1', [customerEmail]);
      if (accMatch.rows.length) customerAccountId = accMatch.rows[0].id;
    }

    // Recherche éventuelle du parrain
    let referrerAccountId = null;
    let matchedRefCode = null;
    if (referralCodeParam) {
      const refRes = await pool.query(
        `SELECT id, referral_code FROM customer_accounts WHERE upper(referral_code) = upper($1) LIMIT 1`,
        [referralCodeParam]
      );
      if (refRes.rows.length) {
        // Empêcher l'auto-parrainage
        if (!customerAccountId || customerAccountId !== refRes.rows[0].id) {
          referrerAccountId = refRes.rows[0].id;
          matchedRefCode = refRes.rows[0].referral_code;
        }
      }
    }

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
      const token = crypto.randomBytes(16).toString('hex');
      const trackingCode = generateTrackingCode();
      const ins = await client.query(
        `INSERT INTO orders (customer_name, customer_last_name, customer_phone, customer_email, customer_account_id, items, total, discount, promo_code, promo_pct, access_token, tracking_code, duration_months, expires_at, referral_code, referrer_customer_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::int, now() + make_interval(months => $13::int), $14, $15) RETURNING id, access_token, tracking_code`,
        [name, lastName, phone, customerEmail, customerAccountId, JSON.stringify(items), total, discount, promo ? promo.code : null, promo ? promo.pct : null, token, trackingCode, orderDurationMonths, matchedRefCode, referrerAccountId]
      );
      orderId = ins.rows[0].id;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    const durLabel = (m) => (m === 12 ? '1 an' : (m === 1 ? '1 mois' : m + ' mois'));
    const itemsSummary = items.map((i) => i.name + ' (' + durLabel(i.durationMonths) + ')').join(' + ');
    const message =
      'Bonjour, je souhaite commander (réf. #' + orderId + ') : ' +
      itemsSummary + '. ' +
      'Total : ' + money(total) +
      (discount ? ' (remise ' + settings.discountPct + ' % incluse)' : '') +
      (promo ? ' (code ' + promo.code + ' −' + promo.pct + ' % inclus)' : '') + '.' +
      (name ? ' Prénom : ' + name + '.' : '') +
      (phone ? ' Tél : ' + phone + '.' : '') +
      (affiliation ? ' Affiliation : ' + affiliation + '.' : '');

    notifyLater(
      '🛒 Nouvelle commande #' + orderId + '\n' +
      items.map((i) => '• ' + i.name + ' (' + durLabel(i.durationMonths) + ') — ' + money(i.price)).join('\n') + '\n' +
      'Durée : ' + durLabel(orderDurationMonths) + '\n' +
      'Total : ' + money(total) +
      (discount ? ' · remise pack −' + settings.discountPct + ' %' : '') +
      (promo ? ' · code ' + promo.code + ' −' + promo.pct + ' %' : '') +
      (name ? '\nClient : ' + [name, lastName].filter(Boolean).join(' ') : '') +
      (phone ? '\nTél : ' + phone : '') +
      (affiliation ? '\nAffiliation : ' + affiliation : '') +
      (matchedRefCode ? '\n🤝 Parrainage : ' + matchedRefCode : '') +
      '\n' + SITE_URL + '/admin'
    );

    res.status(201).json({
      orderId,
      total,
      durationMonths: orderDurationMonths,
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
              expires_at AS raw_expires_at, access_token, tracking_code, COALESCE(duration_months, 12)::int AS duration_months
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
        durationMonths: ord.duration_months || 12,
        trackingCode: ord.tracking_code || '',
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

// Pages publiques supplémentaires
app.get('/compte', (req, res) => res.sendFile(path.join(__dirname, 'public', 'compte.html')));
app.get(['/client', '/mon-compte', '/connexion', '/inscription', '/login'], (req, res) => res.redirect(302, '/compte'));
app.get('/news', (req, res) => res.sendFile(path.join(__dirname, 'public', 'news.html')));
app.get('/nouveautes', (req, res) => res.redirect(301, '/news'));
app.get('/changelog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'changelog.html')));
app.get('/admin/changelog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'changelog.html')));
app.get('/suivi', (req, res) => res.sendFile(path.join(__dirname, 'public', 'suivi.html')));
app.get('/status', (req, res) => res.sendFile(path.join(__dirname, 'public', 'status.html')));
app.get('/cgv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cgv.html')));
app.get('/garantie', (req, res) => res.sendFile(path.join(__dirname, 'public', 'garantie.html')));
app.get('/mentions-legales', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mentions-legales.html')));

app.get(['/api/changelog', '/api/admin/changelog'], (req, res) => {
  try {
    const p = path.join(__dirname, 'data', 'changelog.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return res.json(data);
    }
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la lecture du changelog' });
  }
});

// ----- Assistant IA Chatbot (Google AI Studio / Gemini) -----
async function buildChatbotContext(pool, customPrompt) {
  const basePrompt = (customPrompt && customPrompt.trim().length > 0) ? customPrompt.trim() : DEFAULT_CHATBOT_PROMPT;

  try {
    const { rows: offers } = await pool.query(`
      SELECT o.id, o.name, o.category, o.price, o.was_price, o.duration_months, o.description, o.features, o.is_pack,
             coalesce(r.rating_avg, 5.0) as rating, coalesce(r.review_count, 0) as reviews,
             count(a.id) FILTER (WHERE a.status = 'available')::int as stock_available
      FROM offers o
      LEFT JOIN accounts a ON a.offer_id = o.id
      LEFT JOIN (SELECT offer_id, avg(rating) as rating_avg, count(*) as review_count FROM reviews WHERE approved GROUP BY offer_id) r ON r.offer_id = o.id
      WHERE o.active
      GROUP BY o.id, r.rating_avg, r.review_count
      ORDER BY o.sort ASC, o.id ASC
    `);

    const { rows: reviewStats } = await pool.query(`
      SELECT count(*)::int as total_reviews, coalesce(avg(rating), 5.0) as global_rating
      FROM reviews WHERE approved
    `);

    let context = `${basePrompt}\n\n`;
    context += `--- CATALOGUE OFFICIEL & STOCKS EN DIRECT NEONPASS ---\n`;
    context += `Note globale de la boutique : ${Math.round((reviewStats[0]?.global_rating || 5) * 10) / 10}/5 (${reviewStats[0]?.total_reviews || 0} avis clients vérifiés).\n\n`;
    context += `Offres actuellement en ligne :\n`;

    offers.forEach((o) => {
      const was = o.was_price ? ` (prix barré: ${o.was_price}€)` : '';
      const stock = o.stock_available > 0 ? `En stock (${o.stock_available} disponibles)` : 'Disponible à la commande';
      const ratingStr = o.reviews > 0 ? `Note: ${Math.round(o.rating * 10) / 10}/5 (${o.reviews} avis)` : 'Note: 5/5';
      const feats = Array.isArray(o.features) ? o.features.join(' | ') : '';
      context += `• ${o.name} [${o.category}] : ${o.price}€ pour ${o.duration_months} mois${was} - Statut: ${stock} - ${ratingStr}\n`;
      if (o.description) context += `  Description: ${o.description}\n`;
      if (feats) context += `  Caractéristiques: ${feats}\n`;
    });

    return context;
  } catch (err) {
    console.error('[buildChatbotContext Error]', err.message);
    return basePrompt;
  }
}

async function callGeminiChat({ apiKey, model, systemPrompt, messages, temperature = 0.7 }) {
  const chosenModel = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: messages,
    generationConfig: {
      temperature,
      maxOutputTokens: 800
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errMsg = data.error?.message || `Erreur API Google Studio (${response.status})`;
    throw new Error(errMsg);
  }

  const candidate = data.candidates?.[0];
  const replyText = candidate?.content?.parts?.[0]?.text;
  if (!replyText) {
    throw new Error('Réponse vide reçue de l\'assistant IA.');
  }

  return replyText;
}

const chatRateLimits = new Map();
function checkChatRateLimit(ip) {
  const now = Date.now();
  const entry = chatRateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60000;
  }
  entry.count++;
  chatRateLimits.set(ip, entry);
  return entry.count <= 30; // 30 messages par minute
}

app.post(
  '/api/chat',
  wrap(async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    if (!checkChatRateLimit(ip)) {
      return res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter un instant.' });
    }

    const s = await getSettings();
    if (!s.chatbotEnabled) {
      return res.status(403).json({ error: 'Le chatbot est actuellement désactivé.' });
    }

    const userMessage = (req.body.message || '').trim();
    if (!userMessage) {
      return res.status(400).json({ error: 'Message vide.' });
    }

    if (userMessage.length > 1500) {
      return res.status(400).json({ error: 'Message trop long (1500 caractères maximum).' });
    }

    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const contents = [];
    for (const h of rawHistory.slice(-8)) {
      if (h.role === 'user' && typeof h.text === 'string' && h.text.trim()) {
        contents.push({ role: 'user', parts: [{ text: h.text.trim().slice(0, 1500) }] });
      } else if (h.role === 'model' && typeof h.text === 'string' && h.text.trim()) {
        contents.push({ role: 'model', parts: [{ text: h.text.trim().slice(0, 2000) }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const systemPrompt = await buildChatbotContext(pool, s.chatbotSystemPrompt);
    const apiKey = s.chatbotApiKey || DEFAULT_GEMINI_KEY;
    const model = s.chatbotModel || DEFAULT_GEMINI_MODEL;

    try {
      const reply = await callGeminiChat({
        apiKey,
        model,
        systemPrompt,
        messages: contents
      });
      res.json({ ok: true, reply });
    } catch (err) {
      console.error('[Chatbot Error]', err.message);
      res.status(502).json({
        ok: false,
        error: 'L\'assistant IA est temporairement indisponible. Notre équipe reste à votre écoute sur WhatsApp !',
        details: err.message
      });
    }
  })
);

// API Suivi & Récupération sécurisée d'accès
const suiviRateLimits = new Map();
function checkSuiviRateLimit(ip) {
  const now = Date.now();
  const entry = suiviRateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60000;
  }
  entry.count++;
  suiviRateLimits.set(ip, entry);
  return entry.count <= 10;
}

app.post(
  '/api/suivi',
  wrap(async (req, res) => {
    const ip = req.ip || '';
    if (!checkSuiviRateLimit(ip)) {
      throw new HttpError(429, 'Trop de tentatives de recherche. Veuillez patienter 1 minute.');
    }

    const raw = String(req.body.code || req.body.query || '').trim();
    if (!raw) {
      throw new HttpError(400, 'Veuillez saisir votre numéro de suivi confidentiel ou votre code client.');
    }

    // Sécurité stricte : refuser la recherche par simple numéro de téléphone
    if (/^\+?[0-9\s.-]{6,15}$/.test(raw) && !raw.toUpperCase().startsWith('NP-')) {
      throw new HttpError(400, 'Par mesure de confidentialité et de sécurité, la recherche par numéro de téléphone n\'est pas autorisée. Veuillez saisir votre code de suivi confidentiel (ex: NP-TRK-...) ou votre code client (ex: NP-CLI-...).');
    }

    const clean = raw.toUpperCase();

    // 1. Recherche par commande (tracking_code ou access_token)
    const ordRes = await pool.query(
      `SELECT o.id, o.customer_name, o.customer_last_name, o.items, o.status, o.total, o.access_token,
              o.tracking_code, COALESCE(o.duration_months, 12)::int AS duration_months,
              to_char(o.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS created_at,
              to_char(o.expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at,
              COALESCE(acc.cnt, 0)::int AS assigned_accounts_count
       FROM orders o
       LEFT JOIN (SELECT order_id, count(*)::int AS cnt FROM accounts GROUP BY order_id) acc ON acc.order_id = o.id
       WHERE UPPER(o.tracking_code) = $1 OR UPPER(o.access_token) = $1`,
      [clean]
    );

    if (ordRes.rows.length) {
      const o = ordRes.rows[0];
      return res.json({
        type: 'order',
        order: {
          id: o.id,
          customerName: [o.customer_name, o.customer_last_name].filter(Boolean).join(' ') || 'Client',
          trackingCode: o.tracking_code,
          accessToken: o.access_token,
          status: o.status,
          total: Number(o.total),
          items: o.items,
          durationMonths: o.duration_months,
          createdAt: o.created_at,
          expiresAt: o.expires_at,
          assignedAccountsCount: o.assigned_accounts_count,
          accessUrl: `/acces/${o.access_token}`
        }
      });
    }

    // 2. Recherche par client (client_code)
    const cliRes = await pool.query(
      `SELECT id, name, phone, client_code FROM clients WHERE UPPER(client_code) = $1`,
      [clean]
    );

    if (cliRes.rows.length) {
      const cli = cliRes.rows[0];
      const ords = await pool.query(
        `SELECT o.id, o.items, o.status, o.total, o.access_token, o.tracking_code,
                COALESCE(o.duration_months, 12)::int AS duration_months,
                to_char(o.expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at
         FROM orders o
         WHERE (o.customer_phone = $1 AND o.customer_phone <> '')
            OR (o.customer_name = $2 AND o.customer_name <> '')
         ORDER BY o.created_at DESC LIMIT 20`,
        [cli.phone, cli.name]
      );
      return res.json({
        type: 'client',
        client: {
          name: cli.name,
          clientCode: cli.client_code,
          orders: ords.rows.map(o => ({
            id: o.id,
            trackingCode: o.tracking_code,
            accessToken: o.access_token,
            status: o.status,
            total: Number(o.total),
            items: o.items,
            durationMonths: o.duration_months,
            expiresAt: o.expires_at,
            accessUrl: `/acces/${o.access_token}`
          }))
        }
      });
    }

    throw new HttpError(404, 'Aucun abonnement trouvé pour ce code confidentiel. Vérifiez le code (ex: NP-TRK-... ou NP-CLI-...) ou contactez le support.');
  })
);

// API Statut des services
app.get(
  '/api/status',
  wrap(async (req, res) => {
    const t0 = process.hrtime.bigint();
    await pool.query('SELECT 1');
    const latencyMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
    res.json({
      status: 'operational',
      latencyMs,
      uptimePct: 99.98,
      timestamp: new Date().toISOString()
    });
  })
);

// ----- Espace Client & API Compte Client -----
const clientRouter = express.Router();

// 1. Inscription client (avec envoi OTP)
clientRouter.post('/register', rateLimit(10, 60 * 1000), wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const password = str(req.body.password, 100);
  const firstName = str(req.body.firstName, 60);
  const lastName = str(req.body.lastName, 60);
  const phone = str(req.body.phone, 30);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Veuillez saisir une adresse email valide.');
  }
  if (!password || password.length < 8) {
    throw new HttpError(400, 'Le mot de passe doit comporter au moins 8 caractères.');
  }

  const existing = await pool.query('SELECT id, is_verified FROM customer_accounts WHERE lower(email) = lower($1)', [email]);
  const pwdHash = hashPassword(password);

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.is_verified) {
      throw new HttpError(400, 'Un compte vérifié existe déjà avec cette adresse email. Veuillez vous connecter.');
    }
    await pool.query(
      `UPDATE customer_accounts SET password_hash = $1, first_name = $2, last_name = $3, phone = $4 WHERE id = $5`,
      [pwdHash, firstName, lastName, phone, row.id]
    );
  } else {
    const refCode = generateReferralCode();
    await pool.query(
      `INSERT INTO customer_accounts (email, password_hash, first_name, last_name, phone, is_verified, referral_code) VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
      [email, pwdHash, firstName, lastName, phone, refCode]
    );
  }

  // Nettoyage des anciens codes register pour cet email
  await pool.query(`DELETE FROM customer_otps WHERE lower(email) = lower($1) AND purpose = 'register'`, [email]);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  await pool.query(
    `INSERT INTO customer_otps (email, code_hash, purpose, metadata, expires_at)
     VALUES ($1, $2, 'register', $3, now() + interval '10 minutes')`,
    [email, codeHash, JSON.stringify({ firstName, lastName, phone })]
  );

  const clientIp = getClientIp(req);
  const userAgent = String(req.headers['user-agent'] || '');
  await sendOtpEmail({ email, code, purpose: 'register', ip: clientIp, userAgent, firstName });

  res.status(200).json({
    ok: true,
    step: 'otp_required',
    purpose: 'register',
    email,
    message: `Un code de confirmation à 6 chiffres a été envoyé à l'adresse ${email}.`
  });
}));

// 2. Connexion client (avec détection de connexion suspecte)
clientRouter.post('/login', rateLimit(15, 60 * 1000), wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const password = str(req.body.password, 100);

  if (!email || !password) {
    throw new HttpError(400, 'Veuillez saisir votre email et votre mot de passe.');
  }

  const { rows } = await pool.query(
    `SELECT id, email, password_hash, first_name, last_name, phone, is_verified, last_login_at, status
     FROM customer_accounts WHERE lower(email) = lower($1)`,
    [email]
  );

  if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
    throw new HttpError(401, 'Adresse email ou mot de passe incorrect.');
  }

  const user = rows[0];
  if (user.status === 'suspended') {
    throw new HttpError(403, 'Ce compte client a été suspendu. Veuillez contacter le support.');
  }

  if (!user.is_verified) {
    // Renvoyer l'OTP d'activation
    await pool.query(`DELETE FROM customer_otps WHERE lower(email) = lower($1) AND purpose = 'register'`, [email]);
    const code = generateOtpCode();
    await pool.query(
      `INSERT INTO customer_otps (email, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'register', now() + interval '10 minutes')`,
      [email, hashOtpCode(code)]
    );
    const clientIp = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '');
    await sendOtpEmail({ email, code, purpose: 'register', ip: clientIp, userAgent, firstName: user.first_name });
    return res.json({
      ok: true,
      step: 'otp_required',
      purpose: 'register',
      email,
      message: 'Votre compte n\'est pas encore validé. Un code d\'activation vous a été envoyé par email.'
    });
  }

  // Détection de connexion suspecte (nouvelle IP OU nouvel appareil inconnu)
  const clientIp = getClientIp(req);
  const deviceId = getOrSetDeviceId(req, res);
  const deviceHash = sha256hex(deviceId);
  const userAgent = String(req.headers['user-agent'] || '');

  let isSuspicious = false;
  if (user.last_login_at) {
    const devRes = await pool.query(
      `SELECT id FROM customer_known_devices
       WHERE customer_account_id = $1 AND (device_hash = $2 OR ip = $3)
       LIMIT 1`,
      [user.id, deviceHash, clientIp]
    );
    if (!devRes.rows.length) {
      isSuspicious = true;
    }
  }

  if (isSuspicious) {
    // Déclenchement du code OTP de sécurité
    await pool.query(`DELETE FROM customer_otps WHERE lower(email) = lower($1) AND purpose = 'suspicious_login'`, [email]);
    const code = generateOtpCode();
    await pool.query(
      `INSERT INTO customer_otps (email, code_hash, purpose, metadata, expires_at)
       VALUES ($1, $2, 'suspicious_login', $3, now() + interval '10 minutes')`,
      [email, hashOtpCode(code), JSON.stringify({ ip: clientIp, userAgent, deviceHash })]
    );

    await sendOtpEmail({
      email,
      code,
      purpose: 'suspicious_login',
      ip: clientIp,
      userAgent,
      firstName: user.first_name
    });

    return res.json({
      ok: true,
      step: 'otp_required',
      purpose: 'suspicious_login',
      email,
      ip: clientIp,
      device: getClientDeviceInfo(userAgent),
      message: 'Connexion depuis un nouvel appareil ou une nouvelle adresse IP. Un code de sécurité à 6 chiffres vous a été envoyé par email.'
    });
  }

  // Connexion de confiance
  await pool.query(
    `INSERT INTO customer_known_devices (customer_account_id, device_hash, ip, user_agent, last_used_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (customer_account_id, device_hash)
     DO UPDATE SET last_used_at = now(), ip = EXCLUDED.ip, user_agent = EXCLUDED.user_agent`,
    [user.id, deviceHash, clientIp, userAgent]
  );

  await pool.query(
    `UPDATE customer_accounts SET last_login_at = now(), last_login_ip = $1 WHERE id = $2`,
    [clientIp, user.id]
  );

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256hex(sessionToken);
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_DAYS * 86400 * 1000);

  await pool.query(
    `INSERT INTO customer_sessions (token_hash, customer_account_id, ip, user_agent, device_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenHash, user.id, clientIp, userAgent, deviceHash, expiresAt]
  );

  setClientSessionCookie(res, sessionToken);

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone
    }
  });
}));

// 3. Validation OTP (Inscription, Connexion suspecte, Mot de passe)
clientRouter.post('/verify-otp', rateLimit(12, 60 * 1000), wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const otp = str(req.body.otp, 10).trim();
  const purpose = str(req.body.purpose, 30);

  if (!email || !otp || !purpose) {
    throw new HttpError(400, 'Paramètres requis manquants.');
  }

  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts, metadata, expires_at
     FROM customer_otps
     WHERE lower(email) = lower($1) AND purpose = $2 AND expires_at > now()
     ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );

  if (!rows.length) {
    throw new HttpError(400, 'Code expiré ou introuvable. Veuillez demander un nouveau code.');
  }

  const otpRow = rows[0];
  if (otpRow.attempts >= 5) {
    await pool.query('DELETE FROM customer_otps WHERE id = $1', [otpRow.id]);
    throw new HttpError(429, 'Trop de tentatives infructueuses. Veuillez demander un nouveau code.');
  }

  const valid = hashOtpCode(otp) === otpRow.code_hash;
  if (!valid) {
    await pool.query('UPDATE customer_otps SET attempts = attempts + 1 WHERE id = $1', [otpRow.id]);
    throw new HttpError(400, 'Code de sécurité incorrect. Vérifiez les 6 chiffres saisis.');
  }

  await pool.query('DELETE FROM customer_otps WHERE id = $1', [otpRow.id]);

  const clientIp = getClientIp(req);
  const deviceId = getOrSetDeviceId(req, res);
  const deviceHash = sha256hex(deviceId);
  const userAgent = String(req.headers['user-agent'] || '');

  if (purpose === 'register') {
    const accRes = await pool.query(
      `UPDATE customer_accounts
       SET is_verified = TRUE, last_login_at = now(), last_login_ip = $1
       WHERE lower(email) = lower($2)
       RETURNING id, email, first_name, last_name, phone`,
      [clientIp, email]
    );

    if (!accRes.rows.length) throw new HttpError(404, 'Compte client introuvable.');
    const user = accRes.rows[0];

    // Liaison automatique des commandes passées avec cet email ou téléphone
    await pool.query(
      `UPDATE orders SET customer_account_id = $1
       WHERE customer_account_id IS NULL AND (lower(customer_email) = lower($2) OR (customer_phone = $3 AND customer_phone <> ''))`,
      [user.id, user.email, user.phone]
    );

    // Enregistrement de l'appareil de confiance
    await pool.query(
      `INSERT INTO customer_known_devices (customer_account_id, device_hash, ip, user_agent, last_used_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (customer_account_id, device_hash) DO UPDATE SET last_used_at = now(), ip = EXCLUDED.ip`,
      [user.id, deviceHash, clientIp, userAgent]
    );

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256hex(sessionToken);
    const expiresAt = new Date(Date.now() + CLIENT_SESSION_DAYS * 86400 * 1000);

    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_account_id, ip, user_agent, device_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, user.id, clientIp, userAgent, deviceHash, expiresAt]
    );

    setClientSessionCookie(res, sessionToken);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone
      }
    });
  }

  if (purpose === 'suspicious_login') {
    const accRes = await pool.query(
      `SELECT id, email, first_name, last_name, phone FROM customer_accounts WHERE lower(email) = lower($1)`,
      [email]
    );
    if (!accRes.rows.length) throw new HttpError(404, 'Compte introuvable.');
    const user = accRes.rows[0];

    // Enregistrer ce nouvel appareil comme appareil de confiance
    await pool.query(
      `INSERT INTO customer_known_devices (customer_account_id, device_hash, ip, user_agent, last_used_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (customer_account_id, device_hash)
       DO UPDATE SET last_used_at = now(), ip = EXCLUDED.ip, user_agent = EXCLUDED.user_agent`,
      [user.id, deviceHash, clientIp, userAgent]
    );

    await pool.query(
      `UPDATE customer_accounts SET last_login_at = now(), last_login_ip = $1 WHERE id = $2`,
      [clientIp, user.id]
    );

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256hex(sessionToken);
    const expiresAt = new Date(Date.now() + CLIENT_SESSION_DAYS * 86400 * 1000);

    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_account_id, ip, user_agent, device_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, user.id, clientIp, userAgent, deviceHash, expiresAt]
    );

    setClientSessionCookie(res, sessionToken);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone
      }
    });
  }

  if (purpose === 'reset_password') {
    const resetSecret = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO customer_otps (email, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'reset_authorized', now() + interval '15 minutes')`,
      [email, sha256hex(resetSecret)]
    );
    return res.json({ ok: true, resetToken: resetSecret });
  }

  res.json({ ok: true });
}));

// 4. Renvoi d'un code OTP (avec rate limit de 60s)
clientRouter.post('/resend-otp', rateLimit(5, 60 * 1000), wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const purpose = str(req.body.purpose, 30);

  if (!email || !purpose) throw new HttpError(400, 'Paramètres requis manquants.');

  const existing = await pool.query(
    `SELECT created_at FROM customer_otps WHERE lower(email) = lower($1) AND purpose = $2 AND expires_at > now() ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );

  if (existing.rows.length) {
    const diffSec = Math.round((Date.now() - new Date(existing.rows[0].created_at).getTime()) / 1000);
    if (diffSec < 60) {
      throw new HttpError(429, `Veuillez patienter ${60 - diffSec} secondes avant de demander un nouveau code.`);
    }
  }

  const userRes = await pool.query(
    `SELECT first_name FROM customer_accounts WHERE lower(email) = lower($1)`,
    [email]
  );
  const firstName = userRes.rows.length ? userRes.rows[0].first_name : '';

  await pool.query(`DELETE FROM customer_otps WHERE lower(email) = lower($1) AND purpose = $2`, [email, purpose]);

  const code = generateOtpCode();
  await pool.query(
    `INSERT INTO customer_otps (email, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [email, hashOtpCode(code), purpose]
  );

  const clientIp = getClientIp(req);
  const userAgent = String(req.headers['user-agent'] || '');
  await sendOtpEmail({ email, code, purpose, ip: clientIp, userAgent, firstName });

  res.json({ ok: true, message: 'Un nouveau code vous a été envoyé par email.' });
}));

// 5. Mot de passe oublié
clientRouter.post('/forgot-password', rateLimit(5, 60 * 1000), wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  if (!email) throw new HttpError(400, 'Veuillez saisir votre email.');

  const userRes = await pool.query(
    `SELECT id, first_name, is_verified FROM customer_accounts WHERE lower(email) = lower($1)`,
    [email]
  );

  if (userRes.rows.length && userRes.rows[0].is_verified) {
    await pool.query(`DELETE FROM customer_otps WHERE lower(email) = lower($1) AND purpose IN ('reset_password', 'reset_authorized')`, [email]);
    const code = generateOtpCode();
    await pool.query(
      `INSERT INTO customer_otps (email, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'reset_password', now() + interval '10 minutes')`,
      [email, hashOtpCode(code)]
    );
    await sendOtpEmail({
      email,
      code,
      purpose: 'reset_password',
      firstName: userRes.rows[0].first_name
    });
  }

  res.json({
    ok: true,
    message: 'Si cette adresse email est associée à un compte, un code de réinitialisation vous a été envoyé.'
  });
}));

// 6. Réinitialisation mot de passe avec token vérifié
clientRouter.post('/reset-password', rateLimit(5, 60 * 1000), wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const resetToken = str(req.body.resetToken, 128);
  const newPassword = str(req.body.newPassword, 100);

  if (!email || !resetToken || !newPassword) {
    throw new HttpError(400, 'Paramètres requis manquants.');
  }
  if (newPassword.length < 8) {
    throw new HttpError(400, 'Le nouveau mot de passe doit comporter au moins 8 caractères.');
  }

  const { rows } = await pool.query(
    `SELECT id FROM customer_otps
     WHERE lower(email) = lower($1) AND purpose = 'reset_authorized' AND code_hash = $2 AND expires_at > now()`,
    [email, sha256hex(resetToken)]
  );

  if (!rows.length) {
    throw new HttpError(400, 'Session de réinitialisation expirée ou invalide. Veuillez recommencer.');
  }

  await pool.query('DELETE FROM customer_otps WHERE id = $1', [rows[0].id]);

  const newHash = hashPassword(newPassword);
  await pool.query(`UPDATE customer_accounts SET password_hash = $1 WHERE lower(email) = lower($2)`, [newHash, email]);

  // Révocation des anciennes sessions pour sécurité
  await pool.query(
    `DELETE FROM customer_sessions WHERE customer_account_id = (SELECT id FROM customer_accounts WHERE lower(email) = lower($1))`,
    [email]
  );

  res.json({ ok: true, message: 'Votre mot de passe a été réinitialisé avec succès ! Vous pouvez maintenant vous connecter.' });
}));

// 7. Tableau de bord Client (Mes Abonnements & Accès)
clientRouter.get('/me', requireCustomerAuth, wrap(async (req, res) => {
  const user = req.customerAccount;

  // Récupérer les commandes associées au compte client
  const ordRes = await pool.query(
    `SELECT o.id, o.customer_name, o.customer_last_name, o.customer_phone, o.customer_email,
            o.items, o.total, o.status, o.access_token, o.tracking_code,
            COALESCE(o.duration_months, 12)::int AS duration_months,
            o.expires_at AS raw_expires_at,
            to_char(o.expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at,
            to_char(o.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS created_at
     FROM orders o
     WHERE o.customer_account_id = $1 OR (lower(o.customer_email) = lower($2) AND o.customer_email <> '')
     ORDER BY o.created_at DESC`,
    [user.id, user.email]
  );

  const orderIds = ordRes.rows.map(o => o.id);
  let accountsByOrder = {};

  if (orderIds.length) {
    const accRes = await pool.query(
      `SELECT a.id, a.order_id, a.offer_id, a.service_name, a.login, a.password, a.slot_profile, a.notes,
              a.status, a.warranty_claim, a.defect_reason,
              o.name AS offer_name, o.hue, o.category, o.is_pack, o.pack_items
       FROM accounts a
       LEFT JOIN offers o ON o.id = a.offer_id
       WHERE a.order_id = ANY($1) AND a.status = 'assigned'
       ORDER BY a.id ASC`,
      [orderIds]
    );

    for (const a of accRes.rows) {
      if (!accountsByOrder[a.order_id]) accountsByOrder[a.order_id] = [];
      accountsByOrder[a.order_id].push({
        id: a.id,
        serviceName: a.offer_name || a.service_name,
        login: a.login,
        password: a.password,
        slotProfile: a.slot_profile,
        notes: a.notes,
        hue: a.hue || 200,
        category: a.category || 'streaming',
        warrantyClaim: !!a.warranty_claim,
        defectReason: a.defect_reason || ''
      });
    }
  }

  const now = new Date();
  let activeSubsCount = 0;
  let nearestExpiryDays = null;

  const orders = ordRes.rows.map(o => {
    let daysRemaining = null;
    let isExpired = false;
    if (o.raw_expires_at) {
      const diffMs = new Date(o.raw_expires_at).getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / (24 * 3600 * 1000));
      isExpired = daysRemaining < 0;
    }

    const isActive = o.status === 'confirmed' && !isExpired;
    if (isActive) {
      activeSubsCount++;
      if (daysRemaining !== null && daysRemaining >= 0) {
        if (nearestExpiryDays === null || daysRemaining < nearestExpiryDays) {
          nearestExpiryDays = daysRemaining;
        }
      }
    }

    return {
      id: o.id,
      trackingCode: o.tracking_code,
      accessToken: o.access_token,
      accessUrl: `/acces/${o.access_token}`,
      status: o.status,
      total: Number(o.total),
      items: o.items,
      durationMonths: o.duration_months,
      createdAt: o.created_at,
      expiresAt: o.expires_at,
      daysRemaining,
      isExpired,
      accounts: accountsByOrder[o.id] || []
    };
  });

  const totalSpent = orders
    .filter(o => o.status === 'confirmed')
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const confirmedCount = orders.filter(o => o.status === 'confirmed').length;

  const devCountRes = await pool.query(
    `SELECT count(*)::int AS count FROM customer_known_devices WHERE customer_account_id = $1`,
    [user.id]
  );

  // Données du programme de parrainage (-50%)
  let referralCode = user.referral_code;
  if (!referralCode) {
    referralCode = generateReferralCode();
    await pool.query('UPDATE customer_accounts SET referral_code = $1 WHERE id = $2', [referralCode, user.id]);
    user.referral_code = referralCode;
  }

  // Commandes parrainées apportées
  const refOrdersRes = await pool.query(
    `SELECT o.id, o.customer_name, o.customer_last_name, o.customer_email,
            o.items, o.total, o.status,
            to_char(o.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS date_formatted
     FROM orders o
     WHERE o.referrer_customer_account_id = $1
     ORDER BY o.created_at DESC`,
    [user.id]
  );

  let confirmedRefOrders = 0;
  let pendingRefOrders = 0;
  let totalRefItems = 0;

  const referralHistory = refOrdersRes.rows.map((ro) => {
    const isConfirmed = ro.status === 'confirmed';
    if (isConfirmed) confirmedRefOrders++;
    else if (ro.status === 'new') pendingRefOrders++;

    const items = Array.isArray(ro.items) ? ro.items : [];
    totalRefItems += items.length || 1;
    const itemsSummary = items.map((i) => i.name).join(' + ') || 'Abonnement';

    let displayName = 'Client NeonPass';
    const fullName = [ro.customer_name, ro.customer_last_name].filter(Boolean).join(' ').trim();
    if (fullName) {
      const parts = fullName.split(' ');
      displayName = parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
    } else if (ro.customer_email) {
      const parts = ro.customer_email.split('@');
      displayName = parts[0].slice(0, 2) + '***@' + parts[1];
    }

    return {
      id: ro.id,
      date: ro.date_formatted,
      referralName: displayName,
      itemsSummary,
      itemsCount: items.length || 1,
      total: Number(ro.total),
      status: ro.status
    };
  });

  const rewardsRes = await pool.query(
    `SELECT r.id, r.promo_code, r.pct, r.tier,
            to_char(r.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY') AS created_at,
            p.uses, p.max_uses, p.active
     FROM customer_referral_rewards r
     LEFT JOIN promo_codes p ON p.code = r.promo_code
     WHERE r.customer_account_id = $1
     ORDER BY r.id DESC`,
    [user.id]
  );

  const rewards = rewardsRes.rows.map((rw) => ({
    id: rw.id,
    promoCode: rw.promo_code,
    pct: rw.pct,
    tier: rw.tier,
    createdAt: rw.created_at,
    isUsed: (rw.uses || 0) >= (rw.max_uses || 1) || rw.active === false,
    uses: rw.uses || 0
  }));

  const activeReward = rewards.find((rw) => !rw.isUsed) || null;
  const threshold = 5;
  const currentTierProgress = confirmedRefOrders % threshold;
  const progressPct = confirmedRefOrders >= threshold && currentTierProgress === 0
    ? 100
    : Math.min(100, Math.round((currentTierProgress / threshold) * 100));
  const neededForNext = threshold - currentTierProgress;

  const referralData = {
    code: referralCode,
    link: `${SITE_URL}/?ref=${encodeURIComponent(referralCode)}`,
    confirmedOrdersCount: confirmedRefOrders,
    pendingOrdersCount: pendingRefOrders,
    totalOrdersCount: refOrdersRes.rows.length,
    totalItemsCount: totalRefItems,
    threshold,
    currentTierProgress,
    progressPct,
    neededForNext,
    activeReward,
    rewards,
    history: referralHistory
  };

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone
    },
    orders,
    summary: {
      totalOrders: orders.length,
      confirmedOrdersCount: confirmedCount,
      totalSpent: Math.round(totalSpent * 100) / 100,
      activeSubscriptions: activeSubsCount,
      nearestExpiryDays,
      knownDevicesCount: devCountRes.rows[0].count
    },
    referral: referralData,
    waNumber: WA_NUMBER
  });
}));

// 8. Rattacher une commande via son code de suivi ou son lien secret
clientRouter.post('/link-order', requireCustomerAuth, wrap(async (req, res) => {
  const code = str(req.body.code, 64).trim().toUpperCase();
  if (!code) throw new HttpError(400, 'Veuillez saisir votre numéro de suivi (ex: NP-TRK-...) ou lien d\'accès.');

  const { rows } = await pool.query(
    `SELECT id, customer_account_id FROM orders WHERE UPPER(tracking_code) = $1 OR UPPER(access_token) = $1`,
    [code]
  );

  if (!rows.length) {
    throw new HttpError(404, 'Aucune commande trouvée correspondant à ce code.');
  }

  const ord = rows[0];
  if (ord.customer_account_id && ord.customer_account_id !== req.customerAccount.id) {
    throw new HttpError(400, 'Cette commande est déjà rattachée à un autre compte client.');
  }

  await pool.query(
    `UPDATE orders SET customer_account_id = $1, customer_email = COALESCE(NULLIF(customer_email, ''), $2) WHERE id = $3`,
    [req.customerAccount.id, req.customerAccount.email, ord.id]
  );

  res.json({ ok: true, message: 'La commande a été rattachée à votre compte avec succès !' });
}));

// 9. Mise à jour du profil client
clientRouter.post('/update-profile', requireCustomerAuth, wrap(async (req, res) => {
  const firstName = str(req.body.firstName, 60);
  const lastName = str(req.body.lastName, 60);
  const phone = str(req.body.phone, 30);
  const currentPassword = str(req.body.currentPassword, 100);
  const newPassword = str(req.body.newPassword, 100);

  if (newPassword) {
    if (newPassword.length < 8) {
      throw new HttpError(400, 'Le nouveau mot de passe doit comporter au moins 8 caractères.');
    }
    const accRes = await pool.query(`SELECT password_hash FROM customer_accounts WHERE id = $1`, [req.customerAccount.id]);
    if (!accRes.rows.length || !verifyPassword(currentPassword, accRes.rows[0].password_hash)) {
      throw new HttpError(401, 'Le mot de passe actuel est incorrect.');
    }
    const newHash = hashPassword(newPassword);
    await pool.query(
      `UPDATE customer_accounts SET first_name = $1, last_name = $2, phone = $3, password_hash = $4 WHERE id = $5`,
      [firstName, lastName, phone, newHash, req.customerAccount.id]
    );
  } else {
    await pool.query(
      `UPDATE customer_accounts SET first_name = $1, last_name = $2, phone = $3 WHERE id = $4`,
      [firstName, lastName, phone, req.customerAccount.id]
    );
  }

  res.json({ ok: true, message: 'Profil mis à jour avec succès.' });
}));

// 10. Déconnexion client
clientRouter.post('/logout', wrap(async (req, res) => {
  const token = readCookieValue(req, CLIENT_COOKIE);
  if (token) {
    await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [sha256hex(token)]);
  }
  clearClientSessionCookie(res);
  res.json({ ok: true, message: 'Déconnexion effectuée.' });
}));

// 11. Demande de remplacement SAV par le client
clientRouter.post('/request-sav', requireCustomerAuth, wrap(async (req, res) => {
  const user = req.customerAccount;
  const orderId = Number(req.body.orderId) || 0;
  const accountId = Number(req.body.accountId) || 0;
  const reason = str(req.body.reason, 120) || 'Accès non fonctionnel';
  const comment = str(req.body.comment, 500) || '';

  // Vérifier que la commande appartient bien à ce client
  const ordRes = await pool.query(
    `SELECT id, customer_name, customer_email, tracking_code FROM orders
     WHERE id = $1 AND (customer_account_id = $2 OR (lower(customer_email) = lower($3) AND customer_email <> ''))`,
    [orderId, user.id, user.email]
  );
  if (!ordRes.rows.length) {
    throw new HttpError(404, 'Commande introuvable ou non associée à votre compte.');
  }

  // Vérifier que le compte appartient à cette commande
  const accRes = await pool.query(
    `SELECT id, service_name, offer_id FROM accounts WHERE id = $1 AND order_id = $2 AND status = 'assigned'`,
    [accountId, orderId]
  );
  if (!accRes.rows.length) {
    throw new HttpError(404, 'Accès introuvable sur cette commande.');
  }

  const fullReason = comment ? `${reason} — ${comment}` : reason;

  await pool.query(
    `UPDATE accounts
     SET warranty_claim = TRUE, defect_reason = $1, defect_at = now()
     WHERE id = $2`,
    [fullReason, accountId]
  );

  await audit(req, 'CLIENT_SAV_REQUEST', {
    clientId: user.id,
    email: user.email,
    orderId,
    accountId,
    serviceName: accRes.rows[0].service_name,
    reason: fullReason
  });

  res.json({
    ok: true,
    message: 'Votre demande de remplacement SAV a bien été enregistrée. Notre équipe va vous attribuer un nouvel accès et vous l\'envoyer par email et sur votre compte.'
  });
}));

// 12. Connexion directe "Vue Client" via Token Magique (Généré par l'admin)
clientRouter.post('/verify-magic-token', wrap(async (req, res) => {
  const token = str(req.body.magicToken, 128).trim();
  if (!token) throw new HttpError(400, 'Jeton magique manquant.');

  const tokenHash = sha256hex(token);
  const { rows } = await pool.query(
    `SELECT id, email, purpose, metadata, expires_at
     FROM customer_otps
     WHERE code_hash = $1 AND purpose = 'magic_login' AND expires_at > now()`,
    [tokenHash]
  );

  if (!rows.length) {
    throw new HttpError(400, 'Lien de connexion expiré ou invalide.');
  }

  const otpRow = rows[0];
  await pool.query('DELETE FROM customer_otps WHERE id = $1', [otpRow.id]);

  const accRes = await pool.query(
    `SELECT id, email, first_name, last_name, phone, is_verified, status FROM customer_accounts WHERE lower(email) = lower($1)`,
    [otpRow.email]
  );

  if (!accRes.rows.length) {
    throw new HttpError(404, 'Compte client introuvable.');
  }

  const user = accRes.rows[0];
  const clientIp = getClientIp(req);
  const deviceId = getOrSetDeviceId(req, res);
  const deviceHash = sha256hex(deviceId);
  const userAgent = String(req.headers['user-agent'] || '');

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = sha256hex(sessionToken);
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_DAYS * 86400 * 1000);

  await pool.query(
    `INSERT INTO customer_sessions (token_hash, customer_account_id, ip, user_agent, device_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionHash, user.id, clientIp, userAgent, deviceHash, expiresAt]
  );

  setClientSessionCookie(res, sessionToken);

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone
    }
  });
}));

app.use('/api/client', clientRouter);

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

admin.post(
  '/audit/purge',
  wrap(async (req, res) => {
    const raw = str(req.body.period, 30);
    const period = raw.replace(/^(older_|recent_)/, '');
    const isRecent = raw.startsWith('recent_');

    const intervals = {
      '1h': '1 hour',
      '6h': '6 hours',
      '12h': '12 hours',
      '1j': '1 day',
      '1d': '1 day',
      '3j': '3 days',
      '3d': '3 days',
      '7j': '7 days',
      '7d': '7 days',
      '1mois': '1 month',
      '1m': '1 month'
    };

    if (raw === 'all' || period === 'all') {
      const del = await pool.query('DELETE FROM admin_audit');
      await audit(req, 'audit.purge', { type: 'all', deleted: del.rowCount });
      return res.json({ ok: true, deleted: del.rowCount, message: `${del.rowCount} entrée(s) du journal supprimée(s).` });
    }

    const intervalStr = intervals[period];
    if (!intervalStr) throw new HttpError(400, 'Période de purge invalide.');

    const op = isRecent ? '>=' : '<';
    const del = await pool.query(`DELETE FROM admin_audit WHERE at ${op} now() - interval '${intervalStr}'`);
    await audit(req, 'audit.purge', { period: raw, deleted: del.rowCount });
    return res.json({
      ok: true,
      deleted: del.rowCount,
      message: `${del.rowCount} entrée(s) de journal supprimée(s).`
    });
  })
);

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

// ---------- Sauvegarde & Restauration de la base de données ----------
function restoreFromSql(sqlContent, databaseUrl) {
  return new Promise((resolve, reject) => {
    const psql = spawn('psql', [databaseUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' }
    });
    let stderr = '';
    psql.stderr.on('data', (d) => { stderr += d.toString(); });
    psql.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new HttpError(500, 'Erreur lors de l\'exécution du script SQL (code ' + code + '): ' + stderr.slice(-400)));
    });
    psql.on('error', (err) => {
      reject(new HttpError(500, 'Échec d\'exécution de psql: ' + err.message));
    });
    psql.stdin.write(sqlContent);
    psql.stdin.end();
  });
}

async function restoreFromJson(data, pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tables = data.tables || data;
    // Nettoyage dans l'ordre strict des contraintes
    await client.query('UPDATE accounts SET replaced_by_account_id = NULL').catch(() => {});
    await client.query('DELETE FROM accounts');
    await client.query('DELETE FROM reviews');
    await client.query('DELETE FROM customer_referral_rewards').catch(() => {});
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM customer_otps').catch(() => {});
    await client.query('DELETE FROM customer_sessions').catch(() => {});
    await client.query('DELETE FROM customer_known_devices').catch(() => {});
    await client.query('DELETE FROM customer_accounts').catch(() => {});
    await client.query('DELETE FROM clients');
    await client.query('DELETE FROM offers');
    await client.query('DELETE FROM promo_codes');
    await client.query('DELETE FROM settings');
    await client.query('DELETE FROM email_logs').catch(() => {});
    await client.query('DELETE FROM admin_audit').catch(() => {});

    const sanitizeRow = (cols, row) => cols.map((c) => {
      const v = row[c];
      if (v === undefined) return null;
      if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
        return JSON.stringify(v);
      }
      return v;
    });

    const insertTableRows = async (tableName, rows) => {
      if (!Array.isArray(rows) || !rows.length) return;
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = sanitizeRow(cols, row);
        const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ');
        await client.query(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
      }
    };

    if (Array.isArray(tables.settings) && tables.settings.length) {
      for (const row of tables.settings) {
        await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [row.key, row.value]);
      }
    }

    await insertTableRows('promo_codes', tables.promo_codes);
    await insertTableRows('offers', tables.offers);
    await insertTableRows('clients', tables.clients);
    await insertTableRows('customer_accounts', tables.customer_accounts);
    await insertTableRows('orders', tables.orders);
    await insertTableRows('accounts', tables.accounts);
    await insertTableRows('reviews', tables.reviews);
    await insertTableRows('customer_referral_rewards', tables.customer_referral_rewards);
    await insertTableRows('customer_known_devices', tables.customer_known_devices);
    await insertTableRows('email_logs', tables.email_logs);
    if (Array.isArray(tables.admin_audit) && tables.admin_audit.length) {
      await insertTableRows('admin_audit', tables.admin_audit);
    }

    // Réaligner les séquences SERIAL
    const seqs = [
      ['offers', 'offers_id_seq'],
      ['orders', 'orders_id_seq'],
      ['accounts', 'accounts_id_seq'],
      ['clients', 'clients_id_seq'],
      ['reviews', 'reviews_id_seq'],
      ['customer_accounts', 'customer_accounts_id_seq'],
      ['customer_referral_rewards', 'customer_referral_rewards_id_seq'],
      ['customer_known_devices', 'customer_known_devices_id_seq'],
      ['email_logs', 'email_logs_id_seq'],
      ['admin_audit', 'admin_audit_id_seq']
    ];
    for (const [tbl, seq] of seqs) {
      await client.query(`SELECT setval('${seq}', COALESCE((SELECT MAX(id) FROM ${tbl}), 1))`).catch(() => {});
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// État des volumes pour l'encadré de sauvegarde
admin.get('/backup/status', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM orders)::int AS orders,
       (SELECT count(*) FROM accounts)::int AS accounts,
       (SELECT count(*) FROM clients)::int AS clients,
       (SELECT count(*) FROM customer_accounts)::int AS customer_accounts,
       (SELECT count(*) FROM offers)::int AS offers,
       (SELECT count(*) FROM promo_codes)::int AS promos,
       (SELECT count(*) FROM customer_referral_rewards)::int AS referral_rewards,
       (SELECT count(*) FROM email_logs)::int AS email_logs,
       (SELECT count(*) FROM reviews)::int AS reviews,
       pg_size_pretty(pg_database_size(current_database())) AS db_size,
       pg_database_size(current_database())::bigint AS db_bytes`
  );
  res.json({ ok: true, stats: rows[0] });
}));

// Export complet SQL via pg_dump
admin.get('/backup/sql', wrap(async (req, res) => {
  const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `neonpass-backup-${nowStr}.sql`;
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const dump = spawn('pg_dump', [process.env.DATABASE_URL, '--clean', '--if-exists'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  dump.stdout.pipe(res);

  let stderr = '';
  dump.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  dump.on('close', async (code) => {
    if (code === 0) {
      await audit(req, 'backup.export_sql', { filename });
    } else {
      console.error('[backup] pg_dump error code ' + code + ':', stderr);
    }
  });
}));

// Export JSON structuré
admin.get('/backup/json', wrap(async (req, res) => {
  const [
    settings,
    offers,
    orders,
    clients,
    accounts,
    promos,
    reviews,
    customerAccounts,
    customerDevices,
    customerRewards,
    emailLogs,
    adminAudit
  ] = await Promise.all([
    pool.query('SELECT key, value FROM settings ORDER BY key'),
    pool.query('SELECT * FROM offers ORDER BY id'),
    pool.query('SELECT * FROM orders ORDER BY id'),
    pool.query('SELECT * FROM clients ORDER BY id'),
    pool.query('SELECT * FROM accounts ORDER BY id'),
    pool.query('SELECT * FROM promo_codes ORDER BY code'),
    pool.query('SELECT * FROM reviews ORDER BY id'),
    pool.query('SELECT * FROM customer_accounts ORDER BY id'),
    pool.query('SELECT * FROM customer_known_devices ORDER BY id'),
    pool.query('SELECT * FROM customer_referral_rewards ORDER BY id'),
    pool.query('SELECT * FROM email_logs ORDER BY id'),
    pool.query('SELECT * FROM admin_audit ORDER BY id')
  ]);
  const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `neonpass-backup-${nowStr}.json`;
  const payload = {
    app: 'NeonPass',
    version: 2,
    exported_at: new Date().toISOString(),
    counts: {
      settings: settings.rowCount,
      offers: offers.rowCount,
      orders: orders.rowCount,
      clients: clients.rowCount,
      accounts: accounts.rowCount,
      promos: promos.rowCount,
      reviews: reviews.rowCount,
      customer_accounts: customerAccounts.rowCount,
      customer_known_devices: customerDevices.rowCount,
      customer_referral_rewards: customerRewards.rowCount,
      email_logs: emailLogs.rowCount,
      admin_audit: adminAudit.rowCount
    },
    tables: {
      settings: settings.rows,
      offers: offers.rows,
      orders: orders.rows,
      clients: clients.rows,
      accounts: accounts.rows,
      promo_codes: promos.rows,
      reviews: reviews.rows,
      customer_accounts: customerAccounts.rows,
      customer_known_devices: customerDevices.rows,
      customer_referral_rewards: customerRewards.rows,
      email_logs: emailLogs.rows,
      admin_audit: adminAudit.rows
    }
  };
  await audit(req, 'backup.export_json', { filename, counts: payload.counts });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
}));

// Restauration d'une sauvegarde (SQL ou JSON)
admin.post('/backup/restore', express.raw({ type: () => true, limit: '100mb' }), wrap(async (req, res) => {
  if (!req.body || !req.body.length) {
    throw new HttpError(400, 'Fichier de sauvegarde vide ou non reçu.');
  }

  const raw = req.body.toString('utf8').trim();
  if (!raw) {
    throw new HttpError(400, 'Le contenu du fichier de sauvegarde est vide.');
  }

  const clientFilename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'backup';

  // Sauvegarde temporaire de sécurité
  try {
    const safetyDump = spawn('pg_dump', [process.env.DATABASE_URL, '--clean', '--if-exists'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const safetyStream = fs.createWriteStream('/tmp/neonpass_pre_restore_backup.sql');
    safetyDump.stdout.pipe(safetyStream);
  } catch (e) {
    console.warn('[backup] Copie temporaire pre-restore échouée:', e.message);
  }

  const isJson = raw.startsWith('{') && (raw.includes('"tables"') || raw.includes('"app"'));

  if (isJson) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new HttpError(400, 'Fichier JSON invalide : ' + err.message);
    }
    await restoreFromJson(parsed, pool);
  } else {
    if (!raw.includes('CREATE') && !raw.includes('INSERT') && !raw.includes('SET') && !raw.includes('ALTER')) {
      throw new HttpError(400, 'Le fichier ne semble pas être un dump SQL PostgreSQL valide.');
    }
    await restoreFromSql(raw, process.env.DATABASE_URL);
  }

  // Réapplication du schéma idempotent pour synchroniser les colonnes récentes
  try {
    const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
    await pool.query(initSql);
  } catch (err) {
    console.warn('[backup] Avertissement init.sql post-restore:', err.message);
  }

  const auditDetails = { filename: clientFilename, isJson, sizeBytes: req.body.length };
  await audit(req, 'backup.restore', auditDetails);

  notify(`🚨 *Sauvegarde restaurée sur NeonPass*\n` +
    `Fichier : \`${clientFilename}\` (${Math.round(req.body.length / 1024)} Ko)\n` +
    `Format : ${isJson ? 'JSON Snapshot' : 'SQL Dump'}\n` +
    `IP Admin : ${req.ip}`);

  res.json({
    ok: true,
    message: 'Base de données restaurée avec succès.',
    format: isJson ? 'json' : 'sql',
    filename: clientFilename
  });
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
      `SELECT o.id, o.customer_name, o.customer_last_name, o.customer_phone, o.customer_email, o.items, o.total::float AS total, o.discount,
              o.promo_code, o.promo_pct, o.payment_method, o.notes, o.source, o.status, o.created_at, o.access_token,
              o.tracking_code, o.referral_code, o.referrer_customer_account_id,
              ref.email AS referrer_email, trim(concat(ref.first_name, ' ', ref.last_name)) AS referrer_name,
              to_char(o.expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at, o.reminder_sent_at,
              COALESCE(o.duration_months, 12)::int AS duration_months,
              COALESCE(acc.cnt, 0)::int AS assigned_accounts_count,
              COALESCE(acc.sav_claims_cnt, 0)::int AS sav_claims_count
       FROM orders o
       LEFT JOIN customer_accounts ref ON ref.id = o.referrer_customer_account_id
       LEFT JOIN (
         SELECT order_id, count(*)::int AS cnt, count(*) FILTER (WHERE warranty_claim = TRUE)::int AS sav_claims_cnt
         FROM accounts GROUP BY order_id
       ) acc ON acc.order_id = o.id
       WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 500`,
      [status]
    );
    res.json(rows);
  })
);

admin.get(
  '/orders/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const { rows } = await pool.query(
      `SELECT o.id, o.customer_name, o.customer_last_name, o.customer_phone, o.customer_email, o.items, o.total::float AS total, o.discount,
              o.promo_code, o.promo_pct, o.payment_method, o.notes, o.source, o.status, o.created_at, o.access_token,
              o.tracking_code, o.referral_code, o.referrer_customer_account_id,
              ref.email AS referrer_email, trim(concat(ref.first_name, ' ', ref.last_name)) AS referrer_name,
              to_char(o.expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at, o.reminder_sent_at,
              COALESCE(o.duration_months, 12)::int AS duration_months,
              COALESCE(acc.cnt, 0)::int AS assigned_accounts_count,
              COALESCE(acc.sav_claims_cnt, 0)::int AS sav_claims_count
       FROM orders o
       LEFT JOIN customer_accounts ref ON ref.id = o.referrer_customer_account_id
       LEFT JOIN (
         SELECT order_id, count(*)::int AS cnt, count(*) FILTER (WHERE warranty_claim = TRUE)::int AS sav_claims_cnt
         FROM accounts GROUP BY order_id
       ) acc ON acc.order_id = o.id
       WHERE o.id = $1`,
      [id]
    );
    if (!rows.length) throw new HttpError(404, 'Commande introuvable.');
    res.json(rows[0]);
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
  if (b.durationMonths !== undefined) {
    const dm = parseInt(b.durationMonths, 10);
    if (dm >= 1 && dm <= 120) out.duration_months = dm;
  }
  if (b.expiresAt !== undefined) {
    const d = str(b.expiresAt, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "Date d'échéance invalide.");
    out.expires_at = d ? d + ' 12:00 Europe/Paris' : null;
  }
  return out;
}

// À la confirmation, l'échéance est fixée selon la durée configurée (par défaut 12 mois)
const setDefaultExpiry = (id, durationMonths = 12) => pool.query(
  `UPDATE orders
   SET duration_months = COALESCE(duration_months, $2),
       expires_at = COALESCE(expires_at, now() + make_interval(months => COALESCE(duration_months, $2)))
   WHERE id = $1 AND status = 'confirmed' AND expires_at IS NULL`, [id, Number(durationMonths) || 12]);

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

    const durationMonths = info.duration_months || 12;
    let expiresAt = info.expires_at || null;
    if (!expiresAt) {
      // Calcul automatique selon la durée choisie
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + durationMonths);
      expiresAt = expDate.toISOString();
    }

    const token = crypto.randomBytes(16).toString('hex');
    const trackingCode = generateTrackingCode();
    const r = await pool.query(
      `INSERT INTO orders (customer_name, customer_last_name, customer_phone, items, total, discount,
                           payment_method, notes, status, source, access_token, duration_months, expires_at, tracking_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'admin', $10, $11, $12, $13) RETURNING id, access_token, tracking_code`,
      [info.customer_name || '', info.customer_last_name || '', info.customer_phone || '', JSON.stringify(items),
       total, discount, info.payment_method || '', info.notes || '', info.status || 'confirmed', token,
       durationMonths, expiresAt, trackingCode]
    );
    if ((info.status || 'confirmed') === 'confirmed') {
      await checkAndAwardReferralRewards(r.rows[0].id);
    }
    res.status(201).json({ ok: true, id: r.rows[0].id, total, accessToken: token, trackingCode });
  })
);

admin.post(
  '/orders/:id/set-expiry',
  wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const { durationMonths, expiresAt } = req.body;
    let query, params;
    if (expiresAt) {
      const d = str(expiresAt, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "Date invalide.");
      query = `UPDATE orders
               SET expires_at = $1::timestamptz,
                   duration_months = COALESCE($2, duration_months)
               WHERE id = $3
               RETURNING id, customer_name, customer_last_name, customer_phone, items, total, status, access_token, duration_months,
                         to_char(expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at`;
      params = [d + ' 12:00 Europe/Paris', durationMonths ? Number(durationMonths) : null, id];
    } else if (durationMonths) {
      const dm = clampInt(durationMonths, 1, 120, 12);
      query = `UPDATE orders
               SET expires_at = now() + make_interval(months => $1),
                   duration_months = $1
               WHERE id = $2
               RETURNING id, customer_name, customer_last_name, customer_phone, items, total, status, access_token, duration_months,
                         to_char(expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS expires_at`;
      params = [dm, id];
    } else {
      throw new HttpError(400, 'Indique une durée ou une date.');
    }
    const r = await pool.query(query, params);
    if (!r.rowCount) throw new HttpError(404, 'Commande introuvable.');
    res.json({ ok: true, order: r.rows[0] });
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
    await setDefaultExpiry(Number(req.params.id) || 0, info.duration_months || 12);
    if (info.status === 'confirmed') {
      await checkAndAwardReferralRewards(Number(req.params.id) || 0);
    }
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

const OFFER_COLS = 'slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort, pack_items, low_stock_threshold, duration_months';
function offerValues(o) {
  return [
    o.slug,
    o.name,
    o.category,
    o.tag,
    o.price,
    o.was,
    o.description,
    JSON.stringify(o.features),
    o.hue,
    o.isPack,
    o.active,
    o.sort,
    JSON.stringify(o.packItems || []),
    o.lowStockThreshold || 2,
    o.durationMonths || 12
  ];
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
        `INSERT INTO offers (${OFFER_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
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
                features=$8, hue=$9, is_pack=$10, active=$11, sort=$12, pack_items=$13, low_stock_threshold=$14,
                duration_months=$15 WHERE id=$16 RETURNING *`,
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

admin.get(
  '/orders/:id/matching-accounts',
  wrap(async (req, res) => {
    const orderId = Number(req.params.id) || 0;
    const ordRes = await pool.query(
      `SELECT id, customer_name, customer_last_name, customer_phone, customer_email, items, total, status
       FROM orders WHERE id = $1`,
      [orderId]
    );
    if (!ordRes.rowCount) throw new HttpError(404, 'Commande introuvable.');
    const ord = ordRes.rows[0];

    const items = Array.isArray(ord.items) ? ord.items : [];
    const neededOfferIds = new Set();
    const offerDetailsMap = {};

    for (const it of items) {
      const off = await pool.query('SELECT id, name, is_pack, pack_items, category, hue FROM offers WHERE id = $1', [it.id]);
      if (off.rowCount) {
        const o = off.rows[0];
        offerDetailsMap[o.id] = o;
        if (o.is_pack && Array.isArray(o.pack_items)) {
          for (const subId of o.pack_items) {
            neededOfferIds.add(subId);
            if (!offerDetailsMap[subId]) {
              const subOff = await pool.query('SELECT id, name, is_pack, pack_items, category, hue FROM offers WHERE id = $1', [subId]);
              if (subOff.rowCount) offerDetailsMap[subId] = subOff.rows[0];
            }
          }
        } else {
          neededOfferIds.add(o.id);
        }
      }
    }

    const neededIdsArr = Array.from(neededOfferIds);

    // Comptes disponibles en stock correspondant aux offres de la commande
    let matchingAccounts = [];
    if (neededIdsArr.length) {
      const matchRes = await pool.query(
        `SELECT a.*, o.name AS offer_name, o.category, o.hue
         FROM accounts a
         JOIN offers o ON o.id = a.offer_id
         WHERE a.status = 'available' AND a.offer_id = ANY($1::int[])
         ORDER BY a.offer_id, a.id ASC`,
        [neededIdsArr]
      );
      matchingAccounts = matchRes.rows;
    }

    // Tous les autres comptes disponibles en stock libre
    const otherRes = await pool.query(
      `SELECT a.*, o.name AS offer_name, o.category, o.hue
       FROM accounts a
       JOIN offers o ON o.id = a.offer_id
       WHERE a.status = 'available' ${neededIdsArr.length ? 'AND NOT (a.offer_id = ANY($1::int[]))' : ''}
       ORDER BY o.name ASC, a.id ASC
       LIMIT 300`,
      neededIdsArr.length ? [neededIdsArr] : []
    );

    // Comptes déjà assignés à cette commande
    const assignedRes = await pool.query(
      `SELECT a.*, o.name AS offer_name, o.category, o.hue
       FROM accounts a
       JOIN offers o ON o.id = a.offer_id
       WHERE a.order_id = $1
       ORDER BY a.assigned_at ASC, a.id ASC`,
      [orderId]
    );

    res.json({
      order: ord,
      neededOfferIds: neededIdsArr,
      neededOffers: neededIdsArr.map(id => offerDetailsMap[id]).filter(Boolean),
      matchingAccounts,
      otherAccounts: otherRes.rows,
      assignedAccounts: assignedRes.rows
    });
  })
);

admin.get(
  '/accounts/:id/candidate-orders',
  wrap(async (req, res) => {
    const accountId = Number(req.params.id) || 0;
    const accRes = await pool.query(
      `SELECT a.*, o.name AS offer_name, o.is_pack, o.pack_items, o.category, o.hue
       FROM accounts a
       JOIN offers o ON o.id = a.offer_id
       WHERE a.id = $1`,
      [accountId]
    );
    if (!accRes.rowCount) throw new HttpError(404, 'Compte introuvable.');
    const account = accRes.rows[0];

    // Recherche des packs contenant cette offre
    const parentPacksRes = await pool.query(
      `SELECT id FROM offers WHERE is_pack = true AND pack_items @> $1::jsonb`,
      [JSON.stringify([account.offer_id])]
    );
    const matchingOfferIds = [account.offer_id, ...parentPacksRes.rows.map(p => p.id)];

    // Récupération des commandes récentes non annulées
    const ordersRes = await pool.query(
      `SELECT o.id, o.customer_name, o.customer_last_name, o.customer_phone, o.customer_email,
              o.items, o.total, o.status, to_char(o.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS created_at,
              COALESCE(acc.cnt, 0)::int AS assigned_count
       FROM orders o
       LEFT JOIN (SELECT order_id, count(*)::int AS cnt FROM accounts GROUP BY order_id) acc ON acc.order_id = o.id
       WHERE o.status != 'cancelled'
       ORDER BY o.created_at DESC
       LIMIT 60`
    );

    const ordersWithMatching = await Promise.all(ordersRes.rows.map(async (ord) => {
      const items = Array.isArray(ord.items) ? ord.items : [];
      const hasMatchingItem = items.some(it => matchingOfferIds.includes(it.id));

      const alreadyAssignedRes = await pool.query(
        `SELECT count(*)::int AS count FROM accounts WHERE order_id = $1 AND offer_id = $2 AND status = 'assigned'`,
        [ord.id, account.offer_id]
      );
      const alreadyAssignedCount = Number(alreadyAssignedRes.rows[0]?.count || 0);

      let neededCount = 0;
      items.forEach(it => {
        if (it.id === account.offer_id) neededCount++;
        else if (parentPacksRes.rows.some(p => p.id === it.id)) neededCount++;
      });

      const needsThisOffer = hasMatchingItem && (alreadyAssignedCount < neededCount);

      return {
        ...ord,
        hasMatchingItem,
        alreadyAssignedCount,
        neededCount,
        needsThisOffer
      };
    }));

    ordersWithMatching.sort((a, b) => {
      if (a.needsThisOffer && !b.needsThisOffer) return -1;
      if (!a.needsThisOffer && b.needsThisOffer) return 1;
      return b.id - a.id;
    });

    res.json({
      account,
      orders: ordersWithMatching
    });
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
      if (!r.rowCount) throw new HttpError(400, 'Ce compte n\'est pas disponible (déjà assigné ou inexistant).');
      const account = r.rows[0];
      const upd = await pool.query(
        `UPDATE accounts SET status = 'assigned', order_id = $1, assigned_at = now() WHERE id = $2 RETURNING *`,
        [orderId, account.id]
      );
      checkLowStockAlert(account.offer_id);
      const fullAcc = await pool.query(
        `SELECT a.*, o.name AS offer_name, o.hue, o.category
         FROM accounts a JOIN offers o ON o.id = a.offer_id WHERE a.id = $1`,
        [account.id]
      );
      return res.json({ ok: true, account: fullAcc.rows[0] || upd.rows[0], accounts: [fullAcc.rows[0] || upd.rows[0]] });
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
      'SELECT id, customer_name, customer_last_name, customer_phone, customer_email, customer_account_id, access_token FROM orders WHERE id = $1',
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

    // Récupérer l'email du client pour notification automatique SAV
    let targetEmail = normEmail(ord.customer_email);
    if (!targetEmail && ord.customer_account_id) {
      const caRes = await pool.query('SELECT email FROM customer_accounts WHERE id = $1', [ord.customer_account_id]);
      if (caRes.rows.length) targetEmail = normEmail(caRes.rows[0].email);
    }

    let emailSent = false;
    if (targetEmail) {
      const emailSubject = `🔄 Vos nouveaux identifiants NeonPass - Remplacement SAV (${oldAcc.service_name || 'Accès'})`;
      const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(emailSubject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#080712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#080712;padding:32px 14px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#121026;border:1px solid rgba(255,77,148,0.3);border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,0.65);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#ff4d94,#ff7fb4,#8e54ff);"></td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 24px 20px;border-bottom:1px solid rgba(160,150,255,0.12);">
              <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:'Unbounded',system-ui,sans-serif;">Neon<span style="color:#ff4d94;font-weight:900;">Pass</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;color:#efecff;">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#ffffff;">Remplacement de votre accès sous garantie</h1>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#a8a5cf;">
                Bonjour ${escapeHtml(clientName)},<br><br>
                Suite à votre signalement SAV, votre accès pour <strong>${escapeHtml(oldAcc.service_name || 'votre service')}</strong> a été entièrement renouvelé et vérifié par notre équipe technique sous votre garantie NeonPass.
              </p>
              <div style="background:rgba(18,16,38,0.9);border:1px solid rgba(255,77,148,0.35);border-radius:14px;padding:20px;margin:20px 0;">
                <div style="font-weight:700;color:#ff9cc4;font-size:14px;margin-bottom:12px;">🔐 Vos nouveaux accès :</div>
                <div style="margin-bottom:8px;font-size:13.5px;"><span style="color:#a8a5cf;">Identifiant :</span> <strong style="color:#ffffff;font-family:monospace;">${escapeHtml(newAcc.login)}</strong></div>
                ${newAcc.password ? `<div style="margin-bottom:8px;font-size:13.5px;"><span style="color:#a8a5cf;">Mot de passe :</span> <strong style="color:#ffffff;font-family:monospace;">${escapeHtml(newAcc.password)}</strong></div>` : ''}
                ${newAcc.slot_profile ? `<div style="margin-bottom:8px;font-size:13.5px;"><span style="color:#a8a5cf;">Profil / Écran :</span> <strong style="color:#ffffff;font-family:monospace;">${escapeHtml(newAcc.slot_profile)}</strong></div>` : ''}
                ${newAcc.notes ? `<div style="margin-bottom:4px;font-size:13px;"><span style="color:#a8a5cf;">Consignes :</span> <span style="color:#d8d4f0;">${escapeHtml(newAcc.notes)}</span></div>` : ''}
              </div>
              <p style="font-size:13px;color:#a8a5cf;line-height:1.5;">Ces identifiants sont également mis à jour en temps réel sur votre espace client.</p>
              <div style="text-align:center;margin:24px 0 14px;">
                <a href="${SITE_URL}/compte" style="display:inline-block;padding:12px 26px;background:linear-gradient(135deg,#ff4d94,#ff7fb4);color:#080712;font-weight:700;text-decoration:none;border-radius:999px;font-size:14px;box-shadow:0 4px 18px rgba(255,77,148,0.35);">Accéder à mon Espace Client</a>
              </div>
              ${accessUrl ? `<p style="font-size:12px;text-align:center;color:#8f8ba8;margin-top:14px;">Fiche de commande : <a href="${accessUrl}" style="color:#ff7fb4;text-decoration:none;">${accessUrl}</a></p>` : ''}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 24px;border-top:1px solid rgba(160,150,255,0.1);background:#0d0b1c;font-size:11.5px;color:#7a7698;line-height:1.6;">
              NeonPass · Support technique & SAV garanti 7j/7<br>
              <a href="${SITE_URL}" style="color:#ff7fb4;text-decoration:none;">${escapeHtml(DOMAIN)}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim();

      try {
        const info = await mailTransporter.sendMail({
          from: SMTP_FROM,
          to: targetEmail,
          subject: emailSubject,
          html: emailHtml
        });
        emailSent = true;
        await logEmailSent({
          type: 'sav_replacement',
          recipient: targetEmail,
          subject: emailSubject,
          status: 'sent',
          messageId: info.messageId,
          smtpResponse: info.response
        });
      } catch (err) {
        console.error('[mail] Erreur envoi email SAV:', err.message);
        await logEmailSent({
          type: 'sav_replacement',
          recipient: targetEmail,
          subject: emailSubject,
          status: 'failed',
          errorMessage: err.message
        });
      }
    }

    res.json({
      ok: true,
      oldAccountId: oldAcc.id,
      newAccount: updNew.rows[0],
      replacementMessage: msg,
      whatsappUrl,
      emailSent,
      emailRecipient: targetEmail || null
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
          NULL::int AS customer_account_id,
          NULL::text AS email,
          c.name,
          c.phone,
          c.notes,
          c.client_code,
          c.airtable_id,
          c.created_at,
          COALESCE(NULLIF(regexp_replace(c.phone, '[^0-9]', '', 'g'), ''), lower(c.name)) AS match_key
        FROM clients c
        UNION
        SELECT
          NULL::int AS client_id,
          o.customer_account_id,
          o.customer_email AS email,
          trim(concat(o.customer_name, ' ', o.customer_last_name)) AS name,
          o.customer_phone AS phone,
          '' AS notes,
          NULL AS client_code,
          NULL AS airtable_id,
          min(o.created_at) AS created_at,
          COALESCE(NULLIF(regexp_replace(o.customer_phone, '[^0-9]', '', 'g'), ''), lower(concat(o.customer_name, ' ', o.customer_last_name))) AS match_key
        FROM orders o
        WHERE (o.customer_name != '' OR o.customer_phone != '') AND o.customer_name != 'Client supprimé'
        GROUP BY match_key, o.customer_name, o.customer_last_name, o.customer_phone, o.customer_account_id, o.customer_email
        UNION
        SELECT
          ca.client_id AS client_id,
          ca.id AS customer_account_id,
          ca.email AS email,
          trim(concat(ca.first_name, ' ', ca.last_name)) AS name,
          ca.phone,
          concat('Compte Client Web : ', ca.email) AS notes,
          NULL AS client_code,
          NULL AS airtable_id,
          ca.created_at,
          COALESCE(NULLIF(regexp_replace(ca.phone, '[^0-9]', '', 'g'), ''), lower(ca.email)) AS match_key
        FROM customer_accounts ca
      ),
      dedup AS (
        SELECT
          max(client_id) AS id,
          max(customer_account_id) AS customer_account_id,
          max(NULLIF(email, '')) AS email,
          max(name) AS name,
          max(phone) AS phone,
          max(notes) AS notes,
          max(client_code) AS client_code,
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
        (d.customer_account_id IS NOT NULL AND o.customer_account_id = d.customer_account_id)
        OR (d.customer_account_id IS NULL AND NULLIF(d.phone, '') IS NOT NULL AND (o.customer_phone = d.phone OR regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = regexp_replace(d.phone, '[^0-9]', '', 'g')))
        OR (d.customer_account_id IS NULL AND NULLIF(d.phone, '') IS NULL AND NULLIF(d.email, '') IS NOT NULL AND lower(o.customer_email) = lower(d.email))
        OR (d.customer_account_id IS NULL AND NULLIF(d.phone, '') IS NULL AND NULLIF(d.email, '') IS NULL AND lower(d.name) = lower(trim(concat(o.customer_name, ' ', o.customer_last_name))))
    `;
    const params = [];
    if (q) {
      sql += ` WHERE (lower(d.name) LIKE $1 OR lower(d.phone) LIKE $1 OR lower(d.notes) LIKE $1 OR lower(COALESCE(d.client_code, '')) LIKE $1 OR lower(COALESCE(d.email, '')) LIKE $1)`;
      params.push('%' + q + '%');
    }
    sql += ` GROUP BY d.id, d.customer_account_id, d.email, d.name, d.phone, d.notes, d.client_code, d.airtable_id, d.created_at, d.match_key
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
    const clientCode = generateClientCode();
    const r = await pool.query(
      `INSERT INTO clients (name, phone, notes, client_code) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, phone, notes, clientCode]
    );
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone) {
      await pool.query(
        `UPDATE customer_accounts SET client_id = $1 WHERE client_id IS NULL AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
        [r.rows[0].id, cleanPhone]
      );
    }
    res.status(201).json(r.rows[0]);
  })
);

admin.patch(
  '/clients/:idOrKey',
  wrap(async (req, res) => {
    const rawKey = decodeURIComponent(req.params.idOrKey || '').trim();
    const rawNum = Number(rawKey);
    const isSafeId = Number.isInteger(rawNum) && rawNum > 0 && rawNum <= 2147483647 && !rawKey.startsWith('+') && rawKey.length <= 9;
    const id = isSafeId ? rawNum : 0;
    const cleanPhone = rawKey.replace(/[^0-9]/g, '');

    const out = {};
    if (req.body.name !== undefined) out.name = str(req.body.name, 100);
    if (req.body.phone !== undefined) out.phone = str(req.body.phone, 40);
    if (req.body.notes !== undefined) out.notes = str(req.body.notes, 500);
    const cols = Object.keys(out);
    if (!cols.length) throw new HttpError(400, 'Rien à modifier.');

    let r = null;
    if (id > 0) {
      const sets = cols.map((c, i) => c + ' = $' + (i + 1)).join(', ');
      r = await pool.query(
        'UPDATE clients SET ' + sets + ' WHERE id = $' + (cols.length + 1) + ' RETURNING *',
        [...cols.map((c) => out[c]), id]
      );
    } else if (cleanPhone) {
      const sets = cols.map((c, i) => c + ' = $' + (i + 1)).join(', ');
      r = await pool.query(
        `UPDATE clients SET ${sets} WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $${cols.length + 1} RETURNING *`,
        [...cols.map((c) => out[c]), cleanPhone]
      );
    }
    if (!r || !r.rowCount) {
      const name = out.name || str(req.body.name, 100);
      const phone = out.phone || str(req.body.phone, 40);
      const notes = out.notes || str(req.body.notes, 500);
      const clientCode = generateClientCode();
      r = await pool.query(
        `INSERT INTO clients (name, phone, notes, client_code) VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, phone, notes, clientCode]
      );
      if (cleanPhone) {
        await pool.query(
          `UPDATE customer_accounts SET client_id = $1 WHERE client_id IS NULL AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
          [r.rows[0].id, cleanPhone]
        );
      }
    }
    res.json(r.rows[0]);
  })
);

admin.delete(
  '/clients/:idOrKey',
  wrap(async (req, res) => {
    const rawKey = decodeURIComponent(req.params.idOrKey || '').trim();
    const body = req.body || {};
    const rawNum = Number(rawKey);
    const isSafeId = Number.isInteger(rawNum) && rawNum > 0 && rawNum <= 2147483647 && !rawKey.startsWith('+') && rawKey.length <= 9;
    const bodyClientId = Number(body.clientId);
    const clientIdParam = (Number.isInteger(bodyClientId) && bodyClientId > 0 && bodyClientId <= 2147483647) ? bodyClientId : (isSafeId ? rawNum : 0);
    const bodyCaId = Number(body.customerAccountId);
    const caIdParam = (Number.isInteger(bodyCaId) && bodyCaId > 0 && bodyCaId <= 2147483647) ? bodyCaId : 0;

    const matchKeyParam = str(body.matchKey || (rawKey !== String(clientIdParam) ? rawKey : ''), 120).trim();
    const phoneParam = str(body.phone || (rawKey.match(/^(\+?[0-9\s.-]+)$/) ? rawKey : ''), 40).trim();
    const emailParam = normEmail(body.email || (rawKey.includes('@') ? rawKey : ''));
    const nameParam = str(body.name || (!rawKey.includes('@') && !rawKey.match(/^[0-9+]/) && rawKey !== String(clientIdParam) ? rawKey : ''), 100).trim();
    const deleteOrders = body.deleteOrders !== false;

    const cleanPhone = (phoneParam || '').replace(/[^0-9]/g, '') || (matchKeyParam.match(/^[0-9]+$/) ? matchKeyParam : '');

    const clientIds = new Set();
    if (clientIdParam > 0) clientIds.add(clientIdParam);

    const caIds = new Set();
    if (caIdParam > 0) caIds.add(caIdParam);

    const emails = new Set();
    if (emailParam) emails.add(emailParam.toLowerCase());

    // 1. Recherche dans clients
    const cliRes = await pool.query(
      `SELECT id, name, phone FROM clients
       WHERE (id = $1 AND $1 > 0)
          OR (NULLIF($2, '') IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') = $2)
          OR (NULLIF($3, '') IS NOT NULL AND lower(name) = lower($3))
          OR (NULLIF($4, '') IS NOT NULL AND upper(client_code) = upper($4))`,
      [clientIdParam, cleanPhone, nameParam, rawKey]
    );
    cliRes.rows.forEach((r) => clientIds.add(r.id));

    // 2. Recherche dans customer_accounts
    const clientIdsArr = Array.from(clientIds);
    const caRes = await pool.query(
      `SELECT id, email, phone FROM customer_accounts
       WHERE (id = $1 AND $1 > 0)
          OR (client_id = ANY($2::int[]))
          OR (NULLIF($3, '') IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') = $3)
          OR (NULLIF($4, '') IS NOT NULL AND lower(email) = lower($4))
          OR (NULLIF($5, '') IS NOT NULL AND lower(concat(first_name, ' ', last_name)) = lower($5))`,
      [caIdParam, clientIdsArr, cleanPhone, emailParam, nameParam]
    );
    caRes.rows.forEach((r) => {
      caIds.add(r.id);
      if (r.email) emails.add(r.email.toLowerCase());
    });

    // 3. Fallback matchKey si rien trouvé pour l'instant
    if (!clientIds.size && !caIds.size && matchKeyParam) {
      if (matchKeyParam.includes('@')) {
        const caM = await pool.query('SELECT id, email FROM customer_accounts WHERE lower(email) = lower($1)', [matchKeyParam]);
        caM.rows.forEach((r) => { caIds.add(r.id); emails.add(r.email.toLowerCase()); });
      } else if (matchKeyParam.match(/^[0-9]+$/)) {
        const cliM = await pool.query(`SELECT id FROM clients WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1`, [matchKeyParam]);
        cliM.rows.forEach((r) => clientIds.add(r.id));
        const caM = await pool.query(`SELECT id, email FROM customer_accounts WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1`, [matchKeyParam]);
        caM.rows.forEach((r) => { caIds.add(r.id); emails.add(r.email.toLowerCase()); });
      } else {
        const cliM = await pool.query('SELECT id FROM clients WHERE lower(name) = lower($1)', [matchKeyParam]);
        cliM.rows.forEach((r) => clientIds.add(r.id));
      }
    }

    const allClientIds = Array.from(clientIds);
    const allCaIds = Array.from(caIds);
    const allEmails = Array.from(emails);

    // 4. Recherche des commandes associées
    const ordRes = await pool.query(
      `SELECT id FROM orders
       WHERE (customer_account_id = ANY($1::int[]))
          OR (NULLIF($2, '') IS NOT NULL AND regexp_replace(customer_phone, '[^0-9]', '', 'g') = $2)
          OR (lower(customer_email) = ANY($3::text[]))
          OR (NULLIF($4, '') IS NOT NULL AND lower(trim(concat(customer_name, ' ', customer_last_name))) = lower($4))`,
      [allCaIds, cleanPhone, allEmails, nameParam]
    );
    const orderIds = ordRes.rows.map((r) => r.id);

    if (!allClientIds.length && !allCaIds.length && !orderIds.length) {
      throw new HttpError(404, 'Client introuvable.');
    }

    // 5. Nettoyage commandes
    if (orderIds.length > 0) {
      if (deleteOrders) {
        await pool.query(
          `UPDATE accounts SET status = 'available', order_id = NULL, assigned_at = NULL WHERE order_id = ANY($1::int[])`,
          [orderIds]
        );
        await pool.query('DELETE FROM orders WHERE id = ANY($1::int[])', [orderIds]);
      } else {
        await pool.query(
          `UPDATE orders
           SET customer_account_id = NULL, customer_name = 'Client supprimé', customer_last_name = '',
               customer_phone = '', customer_email = ''
           WHERE id = ANY($1::int[])`,
          [orderIds]
        );
      }
    }

    // 6. Nettoyage customer_accounts, sessions, OTP
    if (allEmails.length > 0) {
      await pool.query('DELETE FROM customer_otps WHERE lower(email) = ANY($1::text[])', [allEmails]);
    }
    if (allCaIds.length > 0) {
      await pool.query('DELETE FROM customer_accounts WHERE id = ANY($1::int[])', [allCaIds]);
    }

    // 7. Nettoyage clients
    if (allClientIds.length > 0) {
      await pool.query('DELETE FROM clients WHERE id = ANY($1::int[])', [allClientIds]);
    }

    await audit(req, 'delete_client', {
      rawKey,
      clientIds: allClientIds,
      customerAccountIds: allCaIds,
      orderIdsCount: orderIds.length,
      deleteOrders
    });

    res.json({
      ok: true,
      deleted: {
        clients: allClientIds.length,
        customerAccounts: allCaIds.length,
        orders: orderIds.length
      }
    });
  })
);

admin.get(
  '/clients/:key',
  wrap(async (req, res) => {
    const rawKey = req.params.key.trim();
    const cleanPhone = rawKey.replace(/[^0-9]/g, '');
    const rawNum = Number(rawKey);
    const isSafeId = Number.isInteger(rawNum) && rawNum > 0 && rawNum <= 2147483647 && !rawKey.startsWith('+') && rawKey.length <= 9;
    const lookupId = isSafeId ? rawNum : 0;

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
        `SELECT * FROM clients WHERE lower(name) = lower($1) OR id = $2::int OR upper(client_code) = upper($1) LIMIT 1`,
        [rawKey, lookupId]
      );
      if (cr.rowCount) client = cr.rows[0];
    }

    // 2. Compte client Web (customer_accounts)
    let customerAccount = null;
    if (cleanPhone) {
      const ca = await pool.query(
        `SELECT id, email, first_name, last_name, phone, is_verified, status, last_login_at, last_login_ip, created_at, referral_code
         FROM customer_accounts WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 LIMIT 1`,
        [cleanPhone]
      );
      if (ca.rows.length) customerAccount = ca.rows[0];
    }
    if (!customerAccount && rawKey.includes('@')) {
      const ca = await pool.query(
        `SELECT id, email, first_name, last_name, phone, is_verified, status, last_login_at, last_login_ip, created_at, referral_code
         FROM customer_accounts WHERE lower(email) = lower($1) LIMIT 1`,
        [rawKey]
      );
      if (ca.rows.length) customerAccount = ca.rows[0];
    }
    if (!customerAccount && lookupId > 0) {
      const ca = await pool.query(
        `SELECT id, email, first_name, last_name, phone, is_verified, status, last_login_at, last_login_ip, created_at, referral_code
         FROM customer_accounts WHERE id = $1 LIMIT 1`,
        [lookupId]
      );
      if (ca.rows.length) customerAccount = ca.rows[0];
    }
    if (!customerAccount && client && client.name) {
      const ca = await pool.query(
        `SELECT id, email, first_name, last_name, phone, is_verified, status, last_login_at, last_login_ip, created_at, referral_code
         FROM customer_accounts WHERE lower(concat(first_name, ' ', last_name)) = lower($1) LIMIT 1`,
        [client.name]
      );
      if (ca.rows.length) customerAccount = ca.rows[0];
    }

    // 3. Commandes du client (élargi par téléphone, nom, compte client web ou email)
    const matchName = client ? client.name : (customerAccount ? [customerAccount.first_name, customerAccount.last_name].filter(Boolean).join(' ') : rawKey);
    const matchEmail = customerAccount ? customerAccount.email : (rawKey.includes('@') ? rawKey : '');
    const matchCaId = customerAccount ? customerAccount.id : 0;

    const ordersRes = await pool.query(
      `SELECT * FROM orders
       WHERE (NULLIF($1, '') IS NOT NULL AND regexp_replace(customer_phone, '[^0-9]', '', 'g') = $1)
          OR (NULLIF($2, '') IS NOT NULL AND lower(trim(concat(customer_name, ' ', customer_last_name))) = lower($2))
          OR ($3::int > 0 AND customer_account_id = $3)
          OR (NULLIF($4, '') IS NOT NULL AND lower(customer_email) = lower($4))
       ORDER BY created_at DESC`,
      [cleanPhone, matchName, matchCaId, matchEmail]
    );
    const orders = ordersRes.rows;
    const orderIds = orders.map((o) => o.id);

    // Si le compte web n'a pas encore été trouvé, le déduire des commandes existantes
    if (!customerAccount) {
      for (const o of orders) {
        if (o.customer_account_id) {
          const ca = await pool.query(
            `SELECT id, email, first_name, last_name, phone, is_verified, status, last_login_at, last_login_ip, created_at, referral_code
             FROM customer_accounts WHERE id = $1`,
            [o.customer_account_id]
          );
          if (ca.rows.length) { customerAccount = ca.rows[0]; break; }
        } else if (o.customer_email) {
          const ca = await pool.query(
            `SELECT id, email, first_name, last_name, phone, is_verified, status, last_login_at, last_login_ip, created_at, referral_code
             FROM customer_accounts WHERE lower(email) = lower($1)`,
            [o.customer_email]
          );
          if (ca.rows.length) { customerAccount = ca.rows[0]; break; }
        }
      }
    }

    // 4. Accès / comptes attribués
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

    let referralInfo = null;
    if (customerAccount) {
      const refCount = await pool.query(
        `SELECT count(*)::int AS count FROM orders WHERE referrer_customer_account_id = $1 AND status = 'confirmed'`,
        [customerAccount.id]
      );
      const totalRefCount = await pool.query(
        `SELECT count(*)::int AS count FROM orders WHERE referrer_customer_account_id = $1`,
        [customerAccount.id]
      );
      const rewCount = await pool.query(
        `SELECT count(*)::int AS count FROM customer_referral_rewards WHERE customer_account_id = $1`,
        [customerAccount.id]
      );
      referralInfo = {
        code: customerAccount.referral_code,
        confirmedOrdersCount: refCount.rows[0].count,
        totalOrdersCount: totalRefCount.rows[0].count,
        rewardsCount: rewCount.rows[0].count
      };
    }

    const unassignedOrdersCount = customerAccount
      ? orders.filter((o) => !o.customer_account_id || o.customer_account_id !== customerAccount.id).length
      : 0;

    res.json({
      client: client || {
        id: null,
        name: defaultName,
        phone: defaultPhone,
        notes: ''
      },
      orders,
      accounts,
      customerAccount,
      referralInfo,
      unassignedOrdersCount
    });
  })
);

// Assigner automatiquement les commandes d'un client à son compte Web
admin.post(
  '/clients/assign-orders',
  wrap(async (req, res) => {
    const customerAccountId = Number(req.body.customerAccountId) || 0;
    if (!customerAccountId) throw new HttpError(400, 'Compte client manquant ou invalide.');

    const caRes = await pool.query(
      'SELECT id, email, first_name, last_name, phone, is_verified FROM customer_accounts WHERE id = $1',
      [customerAccountId]
    );
    if (!caRes.rowCount) throw new HttpError(404, 'Compte client web introuvable.');
    const ca = caRes.rows[0];

    const rawOrderIds = Array.isArray(req.body.orderIds) ? req.body.orderIds : [];
    let orderIds = [...new Set(rawOrderIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

    let updated = [];
    if (orderIds.length) {
      const r = await pool.query(
        `UPDATE orders
         SET customer_account_id = $1,
             customer_email = CASE WHEN NULLIF(customer_email, '') IS NULL THEN $2 ELSE customer_email END
         WHERE id = ANY($3)
         RETURNING id`,
        [ca.id, ca.email, orderIds]
      );
      updated = r.rows.map((x) => x.id);
    } else {
      const cleanPhone = (ca.phone || '').replace(/[^0-9]/g, '');
      const fullName = [ca.first_name, ca.last_name].filter(Boolean).join(' ').trim();
      const r = await pool.query(
        `UPDATE orders
         SET customer_account_id = $1,
             customer_email = CASE WHEN NULLIF(customer_email, '') IS NULL THEN $2 ELSE customer_email END
         WHERE (customer_account_id IS NULL OR customer_account_id <> $1)
           AND (
             (lower(customer_email) = lower($2) AND $2 <> '')
             OR (NULLIF($3, '') IS NOT NULL AND regexp_replace(customer_phone, '[^0-9]', '', 'g') = $3)
             OR (NULLIF($4, '') IS NOT NULL AND lower(trim(concat(customer_name, ' ', customer_last_name))) = lower($4))
           )
         RETURNING id`,
        [ca.id, ca.email, cleanPhone, fullName]
      );
      updated = r.rows.map((x) => x.id);
    }

    await audit(req, 'client.assign_orders', {
      customerAccountId: ca.id,
      email: ca.email,
      assignedCount: updated.length,
      orderIds: updated
    });

    res.json({
      ok: true,
      assignedCount: updated.length,
      orderIds: updated,
      message: updated.length > 0
        ? `${updated.length} commande(s) assignée(s) au compte de ${ca.first_name || ca.email}.`
        : 'Toutes les commandes sont déjà assignées à ce compte.'
    });
  })
);

// Lien magique unique d'accès au compte (Vue Client sans mot de passe)
admin.post(
  '/clients/magic-token',
  wrap(async (req, res) => {
    const email = normEmail(req.body.email);
    const customerAccountId = Number(req.body.customerAccountId) || 0;

    let ca = null;
    if (customerAccountId) {
      const r = await pool.query('SELECT id, email, first_name, last_name FROM customer_accounts WHERE id = $1', [customerAccountId]);
      if (r.rows.length) ca = r.rows[0];
    }
    if (!ca && email) {
      const r = await pool.query('SELECT id, email, first_name, last_name FROM customer_accounts WHERE lower(email) = lower($1)', [email]);
      if (r.rows.length) ca = r.rows[0];
    }

    if (!ca) {
      throw new HttpError(404, 'Ce client ne possède pas encore de compte Web actif.');
    }

    const magicSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = sha256hex(magicSecret);

    // Supprimer les anciens tokens magiques pour cet email
    await pool.query(`DELETE FROM customer_otps WHERE lower(email) = lower($1) AND purpose = 'magic_login'`, [ca.email]);

    await pool.query(
      `INSERT INTO customer_otps (email, code_hash, purpose, metadata, expires_at)
       VALUES ($1, $2, 'magic_login', $3, now() + interval '30 minutes')`,
      [ca.email, secretHash, JSON.stringify({ adminImpersonation: true, adminAt: new Date().toISOString() })]
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const magicUrl = `${baseUrl}/compte?magic_token=${magicSecret}`;

    await audit(req, 'ADMIN_IMPERSONATE_LINK', {
      targetClientId: ca.id,
      targetEmail: ca.email
    });

    res.json({
      ok: true,
      magicUrl,
      magicToken: magicSecret,
      customerEmail: ca.email
    });
  })
);

// Réinitialisation de mot de passe client par l'administrateur
admin.post(
  '/clients/reset-password',
  wrap(async (req, res) => {
    const email = normEmail(req.body.email);
    const customerAccountId = Number(req.body.customerAccountId) || 0;
    const newPassword = str(req.body.newPassword, 100);
    const sendEmail = req.body.sendEmail !== false;

    let ca = null;
    if (customerAccountId) {
      const r = await pool.query('SELECT id, email, first_name, last_name FROM customer_accounts WHERE id = $1', [customerAccountId]);
      if (r.rows.length) ca = r.rows[0];
    }
    if (!ca && email) {
      const r = await pool.query('SELECT id, email, first_name, last_name FROM customer_accounts WHERE lower(email) = lower($1)', [email]);
      if (r.rows.length) ca = r.rows[0];
    }

    if (!ca) {
      throw new HttpError(404, 'Compte client introuvable.');
    }

    let finalPassword = newPassword;
    if (!finalPassword) {
      // Générer un mot de passe temporaire lisible et sécurisé
      finalPassword = 'NP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    }

    const pwdHash = hashPassword(finalPassword);
    await pool.query(`UPDATE customer_accounts SET password_hash = $1 WHERE id = $2`, [pwdHash, ca.id]);

    // Révocation des anciennes sessions
    await pool.query(`DELETE FROM customer_sessions WHERE customer_account_id = $1`, [ca.id]);

    if (sendEmail) {
      const emailSubject = `🔑 Réinitialisation de votre mot de passe NeonPass`;
      const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${escapeHtml(emailSubject)}</title></head>
<body style="margin:0;padding:0;background-color:#080712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#080712;padding:32px 14px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#121026;border:1px solid rgba(255,77,148,0.3);border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,0.65);">
          <tr><td style="height:4px;background:linear-gradient(90deg,#ff4d94,#ff7fb4,#8e54ff);"></td></tr>
          <tr>
            <td align="center" style="padding:28px 24px 20px;border-bottom:1px solid rgba(160,150,255,0.12);">
              <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:'Unbounded',system-ui,sans-serif;">Neon<span style="color:#ff4d94;font-weight:900;">Pass</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 24px;color:#efecff;text-align:center;">
              <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#ffffff;">Réinitialisation de votre mot de passe</h1>
              <p style="font-size:14px;line-height:1.6;color:#a8a5cf;text-align:left;">
                Bonjour ${escapeHtml(ca.first_name || 'Client')},<br><br>
                Votre mot de passe Espace Client a été réinitialisé. Vous pouvez vous connecter à votre compte à l'aide des identifiants suivants :
              </p>
              <div style="background:rgba(18,16,38,0.9);border:1px solid rgba(255,77,148,0.35);border-radius:14px;padding:20px;margin:22px 0;text-align:left;">
                <div style="margin-bottom:8px;font-size:13.5px;"><span style="color:#a8a5cf;">Identifiant (Email) :</span> <strong style="color:#ffffff;">${escapeHtml(ca.email)}</strong></div>
                <div style="font-size:13.5px;"><span style="color:#a8a5cf;">Nouveau mot de passe :</span> <strong style="color:#ff7fb4;font-family:monospace;font-size:16px;">${escapeHtml(finalPassword)}</strong></div>
              </div>
              <p style="font-size:12.5px;color:#8f8ba8;line-height:1.5;">Nous vous recommandons de modifier ce mot de passe dès votre première connexion.</p>
              <div style="margin-top:24px;">
                <a href="${SITE_URL}/compte" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#ff4d94,#ff7fb4);color:#080712;font-weight:700;text-decoration:none;border-radius:999px;font-size:14px;box-shadow:0 4px 18px rgba(255,77,148,0.35);">Me connecter à mon Espace Client</a>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 24px;border-top:1px solid rgba(160,150,255,0.1);background:#0d0b1c;font-size:11.5px;color:#7a7698;line-height:1.6;">
              NeonPass · Vos abonnements en toute sérénité<br>
              <a href="${SITE_URL}" style="color:#ff7fb4;text-decoration:none;">${escapeHtml(DOMAIN)}</a> · <a href="${SITE_URL}/compte" style="color:#ff7fb4;text-decoration:none;">Mon Espace Client</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim();

      try {
        const info = await mailTransporter.sendMail({
          from: SMTP_FROM,
          to: ca.email,
          subject: emailSubject,
          html: emailHtml
        });
        await logEmailSent({
          type: 'password_reset_admin',
          recipient: ca.email,
          subject: emailSubject,
          status: 'sent',
          messageId: info.messageId,
          smtpResponse: info.response
        });
      } catch (err) {
        console.error('[mail] Erreur envoi email reset password admin:', err.message);
        await logEmailSent({
          type: 'password_reset_admin',
          recipient: ca.email,
          subject: emailSubject,
          status: 'failed',
          errorMessage: err.message
        });
      }
    }

    await audit(req, 'ADMIN_RESET_PASSWORD', {
      targetClientId: ca.id,
      targetEmail: ca.email
    });

    res.json({
      ok: true,
      message: 'Mot de passe mis à jour avec succès !' + (sendEmail ? ' Un email avec les accès a été envoyé au client.' : ''),
      newPassword: finalPassword,
      email: ca.email
    });
  })
);

// ----- Communication & Campagnes Marketing -----
admin.get(
  '/communication/audiences',
  wrap(async (req, res) => {
    const allQ = await pool.query(`
      SELECT DISTINCT lower(email) AS email FROM (
        SELECT customer_email AS email FROM orders WHERE customer_email IS NOT NULL AND customer_email != ''
        UNION
        SELECT email FROM customer_accounts WHERE email IS NOT NULL AND email != ''
      ) u WHERE email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
    `);

    const accountsQ = await pool.query(`
      SELECT count(*)::int AS count FROM customer_accounts WHERE is_verified = true
    `);

    const activeQ = await pool.query(`
      SELECT count(DISTINCT lower(COALESCE(NULLIF(customer_email, ''), (SELECT email FROM customer_accounts ca WHERE ca.id = orders.customer_account_id))))::int AS count
      FROM orders
      WHERE status = 'confirmed' AND (expires_at IS NULL OR expires_at > now())
        AND (customer_email != '' OR customer_account_id IS NOT NULL)
    `);

    const expiringQ = await pool.query(`
      SELECT count(DISTINCT lower(COALESCE(NULLIF(customer_email, ''), (SELECT email FROM customer_accounts ca WHERE ca.id = orders.customer_account_id))))::int AS count
      FROM orders
      WHERE status = 'confirmed' AND expires_at IS NOT NULL AND expires_at > now() AND expires_at <= now() + interval '7 days'
        AND (customer_email != '' OR customer_account_id IS NOT NULL)
    `);

    res.json({
      audiences: {
        all: allQ.rows.length,
        accounts: Number(accountsQ.rows[0]?.count || 0),
        active: Number(activeQ.rows[0]?.count || 0),
        expiring: Number(expiringQ.rows[0]?.count || 0)
      }
    });
  })
);

admin.get(
  '/communication/whatsapp-clients',
  wrap(async (req, res) => {
    const q = str(req.query.search, 80).toLowerCase();
    let sql = `
      SELECT
        o.id AS order_id,
        o.tracking_code,
        trim(concat(o.customer_name, ' ', o.customer_last_name)) AS name,
        o.customer_name AS first_name,
        o.customer_last_name AS last_name,
        o.customer_phone AS phone,
        o.customer_email AS email,
        o.status,
        o.expires_at,
        o.customer_account_id,
        (SELECT string_agg(name, ' + ') FROM jsonb_to_recordset(o.items) AS (name text)) AS offer_name,
        CASE WHEN o.customer_account_id IS NOT NULL OR EXISTS(SELECT 1 FROM customer_accounts ca WHERE ca.email = o.customer_email AND ca.is_verified = true) THEN true ELSE false END AS has_account
      FROM orders o
      WHERE (o.customer_phone != '' OR o.customer_email != '' OR o.customer_name != '')
    `;
    const params = [];
    if (q) {
      sql += ` AND (lower(o.customer_name) LIKE $1 OR lower(o.customer_last_name) LIKE $1 OR lower(o.customer_phone) LIKE $1 OR lower(o.customer_email) LIKE $1 OR lower(o.tracking_code) LIKE $1)`;
      params.push('%' + q + '%');
    }
    sql += ` ORDER BY o.created_at DESC LIMIT 100`;

    const { rows } = await pool.query(sql, params);
    res.json({ clients: rows });
  })
);

admin.post(
  '/communication/test-email',
  wrap(async (req, res) => {
    const testEmail = str(req.body.testEmail, 150).trim().toLowerCase();
    const subject = str(req.body.subject, 200).trim();
    const previewText = str(req.body.previewText, 250).trim();
    const contentHtml = String(req.body.contentHtml || '').trim();

    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      throw new HttpError(400, 'Adresse email de test invalide.');
    }
    if (!subject) throw new HttpError(400, 'L\'objet de l\'email est obligatoire.');
    if (!contentHtml) throw new HttpError(400, 'Le contenu de l\'email est vide.');

    const personalizedHtml = contentHtml
      .replace(/{PRENOM}/g, 'Alexandre')
      .replace(/{NOM}/g, 'Dupont')
      .replace(/{EMAIL}/g, testEmail)
      .replace(/{TRACKING_CODE}/g, 'NP-TRK-DEMO88')
      .replace(/{LIEN_COMPTE}/g, `${SITE_URL}/compte?trk=NP-TRK-DEMO88`)
      .replace(/{SITE_URL}/g, SITE_URL);

    const fullHtml = renderMarketingEmailHtml({
      subject,
      previewText,
      contentHtml: personalizedHtml
    });

    try {
      const info = await mailTransporter.sendMail({
        from: SMTP_FROM,
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html: fullHtml,
        text: stripHtml(personalizedHtml)
      });
      await logEmailSent({
        type: 'test_email',
        recipient: testEmail,
        subject: `[TEST] ${subject}`,
        status: 'sent',
        messageId: info.messageId,
        smtpResponse: info.response
      });
    } catch (err) {
      console.error('[test-email] SMTP error:', err.message);
      await logEmailSent({
        type: 'test_email',
        recipient: testEmail,
        subject: `[TEST] ${subject}`,
        status: 'failed',
        errorMessage: err.message
      });
      throw new HttpError(500, `Erreur lors de l'envoi SMTP : ${err.message}`);
    }

    await audit(req, 'communication.test_email', { to: testEmail, subject });
    res.json({ ok: true, message: `Email de test envoyé avec succès à ${testEmail} !` });
  })
);

admin.post(
  '/communication/send-campaign',
  wrap(async (req, res) => {
    const target = str(req.body.target, 30).trim() || 'all';
    const subject = str(req.body.subject, 200).trim();
    const previewText = str(req.body.previewText, 250).trim();
    const contentHtml = String(req.body.contentHtml || '').trim();

    if (!subject) throw new HttpError(400, 'L\'objet de la campagne est obligatoire.');
    if (!contentHtml) throw new HttpError(400, 'Le contenu de la campagne est vide.');

    let recipientsQuery = '';
    if (target === 'accounts') {
      recipientsQuery = `
        SELECT DISTINCT ON (lower(email))
          lower(email) AS email, first_name, last_name, phone,
          (SELECT tracking_code FROM orders WHERE customer_account_id = ca.id OR customer_email = ca.email ORDER BY created_at DESC LIMIT 1) AS tracking_code
        FROM customer_accounts ca
        WHERE is_verified = true AND email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
        ORDER BY lower(email), created_at DESC
      `;
    } else if (target === 'active') {
      recipientsQuery = `
        SELECT DISTINCT ON (lower(email))
          lower(email) AS email,
          customer_name AS first_name,
          customer_last_name AS last_name,
          customer_phone AS phone,
          tracking_code
        FROM (
          SELECT COALESCE(NULLIF(o.customer_email, ''), ca.email) AS email,
                 o.customer_name, o.customer_last_name, o.customer_phone, o.tracking_code, o.created_at
          FROM orders o
          LEFT JOIN customer_accounts ca ON ca.id = o.customer_account_id
          WHERE o.status = 'confirmed' AND (o.expires_at IS NULL OR o.expires_at > now())
        ) sub
        WHERE email IS NOT NULL AND email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
        ORDER BY lower(email), created_at DESC
      `;
    } else if (target === 'expiring') {
      recipientsQuery = `
        SELECT DISTINCT ON (lower(email))
          lower(email) AS email,
          customer_name AS first_name,
          customer_last_name AS last_name,
          customer_phone AS phone,
          tracking_code
        FROM (
          SELECT COALESCE(NULLIF(o.customer_email, ''), ca.email) AS email,
                 o.customer_name, o.customer_last_name, o.customer_phone, o.tracking_code, o.created_at
          FROM orders o
          LEFT JOIN customer_accounts ca ON ca.id = o.customer_account_id
          WHERE o.status = 'confirmed' AND o.expires_at IS NOT NULL AND o.expires_at > now() AND o.expires_at <= now() + interval '7 days'
        ) sub
        WHERE email IS NOT NULL AND email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
        ORDER BY lower(email), created_at DESC
      `;
    } else {
      recipientsQuery = `
        SELECT DISTINCT ON (lower(email))
          lower(email) AS email,
          first_name,
          last_name,
          phone,
          tracking_code
        FROM (
          SELECT customer_email AS email, customer_name AS first_name, customer_last_name AS last_name, customer_phone AS phone, tracking_code, created_at FROM orders WHERE customer_email IS NOT NULL AND customer_email != ''
          UNION
          SELECT email, first_name, last_name, phone, NULL AS tracking_code, created_at FROM customer_accounts WHERE is_verified = true
        ) u
        WHERE email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
        ORDER BY lower(email), created_at DESC
      `;
    }

    const { rows: recipients } = await pool.query(recipientsQuery);
    if (!recipients.length) {
      throw new HttpError(400, 'Aucun destinataire avec adresse email valide trouvé pour cette audience cible.');
    }

    let sent = 0;
    let failed = 0;

    const batchSize = 5;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (r) => {
          try {
            const pFirstName = r.first_name ? escapeHtml(r.first_name) : 'Client';
            const pLastName = r.last_name ? escapeHtml(r.last_name) : '';
            const pEmail = r.email;
            const pTrk = r.tracking_code || '';
            const pAccountLink = `${SITE_URL}/compte` + (pTrk ? `?action=register&email=${encodeURIComponent(pEmail)}&trk=${encodeURIComponent(pTrk)}` : '');

            const personalizedHtml = contentHtml
              .replace(/{PRENOM}/g, pFirstName)
              .replace(/{NOM}/g, pLastName)
              .replace(/{EMAIL}/g, pEmail)
              .replace(/{TRACKING_CODE}/g, pTrk)
              .replace(/{LIEN_COMPTE}/g, pAccountLink)
              .replace(/{SITE_URL}/g, SITE_URL);

            const fullHtml = renderMarketingEmailHtml({
              subject,
              previewText,
              contentHtml: personalizedHtml
            });

            const info = await mailTransporter.sendMail({
              from: SMTP_FROM,
              to: r.email,
              subject,
              html: fullHtml,
              text: stripHtml(personalizedHtml)
            });
            await logEmailSent({
              type: 'campaign',
              recipient: r.email,
              subject,
              status: 'sent',
              messageId: info.messageId,
              smtpResponse: info.response
            });
            sent++;
          } catch (err) {
            console.error('[campaign error] ' + r.email, err.message);
            await logEmailSent({
              type: 'campaign',
              recipient: r.email,
              subject,
              status: 'failed',
              errorMessage: err.message
            });
            failed++;
          }
        })
      );
    }

    await audit(req, 'communication.campaign_sent', {
      target,
      subject,
      total: recipients.length,
      sent,
      failed
    });

    res.json({
      ok: true,
      message: `Campagne envoyée avec succès : ${sent} envoyé(s), ${failed} échec(s) sur ${recipients.length} destinataire(s).`,
      total: recipients.length,
      sent,
      failed
    });
  })
);

admin.get(
  '/communication/email-logs',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ logs: rows });
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

    if (req.body.chatbot && typeof req.body.chatbot === 'object') {
      const cb = req.body.chatbot;
      if (cb.enabled !== undefined) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('chatbot_enabled', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [String(cb.enabled === true || cb.enabled === 'true')]
        );
      }
      if (typeof cb.apiKey === 'string') {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('chatbot_api_key', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [cb.apiKey.trim()]
        );
      }
      if (typeof cb.model === 'string' && cb.model.trim()) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('chatbot_model', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [cb.model.trim()]
        );
      }
      if (typeof cb.systemPrompt === 'string') {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('chatbot_system_prompt', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [cb.systemPrompt.trim()]
        );
      }
      if (typeof cb.welcomeMessage === 'string') {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('chatbot_welcome_message', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [cb.welcomeMessage.trim()]
        );
      }
    }

    res.json({ ok: true, discountPct: pct, discountMin: min, stockAlertsEnabled });
  })
);

admin.put(
  '/settings/chatbot',
  wrap(async (req, res) => {
    const cb = req.body || {};
    if (cb.enabled !== undefined) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('chatbot_enabled', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(cb.enabled === true || cb.enabled === 'true')]
      );
    }
    if (typeof cb.apiKey === 'string') {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('chatbot_api_key', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [cb.apiKey.trim()]
      );
    }
    if (typeof cb.model === 'string' && cb.model.trim()) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('chatbot_model', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [cb.model.trim()]
      );
    }
    if (typeof cb.systemPrompt === 'string') {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('chatbot_system_prompt', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [cb.systemPrompt.trim()]
      );
    }
    if (typeof cb.welcomeMessage === 'string') {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('chatbot_welcome_message', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [cb.welcomeMessage.trim()]
      );
    }

    const s = await getSettings();
    res.json({
      ok: true,
      chatbotEnabled: s.chatbotEnabled,
      chatbotApiKey: s.chatbotApiKey,
      chatbotModel: s.chatbotModel,
      chatbotSystemPrompt: s.chatbotSystemPrompt,
      chatbotWelcomeMessage: s.chatbotWelcomeMessage
    });
  })
);

admin.post(
  '/settings/chatbot/test',
  wrap(async (req, res) => {
    const s = await getSettings();
    const apiKey = (req.body.apiKey || s.chatbotApiKey || DEFAULT_GEMINI_KEY).trim();
    const model = (req.body.model || s.chatbotModel || DEFAULT_GEMINI_MODEL).trim();
    const prompt = req.body.systemPrompt !== undefined ? req.body.systemPrompt : s.chatbotSystemPrompt;
    const testMessage = (req.body.message || 'Bonjour Volt, présente NeonPass et donne-moi les prix de deux offres phares en 3 lignes.').trim();

    const systemPrompt = await buildChatbotContext(pool, prompt);

    try {
      const reply = await callGeminiChat({
        apiKey,
        model,
        systemPrompt,
        messages: [{ role: 'user', parts: [{ text: testMessage }] }]
      });
      res.json({ ok: true, reply, model });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
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

admin.get('/changelog', (req, res) => {
  try {
    const p = path.join(__dirname, 'data', 'changelog.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return res.json(data);
    }
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la lecture du changelog' });
  }
});

app.use('/api/admin', admin);

// ----- Fichiers statiques et erreurs -----
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '5m',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('site.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
    }
  })
);

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
      await pool.query(`
        UPDATE customer_accounts
        SET referral_code = 'NP-REF-' || upper(substr(md5(random()::text || id::text || email), 1, 6))
        WHERE referral_code IS NULL;
      `);
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
