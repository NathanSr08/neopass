(() => {
  'use strict';

  const DEMO_TAIL = "";
  const LABELS = { packs: 'Packs', streaming: 'Streaming', vpn: 'VPN', musique: 'Musique', tv: 'TV' };
  const $ = (id) => document.getElementById(id);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let CFG = { waNumber: '', discountPct: 10, discountMin: 3 };
  let OFFERS = [];
  let current = 'all';
  const picked = new Set();
  let PROMO = null; // { code, pct } une fois validé par le serveur

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const euro = (n) => num(n) + ' €';
  const waLink = (msg) => 'https://wa.me/' + CFG.waNumber + '?text=' + encodeURIComponent(msg);

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
  async function placeOrder(ids, name, affiliation) {
    const popup = window.open('', '_blank'); // ouvert tout de suite pour éviter le blocage
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerIds: ids, name: name || '', affiliation: affiliation || '', promoCode: PROMO ? PROMO.code : '' })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (PROMO && /code promo/i.test(data.error || '')) setPromo(null);
        throw new Error(data.error || 'La commande a échoué.');
      }
      toast('Commande n°' + data.orderId + ' enregistrée. Ouverture de WhatsApp…');
      if (popup) popup.location.href = data.whatsappUrl;
      else location.href = data.whatsappUrl;
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
    const names = OFFERS.map((o) => o.name).concat(['Pack annuel', 'Commande WhatsApp']);
    const row = names.map((t) => '<span>' + esc(t) + '</span>').join('');
    $('ticker').innerHTML = row + row;
  }

  // ---------- Catalogue ----------
  function cardHTML(o, i) {
    const msg = "Bonjour, je souhaite commander l'offre « " + o.name + ' » à ' + euro(o.price) + '/an.' + DEMO_TAIL;
    const save = o.was && o.was > o.price ? Math.round((1 - o.price / o.was) * 100) : 0;
    const price = Math.round(o.price) === o.price ? o.price : null;
    return (
      '<article class="card' + (o.isPack ? ' is-pack' : '') + '" style="--h:' + (Number(o.hue) || 330) + ';animation-delay:' + i * 60 + 'ms">' +
      '<div class="card-top"><span class="tag">' + esc(o.tag || LABELS[o.category] || '') + '</span>' +
      (save ? '<span class="save">−' + save + ' %</span>' : '') + '</div>' +
      '<h3>' + esc(o.name) + '</h3>' +
      ratingHTML(o) +
      '<p class="desc">' + esc(o.description) + '</p>' +
      '<div class="price"><span class="amount">' +
      (price !== null ? '<span data-count="' + price + '">' + price + '</span>' : esc(num(o.price))) +
      ' €</span><span class="per">/ an</span>' +
      (o.was ? '<s>valeur démo ' + esc(euro(o.was)) + '</s>' : '') + '</div>' +
      '<ul class="feat">' + (o.features || []).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
      '<div class="affil">' +
      '<button class="affil-toggle" type="button" aria-expanded="false" aria-controls="aff-' + o.id + '">+ Affiliation</button>' +
      '<input class="affil-input" id="aff-' + o.id + '" type="text" maxlength="60" placeholder="Nom du parrain" hidden aria-label="Nom de la personne qui parraine">' +
      '</div>' +
      '<a class="btn btn-primary order-btn" data-id="' + o.id + '" href="' + waLink(msg) + '" target="_blank" rel="noopener">Commander sur WhatsApp</a>' +
      '</article>'
    );
  }

  // ---------- Avis ----------
  const starsHTML = (r) => '<span class="stars" style="--pct:' + Math.max(0, Math.min(100, (r / 5) * 100)) + '%" aria-hidden="true"></span>';
  const avisWord = (n) => n + ' avis';

  function ratingHTML(o) {
    const label = o.reviewCount
      ? 'Note ' + num(o.rating) + ' sur 5, ' + avisWord(o.reviewCount) + '. Voir les avis'
      : 'Aucun avis. Donner le premier avis';
    return (
      '<button class="rating-row" type="button" data-reviews="' + o.id + '" aria-label="' + esc(label) + '">' +
      starsHTML(o.rating || 0) +
      (o.reviewCount ? '<b>' + esc(num(o.rating)) + '</b><u>(' + avisWord(o.reviewCount) + ')</u>' : '<u>Donner le premier avis</u>') +
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

  $('rvClose').addEventListener('click', () => $('rvDlg').close());
  $('rvDlg').addEventListener('click', (e) => { if (e.target === $('rvDlg')) $('rvDlg').close(); });

  $('rvForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!rvOffer) return;
    const checked = $('rvForm').querySelector('input[name="rating"]:checked');
    const body = { rating: checked ? Number(checked.value) : 0, author: $('rvAuthor').value, comment: $('rvComment').value };
    if (!body.rating) return toast('Choisis une note en cliquant sur les étoiles.', true);
    const btn = $('rvSubmit');
    btn.setAttribute('aria-disabled', 'true');
    try {
      const r = await fetch('/api/offers/' + rvOffer.id + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "L'envoi a échoué.");
      $('rvDlg').close();
      toast(data.message || 'Merci pour ton avis !');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.removeAttribute('aria-disabled');
    }
  });

  function renderGrid() {
    const list = OFFERS.filter((o) => current === 'all' || o.category === current);
    const grid = $('grid');
    if (!list.length) {
      grid.innerHTML = '<p class="muted">Aucune offre dans cette catégorie pour le moment.</p>';
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
    const cats = Object.keys(LABELS).filter((k) => OFFERS.some((o) => o.category === k));
    const tabs = [['all', 'Tout']].concat(cats.map((k) => [k, LABELS[k]]));
    $('tabs').innerHTML = tabs
      .map(([k, label]) => '<button class="tab" role="tab" type="button" data-k="' + k + '" aria-selected="' + (k === current) + '">' + esc(label) + '</button>')
      .join('');
  }

  // ---------- Composeur de pack ----------
  let shown = 0;
  let raf = 0;
  function animateTotal(to) {
    const el = $('rcTotal');
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
    $('chips').innerHTML = composable()
      .map((o) => '<button class="chip' + (o.isPack ? ' chip-pack' : '') + '" type="button" data-id="' + o.id + '" aria-pressed="' + picked.has(o.id) + '">' +
        (o.isPack ? '<em>Pack</em>' : '') + esc(o.name) + ' <small>' + esc(euro(o.price)) + '</small></button>')
      .join('');
  }

  function updateComposer() {
    const items = composable().filter((o) => picked.has(o.id));
    const sum = items.reduce((s, o) => s + o.price, 0);
    const discount = items.length >= CFG.discountMin && CFG.discountPct > 0;
    let t = discount ? sum * (1 - CFG.discountPct / 100) : sum;
    if (PROMO) t = t * (1 - PROMO.pct / 100);
    const total = Math.round(t * 100) / 100;
    $('rcList').innerHTML = items.length
      ? items.map((o) => '<li><span>' + esc(o.name) + '</span><span>' + esc(euro(o.price)) + '</span></li>').join('')
      : '<li class="empty">Sélectionne au moins un service.</li>';
    const parts = [];
    if (discount) parts.push('Remise pack −' + CFG.discountPct + ' %');
    else if (items.length && CFG.discountPct > 0) parts.push('Ajoute ' + (CFG.discountMin - items.length) + ' service(s) pour la remise de ' + CFG.discountPct + ' %');
    if (PROMO && items.length) parts.push('code ' + PROMO.code + ' −' + PROMO.pct + ' %');
    $('rcDisc').textContent = parts.join(' · ') + (items.length && sum > total ? ' (−' + euro(Math.round((sum - total) * 100) / 100) + ')' : '');
    animateTotal(total);
    $('rcBtn').setAttribute('aria-disabled', items.length ? 'false' : 'true');
    const msg =
      'Bonjour, je souhaite composer ce pack : ' + items.map((o) => o.name).join(' + ') +
      '. Total : ' + euro(total) + '/an.' + DEMO_TAIL;
    $('rcBtn').href = items.length ? waLink(msg) : '#';
  }

  // ---------- Code promo ----------
  function setPromo(p) {
    PROMO = p;
    $('promoForm').hidden = !!p;
    $('promoOk').hidden = !p;
    $('promoBanner').hidden = !p;
    if (p) {
      $('promoOkText').textContent = '✓ ' + p.code + ' : −' + p.pct + ' %';
      $('promoBanner').textContent = '✓ Code ' + p.code + ' actif : −' + p.pct + ' % sur ta commande';
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

  $('promoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('promoInput').value.trim();
    if (!code) return toast('Saisis un code promo.', true);
    checkPromo(code, false);
  });
  $('promoRemove').addEventListener('click', () => {
    $('promoInput').value = '';
    setPromo(null);
    // Retire ?promo=… de l'URL pour qu'il ne revienne pas au rechargement
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('promo')) { u.searchParams.delete('promo'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
    } catch (e) {}
    toast('Code promo retiré.');
  });

  // ---------- Initialisation ----------
  function setWaLinks() {
    const href = waLink('Bonjour, j\'ai une question sur vos offres.' + DEMO_TAIL);
    $('navWa').href = href;
    $('floatWa').href = href;
  }

  function renderStats() {
    const cnt = $('statCount');
    cnt.dataset.count = OFFERS.length;
    cnt.textContent = OFFERS.length;
    if (OFFERS.length) {
      const min = Math.floor(Math.min(...OFFERS.map((o) => o.price)));
      const m = $('statMin');
      m.dataset.count = min;
      m.textContent = min;
    }
    $('offerWord').textContent = OFFERS.length > 1 ? 'offres annuelles' : 'offre annuelle';
  }

  async function init() {
    try {
      const [cfg, offers] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/offers').then((r) => r.json())
      ]);
      CFG = cfg;
      OFFERS = offers;
    } catch (e) {
      $('grid').innerHTML = '<p class="muted">Le catalogue est momentanément indisponible. Réessaie dans un instant.</p>';
      toast('Impossible de charger le catalogue.', true);
      return;
    }
    setWaLinks();
    renderStats();
    renderTicker();
    renderTabs();
    renderGrid();
    OFFERS.filter((o) => !o.isPack).slice(0, 2).forEach((o) => picked.add(o.id));
    renderChips();
    $('rcTotal').textContent = euro(0);
    updateComposer();
    setupCounters();
    // Code promo : depuis l'URL (?promo=CODE) ou conservé pendant la session
    let saved = new URLSearchParams(location.search).get('promo');
    if (!saved) { try { saved = sessionStorage.getItem('np_promo'); } catch (e) {} }
    if (saved) checkPromo(saved, !new URLSearchParams(location.search).get('promo'));
  }

  // ---------- Événements ----------
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    current = b.dataset.k;
    $('tabs').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t === b));
    renderGrid();
  });

  $('grid').addEventListener('click', (e) => {
    const rvb = e.target.closest('.rating-row');
    if (rvb) { openReviews(Number(rvb.dataset.reviews)); return; }
    const t = e.target.closest('.affil-toggle');
    if (t) {
      const inp = document.getElementById(t.getAttribute('aria-controls'));
      const open = inp.hidden;
      inp.hidden = !open;
      t.setAttribute('aria-expanded', String(open));
      t.textContent = open ? '− Affiliation' : '+ Affiliation';
      if (open) inp.focus();
      return;
    }
    const b = e.target.closest('.order-btn');
    if (!b) return;
    e.preventDefault();
    const affil = b.closest('.card').querySelector('.affil-input').value.trim();
    placeOrder([Number(b.dataset.id)], '', affil);
  });

  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const id = Number(b.dataset.id);
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    b.setAttribute('aria-pressed', picked.has(id));
    updateComposer();
  });

  $('rcBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if ($('rcBtn').getAttribute('aria-disabled') === 'true') return;
    placeOrder([...picked], $('rcName').value, $('rcAffil').value);
  });

  init();
})();
