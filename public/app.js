(() => {
  'use strict';

  const DEMO_TAIL = "";
  const LABELS = { packs: 'Packs', streaming: 'Streaming', vpn: 'VPN', musique: 'Musique', tv: 'TV', logiciels: 'Logiciels' };
  const $ = (id) => document.getElementById(id);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let CFG = { waNumber: '', discountPct: 10, discountMin: 3 };
  let OFFERS = [];
  let current = 'all';
  const picked = new Set();
  let PROMO = null; // { code, pct } une fois validé par le serveur

  function durLabel(months) {
    months = Number(months) || 12;
    if (window.t) {
      if (months === 1) return window.t('dur_1_month', '1 mois');
      if (months === 6) return window.t('dur_6_months', '6 mois');
      if (months === 12) return window.t('dur_1_year', '1 an');
      return (window.t('dur_n_months', '{n} mois') || '{n} mois').replace('{n}', months);
    }
    if (months === 1) return '1 mois';
    if (months === 6) return '6 mois';
    if (months === 12) return '1 an';
    return months + ' mois';
  }

  function durPerText(months) {
    months = Number(months) || 12;
    if (window.t) {
      if (months === 1) return window.t('dur_per_month', '/ mois');
      if (months === 6) return window.t('dur_per_6_months', '/ 6 mois');
      if (months === 12) return window.t('dur_per_year', '/ an');
      return (window.t('dur_per_n_months', '/ {n} mois') || '/ {n} mois').replace('{n}', months);
    }
    if (months === 1) return '/ mois';
    if (months === 6) return '/ 6 mois';
    if (months === 12) return '/ an';
    return '/ ' + months + ' mois';
  }

  function getCategoryLabel(cat) {
    if (!cat) return '';
    const key = 'tab_' + cat;
    if (window.t && window.t(key)) return window.t(key);
    return LABELS[cat] || cat;
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const euro = (n) => num(n) + ' €';
  const waLink = (msg) => 'https://wa.me/' + CFG.waNumber + '?text=' + encodeURIComponent(msg);

  // ---------- Parrainage : Détection automatique (?ref=... ou ?parrain=...) ----------
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || urlParams.get('parrain');
    if (refCode) {
      const cleanRef = String(refCode).trim().toUpperCase();
      if (cleanRef.length >= 4 && cleanRef.length <= 32) {
        localStorage.setItem('np_ref', cleanRef);
        sessionStorage.setItem('np_ref', cleanRef);
        setTimeout(() => {
          toast('🎁 Parrainage activé (' + cleanRef + ') ! Bienvenue sur NeonPass.');
        }, 800);
      }
    }
  } catch (e) {}

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  // ---------- Commande : enregistrement en base puis redirection WhatsApp ----------
  async function placeOrder(ids, name, affiliation, phone) {
    let clientName = name != null && name !== '' ? name : '';
    let clientPhone = phone != null && phone !== '' ? phone : '';
    if (!clientName) {
      try { clientName = sessionStorage.getItem('np_name') || ''; } catch (e) {}
    }
    if (!clientPhone) {
      try { clientPhone = sessionStorage.getItem('np_phone') || ''; } catch (e) {}
    }
    let refCode = '';
    try {
      refCode = localStorage.getItem('np_ref') || sessionStorage.getItem('np_ref') || '';
    } catch (e) {}

    const popup = window.open('', '_blank'); // ouvert tout de suite pour éviter le blocage
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerIds: ids,
          name: clientName,
          phone: clientPhone,
          affiliation: affiliation || '',
          referralCode: refCode,
          promoCode: PROMO ? PROMO.code : ''
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (PROMO && /code promo/i.test(data.error || '')) setPromo(null);
        throw new Error(data.error || 'La commande a échoué.');
      }
      toast('Commande n°' + data.orderId + ' enregistrée. Ouverture de WhatsApp…');
      if (popup) popup.location.href = data.waLink || data.whatsappUrl;
      else location.href = data.waLink || data.whatsappUrl;
    } catch (e) {
      if (popup) popup.close();
      toast(e.message || 'Une erreur est survenue.', true);
    }
  }

  // ---------- Compteurs animés (valeur finale visible par défaut) ----------
  let io = null;
  function setupCounters() {
    if (!('IntersectionObserver' in window) || reduceMotion) return;
    const seen = new WeakSet();
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting || seen.has(en.target)) return;
          seen.add(en.target);
          const el = en.target;
          const to = +el.dataset.count;
          const t0 = performance.now();
          const step = (t) => {
            const k = Math.min(1, (t - t0) / 900);
            el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
            if (k < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      },
      { threshold: 0.4 }
    );
    observeCounters();
  }
  function observeCounters() {
    if (io) document.querySelectorAll('[data-count]').forEach((c) => io.observe(c));
  }

  // ---------- Ticker ----------
  function renderTicker() {
    const annualPackText = (window.t && window.t('ticker_annual_pack')) || 'Pack annuel';
    const waOrderText = (window.t && window.t('ticker_wa_order')) || 'Commande WhatsApp';
    const names = OFFERS.map((rawO) => {
      const o = (window.NeonPassI18N && window.NeonPassI18N.translateOffer) ? window.NeonPassI18N.translateOffer(rawO) : rawO;
      return o.name;
    }).concat([annualPackText, waOrderText]);
    const row = names.map((t) => '<span>' + esc(t) + '</span>').join('');
    $('ticker').innerHTML = row + row;
  }

  // ---------- Catalogue ----------
  function cardHTML(rawO, i) {
    const o = (window.NeonPassI18N && window.NeonPassI18N.translateOffer) ? window.NeonPassI18N.translateOffer(rawO) : rawO;
    const months = o.durationMonths || 12;
    const price = Number(o.price);
    const label = durLabel(months);
    const per = durPerText(months);
    const monthlyEq = months > 1 ? Math.round((price / months) * 100) / 100 : null;
    const rawSingleMsg = (window.t && window.t('wa_single_msg')) || "Bonjour, je souhaite commander l'offre « {name} » ({dur}) à {price}.";
    const msg = rawSingleMsg.replace('{name}', o.name).replace('{dur}', label).replace('{price}', euro(price)) + DEMO_TAIL;
    const save = o.was && o.was > price ? Math.round((1 - price / o.was) * 100) : 0;
    const priceVal = Math.round(price) === price ? price : null;
    const orderBtnText = (window.t && window.t('card_order_btn')) || 'Commander via WhatsApp';
    const tagText = esc(o.tag || getCategoryLabel(o.category) || '');
    const affilToggleText = (window.t && window.t('card_affil_add')) || '+ Affiliation';
    const affilPlaceholder = (window.t && window.t('card_affil_input')) || 'Nom du parrain';

    return (
      '<article class="card' + (o.isPack ? ' is-pack' : '') + '" style="--h:' + (Number(o.hue) || 330) + ';animation-delay:' + i * 60 + 'ms">' +
      '<div class="card-top">' +
        '<span class="tag">' + tagText + '</span>' +
        '<span class="card-dur-tag">' + esc(label) + '</span>' +
        (save ? '<span class="save">−' + save + ' %</span>' : '') +
      '</div>' +
      '<h3>' + esc(o.name) + '</h3>' +
      ratingHTML(o) +
      '<p class="desc">' + esc(o.description) + '</p>' +
      '<div class="price"><span class="amount">' +
      (priceVal !== null ? '<span data-count="' + priceVal + '">' + priceVal + '</span>' : esc(num(price))) +
      ' €</span><span class="per">' + esc(per) + '</span>' +
      (monthlyEq ? '<span class="monthly-equiv">(' + esc(euro(monthlyEq)) + ' ' + esc(durPerText(1)) + ')</span>' : '') +
      '</div>' +
      '<ul class="feat">' + (o.features || []).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
      '<div class="affil">' +
      '<button class="affil-toggle" type="button" aria-expanded="false" aria-controls="aff-' + o.id + '">' + esc(affilToggleText) + '</button>' +
      '<input class="affil-input" id="aff-' + o.id + '" type="text" maxlength="60" placeholder="' + esc(affilPlaceholder) + '" hidden aria-label="' + esc(affilPlaceholder) + '">' +
      '</div>' +
      '<a class="btn btn-primary order-btn" data-id="' + o.id + '" href="' + waLink(msg) + '" target="_blank" rel="noopener">' + esc(orderBtnText) + '</a>' +
      '</article>'
    );
  }

  // ---------- Avis ----------
  const starsHTML = (r) => '<span class="stars" style="--pct:' + Math.max(0, Math.min(100, (r / 5) * 100)) + '%" aria-hidden="true"></span>';
  const avisWord = (n) => n + ' ' + ((window.t && window.t('card_reviews')) || 'avis');

  function ratingHTML(o) {
    const revLabel = (window.t && window.t('card_reviews')) || 'avis';
    const label = o.reviewCount
      ? 'Note ' + num(o.rating) + ' sur 5, ' + avisWord(o.reviewCount) + '. Voir les avis'
      : (window.t && window.t('reviews_leave_title')) || 'Donner le premier avis';
    return (
      '<button class="rating-row" type="button" data-reviews="' + o.id + '" aria-label="' + esc(label) + '">' +
      starsHTML(o.rating || 0) +
      (o.reviewCount ? '<b>' + esc(num(o.rating)) + '</b><u>(' + avisWord(o.reviewCount) + ')</u>' : '<u>' + esc((window.t && window.t('reviews_leave_title')) || 'Donner le premier avis') + '</u>') +
      '</button>'
    );
  }

  let rvOffer = null;
  async function openReviews(id) {
    const o = OFFERS.find((x) => x.id === id);
    if (!o) return;
    rvOffer = o;
    $('rvTitle').textContent = o.name;
    $('rvSum').innerHTML = o.reviewCount
      ? '<strong>' + esc(num(o.rating)) + '</strong>' + starsHTML(o.rating) + '<span>' + avisWord(o.reviewCount) + '</span>'
      : '<span>Aucun avis pour le moment. Sois le premier à donner le tien.</span>';
    $('rvList').innerHTML = o.reviewCount ? '<li class="muted">Chargement…</li>' : '';
    $('rvForm').reset();
    const dlg = $('rvDlg');
    if (!dlg.open) dlg.showModal();
    if (!o.reviewCount) return;
    try {
      const list = await fetch('/api/offers/' + id + '/reviews').then((r) => r.json());
      if (rvOffer !== o) return;
      $('rvList').innerHTML = list
        .map((r) =>
          '<li><div class="rv-meta"><span>' + esc(r.author) + '</span>' + starsHTML(r.rating) +
          '<time datetime="' + esc(r.created_at) + '">' + esc(new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })) + '</time></div>' +
          '<p>' + esc(r.comment) + '</p></li>')
        .join('');
    } catch (e) {
      $('rvList').innerHTML = '<li class="muted">Impossible de charger les avis.</li>';
    }
  }

  if ($('rvClose')) $('rvClose').addEventListener('click', () => $('rvDlg') && $('rvDlg').close());
  if ($('rvDlg')) $('rvDlg').addEventListener('click', (e) => { if (e.target === $('rvDlg')) $('rvDlg').close(); });

  if ($('rvForm')) {
    $('rvForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!rvOffer) return;
      const checked = $('rvForm').querySelector('input[name="rating"]:checked');
      const body = { rating: checked ? Number(checked.value) : 0, author: $('rvAuthor') ? $('rvAuthor').value : '', comment: $('rvComment') ? $('rvComment').value : '' };
      if (!body.rating) return toast('Choisis une note en cliquant sur les étoiles.', true);
      const btn = $('rvSubmit');
      if (btn) btn.setAttribute('aria-disabled', 'true');
      try {
        const r = await fetch('/api/offers/' + rvOffer.id + '/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "L'envoi a échoué.");
        if ($('rvDlg')) $('rvDlg').close();
        toast(data.message || 'Merci pour ton avis !');
      } catch (err) {
        toast(err.message, true);
      } finally {
        if (btn) btn.removeAttribute('aria-disabled');
      }
    });
  }

  function renderGrid() {
    const grid = $('grid');
    if (!grid) return;
    const list = OFFERS.filter((o) => current === 'all' || o.category === current);
    if (!list.length) {
      grid.innerHTML = '<p class="muted">' + esc((window.t && window.t('no_offers_cat')) || 'Aucune offre dans cette catégorie pour le moment.') + '</p>';
      return;
    }
    grid.innerHTML = list.map(cardHTML).join('');
    grid.querySelectorAll('.card').forEach((c) => {
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', e.clientX - r.left + 'px');
        c.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    });
    observeCounters();
  }

  function renderTabs() {
    const el = $('tabs');
    if (!el) return;
    const cats = Object.keys(LABELS).filter((k) => OFFERS.some((o) => o.category === k));
    const allLabel = (window.t && window.t('tab_all')) || 'Tous';
    const tabs = [['all', allLabel]].concat(cats.map((k) => [k, getCategoryLabel(k)]));
    el.innerHTML = tabs
      .map(([k, label]) => '<button class="tab" role="tab" type="button" data-k="' + k + '" aria-selected="' + (k === current) + '">' + esc(label) + '</button>')
      .join('');
  }

  // ---------- Composeur de pack ----------
  let shown = 0;
  let raf = 0;
  function animateTotal(to) {
    const el = $('rcTotal');
    if (!el) return;
    cancelAnimationFrame(raf);
    if (reduceMotion) { el.textContent = euro(to); shown = to; return; }
    const from = shown;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = euro(Math.round((from + (to - from) * e) * 100) / 100);
      if (k < 1) raf = requestAnimationFrame(step);
      else shown = to;
    };
    raf = requestAnimationFrame(step);
  }

  // Toutes les offres sont combinables dans le sur-mesure, packs en premier
  function composable() {
    return OFFERS.filter((o) => o.isPack).concat(OFFERS.filter((o) => !o.isPack));
  }

  function renderChips() {
    const el = $('chips');
    if (!el) return;
    const packLabel = (window.t && window.t('tab_packs')) || 'Pack';
    el.innerHTML = composable()
      .map((rawO) => {
        const o = (window.NeonPassI18N && window.NeonPassI18N.translateOffer) ? window.NeonPassI18N.translateOffer(rawO) : rawO;
        const p = Number(o.price);
        const d = durLabel(o.durationMonths || 12);
        return '<button class="chip' + (o.isPack ? ' chip-pack' : '') + '" type="button" data-id="' + o.id + '" aria-pressed="' + picked.has(o.id) + '">' +
          (o.isPack ? '<em>' + esc(packLabel) + '</em>' : '') + esc(o.name) + ' <small>' + esc(euro(p)) + ' · ' + esc(d) + '</small></button>';
      })
      .join('');
  }

  function updateComposer() {
    const rcList = $('rcList');
    if (!rcList) return;
    const items = composable().filter((o) => picked.has(o.id));
    const sum = items.reduce((s, o) => s + Number(o.price), 0);
    const dMin = CFG.discountMin || 3;
    const dPct = CFG.discountPct || 10;
    const discount = items.length >= dMin && dPct > 0;
    let t = discount ? sum * (1 - dPct / 100) : sum;
    if (PROMO) t = t * (1 - PROMO.pct / 100);
    const total = Math.round(t * 100) / 100;
    const emptyMsg = (window.t && window.t('comp_empty')) || 'Sélectionne au moins un service.';
    rcList.innerHTML = items.length
      ? items.map((rawO) => {
          const o = (window.NeonPassI18N && window.NeonPassI18N.translateOffer) ? window.NeonPassI18N.translateOffer(rawO) : rawO;
          const d = durLabel(o.durationMonths || 12);
          return '<li><span>' + esc(o.name) + ' <small style="color:var(--muted)">(' + esc(d) + ')</small></span><span>' + esc(euro(Number(o.price))) + '</span></li>';
        }).join('')
      : '<li class="empty">' + esc(emptyMsg) + '</li>';
    const parts = [];
    const discLabel = (window.t && window.t('comp_discount_pack')) || 'Remise pack';
    if (discount) parts.push(discLabel + ' −' + dPct + ' %');
    else if (items.length && dPct > 0) {
      const addMoreTpl = (window.t && window.t('comp_add_more')) || 'Ajoute {n} service(s) pour la remise de {pct} %';
      parts.push(addMoreTpl.replace('{n}', dMin - items.length).replace('{pct}', dPct));
    }
    if (PROMO && items.length) parts.push('code ' + PROMO.code + ' −' + PROMO.pct + ' %');
    if ($('rcDisc')) $('rcDisc').textContent = parts.join(' · ') + (items.length && sum > total ? ' (−' + euro(Math.round((sum - total) * 100) / 100) + ')' : '');
    const rcTotLbl = $('rcTotalLabel');
    if (rcTotLbl) rcTotLbl.textContent = (window.t && window.t('comp_total_order')) || 'Total commande';
    animateTotal(total);
    if ($('rcBtn')) {
      $('rcBtn').setAttribute('aria-disabled', items.length ? 'false' : 'true');
      const rawPackMsg = (window.t && window.t('wa_pack_msg')) || 'Bonjour, je souhaite composer ce pack : {items}. Total : {total}.';
      const itemsDesc = items.map((rawO) => {
        const o = (window.NeonPassI18N && window.NeonPassI18N.translateOffer) ? window.NeonPassI18N.translateOffer(rawO) : rawO;
        return o.name + ' (' + durLabel(o.durationMonths || 12) + ')';
      }).join(' + ');
      const msg = rawPackMsg.replace('{items}', itemsDesc).replace('{total}', euro(total)) + DEMO_TAIL;
      $('rcBtn').href = items.length ? waLink(msg) : '#';
      const orderBtnLabel = (window.t && window.t('comp_order_btn')) || 'Commander ce pack';
      const svg = $('rcBtn').querySelector('svg');
      if (svg) {
        $('rcBtn').innerHTML = svg.outerHTML + ' ' + esc(orderBtnLabel);
      }
    }
  }

  // ---------- Code promo ----------
  function setPromo(p) {
    PROMO = p;
    if ($('promoForm')) $('promoForm').hidden = !!p;
    if ($('promoOk')) $('promoOk').hidden = !p;
    if ($('promoBanner')) $('promoBanner').hidden = !p;
    if (p) {
      if ($('promoOkText')) $('promoOkText').textContent = '✓ ' + p.code + ' : −' + p.pct + ' %';
      if ($('promoBanner')) $('promoBanner').textContent = '✓ Code ' + p.code + ' actif : −' + p.pct + ' % sur ta commande';
    }
    try { p ? sessionStorage.setItem('np_promo', p.code) : sessionStorage.removeItem('np_promo'); } catch (e) {}
    updateComposer();
  }

  async function checkPromo(code, silent) {
    try {
      const r = await fetch('/api/promo/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Code promo invalide.');
      setPromo(data);
      if (!silent) toast('Code ' + data.code + ' appliqué : −' + data.pct + ' % sur ta commande.');
    } catch (e) {
      if (!silent) toast(e.message, true);
      else setPromo(null);
    }
  }

  if ($('promoForm')) {
    $('promoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('promoInput') ? $('promoInput').value.trim() : '';
      if (!code) return toast('Saisis un code promo.', true);
      checkPromo(code, false);
    });
  }
  if ($('promoRemove')) {
    $('promoRemove').addEventListener('click', () => {
      if ($('promoInput')) $('promoInput').value = '';
      setPromo(null);
      // Retire ?promo=… de l'URL pour qu'il ne revienne pas au rechargement
      try {
        const u = new URL(location.href);
        if (u.searchParams.has('promo')) { u.searchParams.delete('promo'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
      } catch (e) {}
      toast('Code promo retiré.');
    });
  }

  // ---------- Initialisation ----------
  function setWaLinks() {
    const rawQuestion = (window.t && window.t('wa_question_msg')) || "Bonjour, j'ai une question sur vos offres.";
    const href = waLink(rawQuestion + DEMO_TAIL);
    if ($('navWa')) $('navWa').href = href;
    if ($('floatWa')) $('floatWa').href = href;
  }

  function renderStats() {
    const cnt = $('statCount');
    if (cnt) {
      cnt.dataset.count = OFFERS.length;
      cnt.textContent = OFFERS.length;
    }
    if (OFFERS.length) {
      const min = Math.floor(Math.min(...OFFERS.map((o) => o.price)));
      const m = $('statMin');
      if (m) {
        m.dataset.count = min;
        m.textContent = min;
      }
    }
    const ow = $('offerWord');
    if (ow) {
      if (window.t) {
        ow.textContent = OFFERS.length > 1
          ? window.t('hero_offers_count_plural', 'offres disponibles')
          : window.t('hero_offers_count_singular', 'offre disponible');
      } else {
        ow.textContent = OFFERS.length > 1 ? 'offres disponibles' : 'offre disponible';
      }
    }
  }

  async function init() {
    try {
      const [cfg, offers] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/offers').then((r) => r.json())
      ]);
      CFG = cfg || {};
      OFFERS = Array.isArray(offers) ? offers : [];
    } catch (e) {
      console.error('Erreur chargement catalogue:', e);
      if ($('grid')) $('grid').innerHTML = '<div style="text-align:center;padding:30px;"><p class="muted">Le catalogue est momentanément indisponible. Réessaie dans un instant.</p><button type="button" class="btn btn-outline" style="margin-top:12px;" onclick="location.reload()">Réessayer</button></div>';
      toast('Impossible de charger le catalogue.', true);
      return;
    }

    try { setWaLinks(); } catch (e) { console.error('setWaLinks', e); }
    try { renderStats(); } catch (e) { console.error('renderStats', e); }
    try { renderTicker(); } catch (e) { console.error('renderTicker', e); }
    try { renderTabs(); } catch (e) { console.error('renderTabs', e); }
    try { renderGrid(); } catch (e) { console.error('renderGrid', e); }

    try {
      OFFERS.filter((o) => !o.isPack).slice(0, 2).forEach((o) => picked.add(o.id));
      renderChips();
      if ($('rcTotal')) $('rcTotal').textContent = euro(0);
      updateComposer();
      setupCounters();
    } catch (e) { console.error('composer setup', e); }

    // Restauration nom et téléphone saisis
    try {
      const savedName = sessionStorage.getItem('np_name');
      if (savedName && $('rcName')) $('rcName').value = savedName;
      const savedPhone = sessionStorage.getItem('np_phone');
      if (savedPhone && $('rcPhone')) $('rcPhone').value = savedPhone;
    } catch (e) {}
    if ($('rcName')) {
      $('rcName').addEventListener('input', () => {
        try { sessionStorage.setItem('np_name', $('rcName').value.trim()); } catch (e) {}
      });
    }
    if ($('rcPhone')) {
      $('rcPhone').addEventListener('input', () => {
        try { sessionStorage.setItem('np_phone', $('rcPhone').value.trim()); } catch (e) {}
      });
    }
    // Code promo : depuis l'URL (?promo=CODE) ou conservé pendant la session
    try {
      let saved = new URLSearchParams(location.search).get('promo');
      if (!saved) { try { saved = sessionStorage.getItem('np_promo'); } catch (e) {} }
      if (saved) checkPromo(saved, !new URLSearchParams(location.search).get('promo'));
    } catch (e) {}
  }

  // ---------- Événements ----------
  if ($('tabs')) {
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      current = b.dataset.k;
      $('tabs').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t === b));
      renderGrid();
    });
  }

  if ($('grid')) {
    $('grid').addEventListener('click', (e) => {
      const rvb = e.target.closest('.rating-row');
      if (rvb) { openReviews(Number(rvb.dataset.reviews)); return; }
      const t = e.target.closest('.affil-toggle');
      if (t) {
        const inp = document.getElementById(t.getAttribute('aria-controls'));
        if (!inp) return;
        const open = inp.hidden;
        inp.hidden = !open;
        t.setAttribute('aria-expanded', String(open));
        const addTxt = (window.t && window.t('card_affil_add')) || '+ Affiliation';
        const remTxt = (window.t && window.t('card_affil_remove')) || '− Affiliation';
        t.textContent = open ? remTxt : addTxt;
        if (open) inp.focus();
        return;
      }
      const b = e.target.closest('.order-btn');
      if (!b) return;
      e.preventDefault();
      const card = b.closest('.card');
      const affil = (card && card.querySelector('.affil-input')) ? card.querySelector('.affil-input').value.trim() : '';
      const name = $('rcName') ? $('rcName').value.trim() : '';
      const phone = $('rcPhone') ? $('rcPhone').value.trim() : '';
      placeOrder([Number(b.dataset.id)], name, affil, phone);
    });
  }

  if ($('chips')) {
    $('chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const id = Number(b.dataset.id);
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      b.setAttribute('aria-pressed', picked.has(id));
      updateComposer();
    });
  }

  if ($('rcBtn')) {
    $('rcBtn').addEventListener('click', (e) => {
      e.preventDefault();
      if ($('rcBtn').getAttribute('aria-disabled') === 'true') return;
      const name = $('rcName') ? $('rcName').value.trim() : '';
      const affil = $('rcAffil') ? $('rcAffil').value.trim() : '';
      const phone = $('rcPhone') ? $('rcPhone').value.trim() : '';
      placeOrder([...picked], name, affil, phone);
    });
  }

  // Écoute du changement de langue pour rafraîchir en temps réel l'interface dynamique
  window.addEventListener('languagechange', () => {
    try { setWaLinks(); } catch (_) {}
    try { renderStats(); } catch (_) {}
    try { renderTicker(); } catch (_) {}
    try { renderTabs(); } catch (_) {}
    try { renderGrid(); } catch (_) {}
    try { renderChips(); } catch (_) {}
    try { updateComposer(); } catch (_) {}
  });

  init();
})();
