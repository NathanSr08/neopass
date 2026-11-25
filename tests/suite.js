#!/usr/bin/env node
/**
 * ⚡ NeonPass - Suite de Tests Intégrée & Réalisable
 * 
 * Exécution :
 *   npm test
 *   ou node tests/suite.js
 */

const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const vm = require('vm');

// Résolution intelligente de l'adresse de l'API
function getAppHost() {
  if (process.env.APP_HOST) return process.env.APP_HOST;
  try {
    const out = execSync("docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' neonpass-app 2>/dev/null").toString().trim();
    const ip = out.split(' ').filter(Boolean)[0];
    if (ip) return ip;
  } catch (_) {}
  return '127.0.0.1';
}

const APP_HOST = getAppHost();
const APP_PORT = parseInt(process.env.APP_PORT || '3000', 10);

console.log(`\n⚡ Lancement de la suite de tests NeonPass (Cible: ${APP_HOST}:${APP_PORT})\n`);

// Helper HTTP
function apiRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: APP_HOST,
      port: APP_PORT,
      path,
      method,
      headers: { 'x-test-suite': 'true', ...headers }
    };

    let payload = null;
    if (data !== null) {
      payload = typeof data === 'object' ? JSON.stringify(data) : String(data);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          raw,
          json: json || raw
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Exécution SQL sécurisée dans neonpass-db
function execSql(sql) {
  try {
    const escaped = sql.replace(/"/g, '\\"');
    return execSync(`docker exec -i neonpass-db psql -U neonpass -d neonpass -t -c "${escaped}" 2>/dev/null`).toString().trim();
  } catch (e) {
    return null;
  }
}

// Couleurs console
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

let passedCount = 0;
let failedCount = 0;

async function test(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`  ⏳ ${name} ... `);
  try {
    await fn();
    const duration = Date.now() - t0;
    process.stdout.write(`\r  ${green('✔')} ${name} ${cyan(`(${duration}ms)`)}\n`);
    passedCount++;
  } catch (err) {
    const duration = Date.now() - t0;
    process.stdout.write(`\r  ${red('✖')} ${name} ${cyan(`(${duration}ms)`)}\n`);
    console.error(`     ${red('Détail de l\'échec:')} ${err.message}\n`);
    failedCount++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function runSuite() {
  const cleanupTasks = [];

  // Setup Admin Session pour les tests admin
  const adminToken = 'test_admin_suite_' + Date.now();
  const adminHash = crypto.createHash('sha256').update(adminToken).digest('hex');
  execSql(`INSERT INTO admin_sessions (token_hash, expires_at) VALUES ('${adminHash}', now() + interval '1 day');`);
  cleanupTasks.push(() => execSql(`DELETE FROM admin_sessions WHERE token_hash = '${adminHash}';`));

  const adminHeaders = {
    'X-NP-Admin': '1',
    'Cookie': `np_admin=${adminToken}`
  };

  try {
    // ----------------------------------------------------
    // TEST 1 : Catalogue et Offres
    // ----------------------------------------------------
    await test('1. Catalogue public (/api/offers) - Récupération et structure', async () => {
      const res = await apiRequest('GET', '/api/offers');
      assert(res.status === 200, `Statut attendu 200, reçu ${res.status}`);
      assert(Array.isArray(res.json), 'La réponse doit être un tableau d\'offres');
      assert(res.json.length > 0, 'Le catalogue ne doit pas être vide');
      const o = res.json[0];
      assert(o.id && o.name && o.price !== undefined, 'L\'offre doit contenir id, name et price');
    });

    // ----------------------------------------------------
    // TEST 2 : Validation des codes promotionnels
    // ----------------------------------------------------
    await test('2. Codes promo (/api/promo/check) - Rejet des faux codes & format', async () => {
      const resInvalid = await apiRequest('POST', '/api/promo/check', { code: 'FAUXCODE_INEXISTANT_999' });
      assert(resInvalid.status === 404, `Un code inexistant doit renvoyer 404, reçu ${resInvalid.status}`);

      // Création d'un code promo de test
      const testCode = 'TESTPROMO_' + Date.now();
      execSql(`INSERT INTO promo_codes (code, pct, max_uses, uses, active) VALUES ('${testCode}', 20, 10, 0, true);`);
      cleanupTasks.push(() => execSql(`DELETE FROM promo_codes WHERE code = '${testCode}';`));

      const resValid = await apiRequest('POST', '/api/promo/check', { code: testCode });
      assert(resValid.status === 200, `Statut attendu 200 pour code valide, reçu ${resValid.status}`);
      assert(resValid.json.code === testCode, 'Le code retourné doit correspondre');
      assert(resValid.json.pct === 20, 'La réduction doit être de 20%');
    });

    // ----------------------------------------------------
    // TEST 3 : Compte client, Code de parrainage & Espace /compte
    // ----------------------------------------------------
    let testCustomerId = null;
    let testCustomerEmail = `parrain_${Date.now()}@testneon.com`;
    let testReferralCode = null;
    let clientCookie = null;

    await test('3. Compte Client - Création, génération referral_code & session', async () => {
      const insertCa = execSql(`INSERT INTO customer_accounts (email, password_hash, first_name, last_name, phone, is_verified, status, referral_code) VALUES ('${testCustomerEmail}', 'hash123', 'Alex', 'Dupont', '0611223344', true, 'active', 'NP-REF-TESTALEX') RETURNING id;`);
      testCustomerId = parseInt(insertCa, 10);
      assert(testCustomerId > 0, 'Échec de création du compte client de test');
      cleanupTasks.push(() => execSql(`DELETE FROM customer_accounts WHERE id = ${testCustomerId};`));

      // Création session
      const sessToken = 'clientsess_' + Date.now();
      const sessHash = crypto.createHash('sha256').update(sessToken).digest('hex');
      execSql(`INSERT INTO customer_sessions (customer_account_id, token_hash, expires_at) VALUES (${testCustomerId}, '${sessHash}', now() + interval '1 day');`);
      cleanupTasks.push(() => execSql(`DELETE FROM customer_sessions WHERE customer_account_id = ${testCustomerId};`));
      clientCookie = `np_client_session=${sessToken}`;

      const meRes = await apiRequest('GET', '/api/client/me', null, { Cookie: clientCookie });
      assert(meRes.status === 200, `Accès à /api/client/me attendu 200, reçu ${meRes.status}`);
      assert(meRes.json.ok === true, 'Réponse ok requise');
      assert(meRes.json.referral && meRes.json.referral.code, 'Un code de parrainage unique doit être renvoyé');
      testReferralCode = meRes.json.referral.code;
    });

    // ----------------------------------------------------
    // TEST 4 : Création de commandes avec parrainage
    // ----------------------------------------------------
    const createdOrderIds = [];
    await test('4. Tunnel Commande - Liaison automatique au code parrain', async () => {
      assert(testReferralCode, 'Code parrain requis pour le test');
      const ordRes = await apiRequest('POST', '/api/orders', {
        name: 'Filleul 1',
        lastName: 'Test',
        phone: '0699887766',
        email: `filleul1_${Date.now()}@test.com`,
        referralCode: testReferralCode,
        offerIds: [6]
      });

      assert(ordRes.status === 201, `Commande créée attendue 201, reçu ${ordRes.status}`);
      assert(ordRes.json.orderId, 'Un ID de commande doit être généré');
      const orderId = ordRes.json.orderId;
      createdOrderIds.push(orderId);
      cleanupTasks.push(() => execSql(`DELETE FROM orders WHERE id = ${orderId};`));

      // Vérification en base
      const refCheck = execSql(`SELECT referrer_customer_account_id FROM orders WHERE id = ${orderId};`);
      assert(parseInt(refCheck, 10) === testCustomerId, `Le parrain ID (${testCustomerId}) doit être lié à la commande`);
    });

    // ----------------------------------------------------
    // TEST 5 : Palier de parrainage (5 commandes validées = Bon -50%)
    // ----------------------------------------------------
    await test('5. Parrainage - Déblocage automatique du bon -50% dès 5 commandes confirmées', async () => {
      // Création des commandes 2 à 5
      for (let i = 2; i <= 5; i++) {
        const r = await apiRequest('POST', '/api/orders', {
          name: `Filleul ${i}`,
          lastName: 'Test',
          phone: `069988770${i}`,
          email: `filleul${i}_${Date.now()}@test.com`,
          referralCode: testReferralCode,
          offerIds: [6]
        });
        assert(r.status === 201 && r.json.orderId, `Échec création commande ${i}`);
        createdOrderIds.push(r.json.orderId);
        cleanupTasks.push(() => execSql(`DELETE FROM orders WHERE id = ${r.json.orderId};`));
      }

      // Confirmation des 5 commandes via Admin
      for (const oid of createdOrderIds) {
        const patchRes = await apiRequest('PATCH', `/api/admin/orders/${oid}`, { status: 'confirmed' }, adminHeaders);
        assert(patchRes.status === 200, `Échec confirmation commande #${oid}`);
      }

      // Vérification sur le compte du parrain
      const meRes = await apiRequest('GET', '/api/client/me', null, { Cookie: clientCookie });
      assert(meRes.json.referral.confirmedOrdersCount === 5, `Attendu 5 commandes validées, reçu ${meRes.json.referral.confirmedOrdersCount}`);
      assert(meRes.json.referral.rewards && meRes.json.referral.rewards.length >= 1, 'Au moins 1 récompense doit être débloquée');

      const activeReward = meRes.json.referral.activeReward;
      assert(activeReward && activeReward.pct === 50, 'Le bon débloqué doit offrir 50% de remise');
      assert(activeReward.promoCode.startsWith('PARRAIN50-'), `Le code promo doit débuter par PARRAIN50-, reçu: ${activeReward.promoCode}`);

      // Test de validité du code promo généré
      const promoTest = await apiRequest('POST', '/api/promo/check', { code: activeReward.promoCode });
      assert(promoTest.status === 200 && promoTest.json.pct === 50, 'Le code promo doit être immédiatement actif à 50%');
      cleanupTasks.push(() => execSql(`DELETE FROM promo_codes WHERE code = '${activeReward.promoCode}';`));
    });

    // ----------------------------------------------------
    // TEST 6 : Assignation automatique des commandes au compte client
    // ----------------------------------------------------
    await test('6. CRM Admin - Assignation automatique des commandes historiques au compte client', async () => {
      // Création de 2 commandes sans compte associé (flux WhatsApp / sans email)
      const unassignedOrders = [];
      for (let i = 1; i <= 2; i++) {
        const r = await apiRequest('POST', '/api/orders', {
          name: 'Alex',
          lastName: 'Dupont',
          phone: '0611223344',
          email: '',
          offerIds: [6]
        });
        assert(r.status === 201 && r.json.orderId, `Échec création commande sans compte ${i}`);
        unassignedOrders.push(r.json.orderId);
        cleanupTasks.push(() => execSql(`DELETE FROM orders WHERE id = ${r.json.orderId};`));
      }

      // Fiche client Admin : vérification de la détection des commandes non assignées
      const clientDetails = await apiRequest('GET', `/api/admin/clients/${encodeURIComponent(testCustomerEmail)}`, null, adminHeaders);
      assert(clientDetails.status === 200, 'Fiche client accessible');
      assert(clientDetails.json.customerAccount.is_verified === true, 'Le compte doit être reconnu comme vérifié');
      assert(clientDetails.json.unassignedOrdersCount >= 2, `Au moins 2 commandes non assignées attendues, reçu: ${clientDetails.json.unassignedOrdersCount}`);

      // Clic sur l'action d'assignation
      const assignRes = await apiRequest('POST', '/api/admin/clients/assign-orders', {
        customerAccountId: testCustomerId,
        orderIds: unassignedOrders,
        email: testCustomerEmail
      }, adminHeaders);

      assert(assignRes.status === 200, `Assignation attendue 200, reçu ${assignRes.status}`);
      assert(assignRes.json.assignedCount === 2, `Attendu 2 commandes assignées, reçu ${assignRes.json.assignedCount}`);

      // Vérification que les commandes sont maintenant dans l'espace client /compte
      const meRes = await apiRequest('GET', '/api/client/me', null, { Cookie: clientCookie });
      const clientOrderIds = meRes.json.orders.map(o => o.id);
      for (const uoid of unassignedOrders) {
        assert(clientOrderIds.includes(uoid), `La commande #${uoid} doit désormais apparaître sur le compte client`);
      }
    });

    // ----------------------------------------------------
    // TEST 7 : Sauvegarde & Restauration (SQL & JSON v2)
    // ----------------------------------------------------
    await test('7. Sauvegarde & Restauration - Volumes réels & Export JSON v2 complet', async () => {
      const statusRes = await apiRequest('GET', '/api/admin/backup/status', null, adminHeaders);
      assert(statusRes.status === 200, 'Statut de sauvegarde accessible');
      assert(statusRes.json.stats.customer_accounts !== undefined, 'Compteur customer_accounts attendu');
      assert(statusRes.json.stats.email_logs !== undefined, 'Compteur email_logs attendu');
      assert(statusRes.json.stats.db_size, 'Taille de base formatée attendue');

      const jsonRes = await apiRequest('GET', '/api/admin/backup/json', null, adminHeaders);
      assert(jsonRes.status === 200, 'Export JSON accessible');
      assert(jsonRes.json.version >= 2, `Version JSON attendue >= 2, reçu ${jsonRes.json.version}`);
      assert(jsonRes.json.tables.customer_accounts, 'Table customer_accounts attendue dans le snapshot');
      assert(jsonRes.json.tables.customer_referral_rewards, 'Table customer_referral_rewards attendue dans le snapshot');
      assert(jsonRes.json.tables.email_logs, 'Table email_logs attendue dans le snapshot');
      assert(jsonRes.json.tables.orders, 'Table orders attendue dans le snapshot');
      assert(jsonRes.json.tables.accounts, 'Table accounts attendue dans le snapshot');
    });

    // ----------------------------------------------------
    // TEST 8 : Internationalisation i18n (FR, EN, HE & RTL)
    // ----------------------------------------------------
    await test('8. Internationalisation i18n - 3 langues (FR, EN, HE), détection système & RTL', async () => {
      // 1. Accès au fichier i18n.js
      const i18nRes = await apiRequest('GET', '/i18n.js');
      assert(i18nRes.status === 200, 'Le fichier /i18n.js doit être servi avec succès');
      assert(i18nRes.raw.includes("SUPPORTED_LANGS = ['fr', 'en', 'he']"), 'Doit supporter au moins FR, EN et HE');
      assert(i18nRes.raw.includes("he: { code: 'HE', flag: '🇮🇱', name: 'עברית', dir: 'rtl' }"), 'Hébreu configuré en RTL');
      assert(i18nRes.raw.includes("navigator.languages"), 'Détection système / navigateur présente');

      // 2. Vérification présence des traductions complètes
      assert(i18nRes.raw.includes("hero_cta_offers"), 'Clé hero_cta_offers présente');
      assert(i18nRes.raw.includes("Explore Offers"), 'Traduction anglaise présente');
      assert(i18nRes.raw.includes("גלו את המבצעים"), 'Traduction hébreu présente');

      // 3. Vérification de l'intégration dans index.html
      const indexRes = await apiRequest('GET', '/');
      assert(indexRes.status === 200, 'Page d\'accueil accessible');
      assert(indexRes.raw.includes('/i18n.js'), 'index.html doit inclure /i18n.js');
      assert(indexRes.raw.includes('data-i18n="nav_offers"'), 'Attribut data-i18n="nav_offers" présent');
      assert(indexRes.raw.includes('data-i18n="hero_title_pre"'), 'Attribut data-i18n="hero_title_pre" présent');
      assert(indexRes.raw.includes('data-i18n="cat_title"'), 'Attribut data-i18n="cat_title" présent');
    });

    // ----------------------------------------------------
    // TEST 9 : Rendu effectif des produits & exécution sans erreur
    // ----------------------------------------------------
    await test('9. Rendu Catalogue Client - Exécution app.js, affichage des produits & multilingue', async () => {
      // 1. Validation syntaxique stricte des scripts clients
      const i18nCode = fs.readFileSync('public/i18n.js', 'utf8');
      const appCode = fs.readFileSync('public/app.js', 'utf8');
      const pwaCode = fs.readFileSync('public/pwa.js', 'utf8');

      new vm.Script(i18nCode, { filename: 'i18n.js' });
      new vm.Script(appCode, { filename: 'app.js' });
      new vm.Script(pwaCode, { filename: 'pwa.js' });

      // 2. Récupération des offres de production via l'API
      const offersRes = await apiRequest('GET', '/api/offers');
      assert(Array.isArray(offersRes.json) && offersRes.json.length > 0, 'Offres requises pour le test de rendu');
      const expectedOffers = offersRes.json;

      // 3. Simulation d'exécution du DOM avec app.js + i18n.js
      let renderedGridHtml = '';
      function makeDomNode(name) {
        const el = {
          _name: name,
          addEventListener: () => {},
          querySelectorAll: () => [],
          querySelector: () => null,
          setAttribute: () => {},
          removeAttribute: () => {},
          appendChild: () => {},
          insertBefore: () => {},
          classList: { add: () => {}, remove: () => {}, toggle: () => false },
          style: { setProperty: () => {} },
          dataset: {}
        };
        Object.defineProperty(el, 'innerHTML', {
          get() { return el._html || ''; },
          set(v) {
            el._html = v;
            if (name === 'grid') renderedGridHtml = v;
          }
        });
        return el;
      }

      const winListeners = {};
      const ctx = {
        window: {},
        document: {
          documentElement: { setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } },
          body: { classList: { add: () => {}, remove: () => {} } },
          querySelectorAll: () => [],
          querySelector: () => null,
          getElementById: (id) => makeDomNode(id),
          createElement: (tag) => makeDomNode(tag),
          head: { appendChild: () => {} },
          addEventListener: () => {}
        },
        localStorage: { getItem: () => null, setItem: () => {} },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        navigator: { languages: ['fr-FR', 'fr'] },
        matchMedia: () => ({ matches: false }),
        setTimeout: (cb) => setTimeout(cb, 5),
        clearTimeout: () => {},
        performance: { now: () => Date.now() },
        requestAnimationFrame: () => {},
        cancelAnimationFrame: () => {},
        MutationObserver: function() { this.observe = () => {}; },
        fetch: (url) => {
          if (url === '/api/config') return Promise.resolve({ json: () => Promise.resolve({ waNumber: '33612345678' }) });
          if (url === '/api/offers') return Promise.resolve({ json: () => Promise.resolve(expectedOffers) });
          return Promise.resolve({ json: () => Promise.resolve([]) });
        },
        console
      };
      ctx.window = ctx;
      ctx.window.dispatchEvent = (e) => {
        (winListeners[e.type] || []).forEach(fn => fn(e));
      };
      ctx.window.addEventListener = (type, fn) => {
        winListeners[type] = winListeners[type] || [];
        winListeners[type].push(fn);
      };
      ctx.window.CustomEvent = function(type, detail) { this.type = type; this.detail = detail; };

      vm.createContext(ctx);
      vm.runInContext(i18nCode, ctx);
      vm.runInContext(appCode, ctx);

      // Laisser le cycle async d'initialisation se résoudre
      await new Promise(r => setTimeout(r, 60));

      // 4. Vérifications que les produits sont bien affichés
      const cardCount = (renderedGridHtml.match(/<article class="card/g) || []).length;
      assert(cardCount === expectedOffers.length, `Le catalogue doit afficher exactement ${expectedOffers.length} produits, trouvé ${cardCount}`);
      assert(renderedGridHtml.includes('Commander via WhatsApp'), 'Bouton de commande en français présent');

      // 5. Bascule en anglais et vérification de la réactivité du catalogue
      ctx.window.NeonPassI18N.setLanguage('en');
      assert(renderedGridHtml.includes('Order via WhatsApp'), 'Le catalogue doit basculer les boutons en anglais');

      // 6. Bascule en hébreu et vérification de la réactivité du catalogue
      ctx.window.NeonPassI18N.setLanguage('he');
      assert(renderedGridHtml.includes('להזמנה בוואטסאפ'), 'Le catalogue doit basculer les boutons en hébreu');
    });

    // ----------------------------------------------------
    // TEST 10 : Stock & Attribution (Attribution Automatique vs Spécifique)
    // ----------------------------------------------------
    await test('10. Stock & Attribution - Attribution automatique vs Stock spécifique à une commande', async () => {
      // 1. Création d'une offre dédiée pour le test
      const testSlug = 'svc-stock-test-' + Date.now();
      const insertOfferSql = `INSERT INTO offers (slug, name, category, price, is_pack, active) VALUES ('${testSlug}', 'Service Test Stock', 'streaming', 25.00, false, true) RETURNING id;`;
      const offerId = parseInt(execSql(insertOfferSql), 10);
      assert(offerId > 0, 'Offre de test stock créée');
      cleanupTasks.push(() => execSql(`DELETE FROM offers WHERE id = ${offerId};`));

      // 2. Création de 2 comptes distincts dans le stock (Compte A pour auto, Compte B pour spécifique)
      const accALogin = 'auto_' + Date.now() + '@test.com';
      const accBLogin = 'specific_' + Date.now() + '@test.com';
      const insertAccASql = `INSERT INTO accounts (offer_id, service_name, login, password, slot_profile, status) VALUES (${offerId}, 'Service Test Stock', '${accALogin}', 'pwdAuto123', 'Slot Auto 1', 'available') RETURNING id;`;
      const insertAccBSql = `INSERT INTO accounts (offer_id, service_name, login, password, slot_profile, status) VALUES (${offerId}, 'Service Test Stock', '${accBLogin}', 'pwdSpec456', 'Slot VIP 2', 'available') RETURNING id;`;
      const accAId = parseInt(execSql(insertAccASql), 10);
      const accBId = parseInt(execSql(insertAccBSql), 10);
      assert(accAId > 0 && accBId > 0, 'Les deux comptes de test doivent être insérés');
      cleanupTasks.push(() => execSql(`DELETE FROM accounts WHERE id IN (${accAId}, ${accBId});`));

      // 3. Création d'une commande test contenant cette offre
      const testToken = 'tok_stock_' + Date.now();
      const insertOrdSql = `INSERT INTO orders (customer_name, customer_phone, items, total, status, access_token) VALUES ('Test Stock User', '0600112233', '[{"id": ${offerId}, "name": "Service Test Stock", "price": 25}]'::jsonb, 25.00, 'confirmed', '${testToken}') RETURNING id;`;
      const orderId = parseInt(execSql(insertOrdSql), 10);
      assert(orderId > 0, 'Commande de test créée');
      cleanupTasks.push(() => execSql(`DELETE FROM orders WHERE id = ${orderId};`));

      // 4. Test endpoint matching-accounts (suggestion des stocks pour cette commande)
      const matchRes = await apiRequest('GET', `/api/admin/orders/${orderId}/matching-accounts`, null, adminHeaders);
      assert(matchRes.status === 200, `Statut 200 attendu pour matching-accounts, reçu ${matchRes.status}`);
      assert(Array.isArray(matchRes.json.matchingAccounts), 'matchingAccounts doit être un tableau');
      const matchingIds = matchRes.json.matchingAccounts.map(a => a.id);
      assert(matchingIds.includes(accAId) && matchingIds.includes(accBId), 'Les deux comptes en stock doivent être détectés comme correspondants');

      // 5. Test endpoint candidate-orders (suggestion des commandes pour un compte de stock précis)
      const candRes = await apiRequest('GET', `/api/admin/accounts/${accBId}/candidate-orders`, null, adminHeaders);
      assert(candRes.status === 200, `Statut 200 attendu pour candidate-orders, reçu ${candRes.status}`);
      assert(Array.isArray(candRes.json.orders), 'orders doit être un tableau');
      const candOrder = candRes.json.orders.find(o => o.id === orderId);
      assert(candOrder && candOrder.needsThisOffer === true, 'La commande doit être identifiée comme en attente de ce compte');

      // 6. Test ATTRIBUTION SPÉCIFIQUE : assigner manuellement le compte B (accBId)
      const assignSpecRes = await apiRequest('POST', `/api/admin/orders/${orderId}/assign-account`, { accountId: accBId }, adminHeaders);
      assert(assignSpecRes.status === 200, `Statut 200 attendu pour attribution spécifique, reçu ${assignSpecRes.status}`);
      assert(assignSpecRes.json.account.id === accBId, 'Le compte B doit être spécifiquement assigné');
      assert(assignSpecRes.json.account.login === accBLogin, 'Le login du compte assigné doit être celui du compte B');

      // Vérification que le compte B est passé en status "assigned" et lié à la commande
      const statusB = execSql(`SELECT status FROM accounts WHERE id = ${accBId};`);
      const orderLinkedB = execSql(`SELECT order_id FROM accounts WHERE id = ${accBId};`);
      assert(statusB === 'assigned', `Le compte B doit être passé en statut assigned, trouvé: ${statusB}`);
      assert(parseInt(orderLinkedB, 10) === orderId, `Le compte B doit être lié à la commande #${orderId}`);

      // 7. Vérification de la vue client (/api/acces/:token)
      const accessRes = await apiRequest('GET', `/api/acces/${testToken}`);
      assert(accessRes.status === 200, 'Accès client sécurisé disponible');
      assert(accessRes.json.accounts.length === 1, '1 compte doit être visible sur la fiche client');
      assert(accessRes.json.accounts[0].login === accBLogin, `Le client doit voir le compte B spécifique (${accBLogin})`);
      assert(accessRes.json.accounts[0].slotProfile === 'Slot VIP 2', 'Le slot VIP doit être visible pour le client');

      // 8. Désassignation du compte B
      const unassignRes = await apiRequest('POST', `/api/admin/orders/${orderId}/unassign-account/${accBId}`, {}, adminHeaders);
      assert(unassignRes.status === 200, 'Désassignation du compte B réussie');

      // 9. Test ATTRIBUTION AUTOMATIQUE : assigner automatiquement par offerId
      const assignAutoRes = await apiRequest('POST', `/api/admin/orders/${orderId}/assign-account`, { offerId }, adminHeaders);
      assert(assignAutoRes.status === 200, 'Attribution automatique par offerId réussie');
      assert(assignAutoRes.json.account.id === accAId, 'L\'attribution automatique doit prendre le premier compte disponible (A)');
      assert(assignAutoRes.json.account.login === accALogin, 'Le login doit être celui du compte A');

      // 10. Test endpoint Changelog (/api/changelog & /api/admin/changelog)
      const clRes = await apiRequest('GET', '/api/changelog');
      assert(clRes.status === 200, 'Le changelog public doit renvoyer HTTP 200');
      assert(Array.isArray(clRes.json) && clRes.json.length > 0, 'Le changelog doit contenir des entrées');
      assert(clRes.json[0].version === 'v2.4.1', 'La dernière version doit être v2.4.1');

      const clAdminRes = await apiRequest('GET', '/api/admin/changelog', null, adminHeaders);
      assert(clAdminRes.status === 200, 'Le changelog admin doit renvoyer HTTP 200');
      assert(Array.isArray(clAdminRes.json) && clAdminRes.json.length >= 18, 'Le changelog admin doit contenir toutes les versions');
    });

    // 11. Test Chatbot IA & Configuration
    await test('11. Assistant IA Chatbot - Configuration, prompt dynamique & endpoint /api/chat', async () => {
      // Vérification config publique
      const cfg = await apiRequest('GET', '/api/config');
      assert(cfg.status === 200, 'La configuration publique doit renvoyer 200');
      assert(cfg.json.chatbotEnabled !== undefined, 'chatbotEnabled doit être exposé dans /api/config');

      // Vérification réglages admin
      const st = await apiRequest('GET', '/api/admin/settings', null, adminHeaders);
      assert(st.status === 200, 'Les paramètres admin doivent renvoyer 200');
      assert(st.json.chatbotApiKey && st.json.chatbotApiKey.length > 10, 'La clé API Chatbot doit être configurée');
      assert(st.json.chatbotModel && st.json.chatbotModel.includes('gemini'), 'Le modèle Gemini doit être configuré');
      assert(st.json.chatbotSystemPrompt && st.json.chatbotSystemPrompt.includes('Volt'), 'Le prompt système doit contenir les instructions Volt');

      // Test mise à jour des paramètres du chatbot
      const updateRes = await apiRequest('PUT', '/api/admin/settings/chatbot', {
        enabled: true,
        welcomeMessage: '⚡ Bonjour ! Je suis Volt, votre assistant test.'
      }, adminHeaders);
      assert(updateRes.status === 200, 'Mise à jour des paramètres chatbot réussie');
      assert(updateRes.json.chatbotEnabled === true, 'Le chatbot doit rester actif');

      // Test validation requête vide
      const emptyRes = await apiRequest('POST', '/api/chat', { message: '   ' });
      assert(emptyRes.status === 400, 'Message vide doit être rejeté avec 400');

      // Test exécution chatbot avec requête de démo
      const chatRes = await apiRequest('POST', '/api/chat', {
        message: 'Donne-moi en une phrase le nom du site et ton nom.'
      });
      assert(chatRes.status === 200 || chatRes.status === 502, 'La route /api/chat doit répondre 200 ou 502 si quota Google temporaire');
      if (chatRes.status === 200) {
        assert(chatRes.json.ok === true, 'Le résultat doit être ok: true');
        assert(typeof chatRes.json.reply === 'string' && chatRes.json.reply.length > 5, 'Une réponse textuelle doit être retournée');
      }
    });

  } finally {
    // Nettoyage complet
    for (const clean of cleanupTasks.reverse()) {
      try { clean(); } catch (_) {}
    }
  }

  console.log(`\n${bold('Résultat des tests :')} ${green(`${passedCount} réussis`)}, ${failedCount > 0 ? red(`${failedCount} échoués`) : '0 échoué'}.\n`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('\n💥 Erreur fatale dans la suite de tests:', err);
  process.exit(1);
});
