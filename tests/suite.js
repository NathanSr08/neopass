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
      headers: { ...headers }
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
