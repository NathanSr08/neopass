// NeonPass Progressive Web App Controller & Responsive Navigation
(function() {
  'use strict';

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.onupdatefound = () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.onstatechange = () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] Nouvelle version prête.');
              }
            };
          };
        })
        .catch((err) => console.warn('[PWA] Service Worker registration:', err));
    });
  }

  // 2. Detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isApple = isIOS || isIPadOS;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');

  let deferredInstallPrompt = null;

  if (isStandalone) {
    document.documentElement.classList.add('is-pwa-standalone');
    sessionStorage.setItem('np_pwa_mode', '1');
  }

  // 3. Initialize UI
  function init() {
    injectStyles();
    setupResponsiveNavbar();

    if (isStandalone) {
      renderBottomNav();
    } else {
      setupInstallPrompts();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-prompt-ready'));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.documentElement.classList.add('is-pwa-standalone');
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.remove();
    showPwaToast('Application NeonPass installée avec succès !');
    setTimeout(() => renderBottomNav(), 500);
  });

  // Inject Styles for PWA and Mobile Responsive Navbar
  function injectStyles() {
    if (document.getElementById('pwaStyles')) return;
    const style = document.createElement('style');
    style.id = 'pwaStyles';
    style.textContent = `
      /* PWA Standalone adjustments */
      .is-pwa-standalone body {
        padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
        -webkit-user-select: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      .is-pwa-standalone input,
      .is-pwa-standalone textarea {
        -webkit-user-select: text;
        user-select: text;
      }

      /* Global Header Responsive Controls */
      .nav-in {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        height: 60px !important;
        padding-block: 0 !important;
      }
      .nav-actions-group {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      /* Compact Desktop Nav Links */
      .nav-links {
        display: flex !important;
        align-items: center !important;
        gap: 16px !important;
        font-size: 13.5px !important;
        font-weight: 500 !important;
        color: #a8a5cf !important;
      }
      .nav-links a {
        text-decoration: none !important;
        color: #a8a5cf !important;
        transition: color .2s ease !important;
        padding: 6px 4px !important;
        white-space: nowrap !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .nav-links a:hover, .nav-links a.active {
        color: #2be6ff !important;
      }
      .nav-live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ff4d94;
        box-shadow: 0 0 6px #ff4d94;
        display: inline-block;
        animation: pwaPulse 1.5s infinite;
      }
      @keyframes pwaPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }

      /* Animated Hamburger Menu Button */
      .nav-burger {
        display: none;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 5px;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(160, 150, 255, 0.2);
        cursor: pointer;
        padding: 0;
        z-index: 102;
        transition: all .2s ease;
      }
      .nav-burger:hover {
        background: rgba(43, 230, 255, 0.12);
        border-color: #2be6ff;
      }
      .nav-burger span {
        width: 20px;
        height: 2px;
        background: #efecff;
        border-radius: 2px;
        transition: transform .25s ease, opacity .25s ease, background .25s ease;
      }
      .nav-burger.is-open span:nth-child(1) {
        transform: translateY(7px) rotate(45deg);
        background: #2be6ff;
      }
      .nav-burger.is-open span:nth-child(2) {
        opacity: 0;
        transform: scale(0.2);
      }
      .nav-burger.is-open span:nth-child(3) {
        transform: translateY(-7px) rotate(-45deg);
        background: #2be6ff;
      }

      /* Mobile Navigation Drawer */
      .nav-drawer {
        position: fixed;
        top: 60px;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(10, 9, 24, 0.98);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        z-index: 101;
        display: flex;
        flex-direction: column;
        padding: 20px 20px calc(24px + env(safe-area-inset-bottom, 0px));
        opacity: 0;
        pointer-events: none;
        transform: translateY(-10px);
        transition: opacity .25s ease, transform .25s cubic-bezier(0.16, 1, 0.3, 1);
        overflow-y: auto;
      }
      .nav-drawer.is-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .nav-drawer-links {
        display: grid;
        gap: 8px;
        margin-bottom: 24px;
      }
      .nav-drawer-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
        text-decoration: none;
        color: #efecff;
        transition: all .2s ease;
      }
      .nav-drawer-item:hover, .nav-drawer-item:active {
        background: rgba(43, 230, 255, 0.08);
        border-color: rgba(43, 230, 255, 0.3);
        transform: translateX(4px);
        text-decoration: none;
      }
      .nav-drawer-item .drawer-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: rgba(160, 150, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: #2be6ff;
      }
      .nav-drawer-item.highlight-news .drawer-icon {
        background: rgba(255, 77, 148, 0.18);
        color: #ff4d94;
      }
      .nav-drawer-item svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      .nav-drawer-item .drawer-text {
        flex: 1;
        min-width: 0;
      }
      .nav-drawer-item strong {
        display: block;
        font-family: 'Unbounded', system-ui, sans-serif;
        font-size: 13px;
        color: #fff;
        margin-bottom: 2px;
      }
      .nav-drawer-item small {
        display: block;
        font-size: 11px;
        color: #a8a5cf;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .drawer-badge {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        background: rgba(255, 77, 148, 0.2);
        border: 1px solid #ff4d94;
        color: #ff9cc4;
        padding: 2px 7px;
        border-radius: 999px;
      }
      .drawer-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #20e3b2;
        box-shadow: 0 0 8px #20e3b2;
      }
      .nav-drawer-footer {
        margin-top: auto;
        padding-top: 18px;
        border-top: 1px solid rgba(160, 150, 255, 0.12);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .drawer-wa-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        padding: 13px;
        border-radius: 999px;
        background: linear-gradient(100deg, #ff4d94, #ff7fb4);
        color: #0a0918;
        font-family: 'Sora', system-ui, sans-serif;
        font-weight: 700;
        font-size: 14px;
        text-decoration: none;
        box-shadow: 0 4px 20px rgba(255, 77, 148, 0.4);
      }
      .drawer-wa-btn svg { width: 18px; height: 18px; fill: currentColor; }

      /* Mobile App Bottom Bar (Standalone Mode) */
      .pwa-bottom-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: calc(64px + env(safe-area-inset-bottom, 0px));
        padding-bottom: env(safe-area-inset-bottom, 0px);
        background: rgba(10, 9, 24, 0.94);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid rgba(160, 150, 255, 0.16);
        display: flex;
        justify-content: space-around;
        align-items: center;
        z-index: 9999;
      }
      .pwa-nav-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        height: 100%;
        color: #a8a5cf;
        text-decoration: none;
        font-family: 'Sora', system-ui, sans-serif;
        font-size: 11px;
        font-weight: 500;
        transition: all .2s ease;
        position: relative;
      }
      .pwa-nav-item svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
        margin-bottom: 3px;
        transition: transform .2s ease;
      }
      .pwa-nav-item:active svg {
        transform: scale(0.9);
      }
      .pwa-nav-item.active {
        color: #2be6ff;
        font-weight: 700;
      }
      .pwa-nav-item.active::after {
        content: '';
        position: absolute;
        bottom: calc(4px + env(safe-area-inset-bottom, 0px));
        width: 16px;
        height: 2px;
        border-radius: 999px;
        background: #2be6ff;
        box-shadow: 0 0 8px #2be6ff;
      }

      /* Header Install Button */
      .pwa-header-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: 999px;
        background: rgba(43, 230, 255, 0.12);
        border: 1px solid rgba(43, 230, 255, 0.35);
        color: #2be6ff;
        font-family: 'Sora', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all .2s;
        text-decoration: none;
        white-space: nowrap;
      }
      .pwa-header-btn:hover {
        background: rgba(43, 230, 255, 0.22);
        transform: translateY(-1px);
        text-decoration: none;
      }
      .pwa-header-btn svg {
        width: 15px;
        height: 15px;
        fill: currentColor;
      }

      /* Responsive Breakpoint: <= 920px (Mobile & Tablet) */
      @media (max-width: 920px) {
        .nav-links {
          display: none !important;
        }
        .nav-burger {
          display: flex !important;
        }
        #navWa {
          padding: 8px 12px !important;
          font-size: 12px !important;
        }
        #navWa span.btn-label-text {
          display: none;
        }
        .pwa-header-btn {
          padding: 7px 10px !important;
        }
        .pwa-header-btn span.btn-label-text {
          display: none;
        }
      }

      /* In Standalone Mode: clean top header on mobile */
      .is-pwa-standalone .nav-links {
        display: none !important;
      }
      .is-pwa-standalone #navWa {
        display: none !important;
      }

      /* Floating Install Banner for Mobile */
      .pwa-install-banner {
        position: fixed;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        left: 50%;
        transform: translateX(-50%) translateY(120%);
        width: min(440px, calc(100vw - 28px));
        background: linear-gradient(145deg, #181533, #0f0d24);
        border: 1px solid rgba(43, 230, 255, 0.35);
        border-radius: 18px;
        padding: 14px 16px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 20px rgba(43, 230, 255, 0.15);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        z-index: 9990;
        transition: transform .4s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .pwa-install-banner.show {
        transform: translateX(-50%) translateY(0);
      }
      .pwa-banner-icon {
        width: 44px;
        height: 44px;
        border-radius: 11px;
        flex-shrink: 0;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }
      .pwa-banner-info {
        flex: 1;
        min-width: 0;
      }
      .pwa-banner-title {
        font-family: 'Unbounded', system-ui, sans-serif;
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        margin: 0 0 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pwa-banner-desc {
        font-size: 11px;
        color: #a8a5cf;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pwa-btn-cta {
        background: linear-gradient(100deg, #ff4d94, #2be6ff);
        color: #0a0918;
        border: none;
        padding: 9px 14px;
        border-radius: 999px;
        font-family: 'Sora', system-ui, sans-serif;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        flex-shrink: 0;
        transition: transform .15s;
      }
      .pwa-btn-cta:active {
        transform: scale(0.95);
      }
      .pwa-btn-close {
        background: transparent;
        border: none;
        color: #a8a5cf;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
      }

      /* iOS Guide Modal */
      .pwa-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        z-index: 10000;
        opacity: 0;
        pointer-events: none;
        transition: opacity .3s ease;
      }
      .pwa-modal-backdrop.open {
        opacity: 1;
        pointer-events: auto;
      }
      .pwa-sheet {
        width: 100%;
        max-width: 520px;
        background: #14122c;
        border: 1px solid rgba(160, 150, 255, 0.25);
        border-radius: 24px 24px 0 0;
        padding: 24px 24px calc(24px + env(safe-area-inset-bottom, 0px));
        color: #efecff;
        transform: translateY(100%);
        transition: transform .35s cubic-bezier(0.16, 1, 0.3, 1);
        max-height: 90vh;
        overflow-y: auto;
      }
      .pwa-modal-backdrop.open .pwa-sheet {
        transform: translateY(0);
      }
      .pwa-sheet-handle {
        width: 40px;
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 999px;
        margin: 0 auto 18px;
      }
      .pwa-sheet-head {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 20px;
      }
      .pwa-sheet-icon {
        width: 52px;
        height: 52px;
        border-radius: 14px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
      }
      .pwa-sheet-head h3 {
        font-family: 'Unbounded', system-ui, sans-serif;
        font-size: 16px;
        margin: 0 0 4px;
        color: #fff;
      }
      .pwa-sheet-head p {
        font-size: 12px;
        color: #a8a5cf;
        margin: 0;
      }
      .pwa-steps {
        display: grid;
        gap: 12px;
        margin-bottom: 22px;
      }
      .pwa-step-row {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        padding: 12px 14px;
      }
      .pwa-step-num {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #ff4d94;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
      }
      .pwa-step-text {
        font-size: 13px;
        line-height: 1.5;
        color: #d8d4f0;
      }
      .pwa-step-text strong {
        color: #fff;
      }
      .pwa-step-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(43, 230, 255, 0.15);
        color: #2be6ff;
        padding: 1px 6px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        margin: 0 3px;
      }
      .pwa-sheet-close {
        width: 100%;
        padding: 13px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #fff;
        font-family: 'Sora', system-ui, sans-serif;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  // 4. Setup Responsive Navbar & Hamburger Drawer
  function setupResponsiveNavbar() {
    const navIn = document.querySelector('.nav-in');
    if (!navIn) return;

    // Check if actions group exists, otherwise wrap buttons
    let actionsGroup = navIn.querySelector('.nav-actions-group');
    if (!actionsGroup) {
      actionsGroup = document.createElement('div');
      actionsGroup.className = 'nav-actions-group';

      // Move WhatsApp button into actions group if present
      const waBtn = navIn.querySelector('#navWa') || navIn.querySelector('.btn-primary');
      if (waBtn) {
        // Wrap text in span so on mobile it hides gracefully and keeps icon
        if (!waBtn.querySelector('.btn-label-text')) {
          const textNodes = Array.from(waBtn.childNodes).filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
          if (textNodes.length) {
            const span = document.createElement('span');
            span.className = 'btn-label-text';
            span.textContent = textNodes.map(n => n.textContent).join(' ').trim();
            textNodes.forEach(n => n.remove());
            waBtn.appendChild(span);
          }
        }
        actionsGroup.appendChild(waBtn);
      }
      navIn.appendChild(actionsGroup);
    }

    // Insert Hamburger button
    let burger = navIn.querySelector('.nav-burger');
    if (!burger) {
      burger = document.createElement('button');
      burger.type = 'button';
      burger.className = 'nav-burger';
      burger.setAttribute('aria-label', 'Menu de navigation');
      burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML = '<span></span><span></span><span></span>';
      actionsGroup.appendChild(burger);
    }

    // Insert Mobile Drawer
    let drawer = document.getElementById('navDrawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'navDrawer';
      drawer.className = 'nav-drawer';
      drawer.setAttribute('aria-hidden', 'true');

      drawer.innerHTML = `
        <div class="nav-drawer-links">
          <a href="/#offres" class="nav-drawer-item">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Offres & Formules</strong>
              <small>Streaming, VPN, TV et packs annuels</small>
            </div>
          </a>
          <a href="/#composer" class="nav-drawer-item">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Composer mon Pack</strong>
              <small>Créez votre formule personnalisée</small>
            </div>
          </a>
          <a href="/news" class="nav-drawer-item highlight-news">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Nouveautés & Concours</strong>
              <small>Concours Instagram en cours · Google Pro · DAZN</small>
            </div>
            <span class="drawer-badge">Live</span>
          </a>
          <a href="/suivi" class="nav-drawer-item">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Retrouver mes Accès</strong>
              <small>Espace abonné & suivi de commande</small>
            </div>
          </a>
          <a href="/status" class="nav-drawer-item">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h2v2h-2zm0-10h2v8h-2z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Statut Réseau en Direct</strong>
              <small>Disponibilité 99.98% des serveurs</small>
            </div>
            <span class="drawer-status-dot"></span>
          </a>
          <a href="/garantie" class="nav-drawer-item">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Charte de Garantie & SAV</strong>
              <small>Assistance 7j/7 et remplacement immédiat</small>
            </div>
          </a>
          <a href="/#faq" class="nav-drawer-item">
            <span class="drawer-icon">
              <svg viewBox="0 0 24 24"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
            </span>
            <div class="drawer-text">
              <strong>Foire aux Questions</strong>
              <small>Tout comprendre sur le service</small>
            </div>
          </a>
        </div>
        <div class="nav-drawer-footer">
          <a class="drawer-wa-btn" id="drawerWaBtn" href="#" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.4.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>
            <span>Commander sur WhatsApp</span>
          </a>
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;font-size:12px">
            <a href="https://instagram.com/neonpass_officiel" target="_blank" rel="noopener" style="color:#ff9cc4;text-decoration:none">
              Instagram @neonpass_officiel
            </a>
            <a href="/cgv" style="color:#a8a5cf;text-decoration:none">CGV & Légal</a>
          </div>
        </div>
      `;

      // Insert right after the nav element
      const navHeader = document.querySelector('.nav') || document.querySelector('header');
      if (navHeader && navHeader.parentNode) {
        navHeader.parentNode.insertBefore(drawer, navHeader.nextSibling);
      } else {
        document.body.appendChild(drawer);
      }
    }

    // Toggle logic
    function setDrawerState(open) {
      burger.classList.toggle('is-open', open);
      drawer.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
      document.body.style.overflow = open ? 'hidden' : '';
    }

    burger.onclick = (e) => {
      e.stopPropagation();
      setDrawerState(!drawer.classList.contains('is-open'));
    };

    drawer.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => setDrawerState(false));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
        setDrawerState(false);
      }
    });

    // Populate WhatsApp link
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d && d.waNumber) {
        const waLink = 'https://wa.me/' + d.waNumber;
        const btn = document.getElementById('drawerWaBtn');
        if (btn) btn.href = waLink;
      }
    }).catch(() => {});
  }

  // 5. Render Mobile App Bottom Bar (Standalone Mode)
  function renderBottomNav() {
    if (document.getElementById('pwaBottomNav')) return;

    const nav = document.createElement('nav');
    nav.id = 'pwaBottomNav';
    nav.className = 'pwa-bottom-bar';
    nav.setAttribute('aria-label', 'Navigation application');

    const path = window.location.pathname;
    const isHome = path === '/' || path === '';
    const isNews = path === '/news' || path === '/nouveautes';
    const isSuivi = path === '/suivi';

    nav.innerHTML = `
      <a href="/#offres" class="pwa-nav-item ${isHome ? 'active' : ''}">
        <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span>Offres</span>
      </a>
      <a href="/#composer" class="pwa-nav-item">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span>Pack</span>
      </a>
      <a href="/news" class="pwa-nav-item ${isNews ? 'active' : ''}">
        <svg viewBox="0 0 24 24"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span>Nouveautés</span>
      </a>
      <a href="/suivi" class="pwa-nav-item ${isSuivi ? 'active' : ''}">
        <svg viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
        <span>Mes Accès</span>
      </a>
      <a href="#" class="pwa-nav-item" id="pwaNavWa">
        <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.4.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>
        <span>WhatsApp</span>
      </a>
    `;

    document.body.appendChild(nav);

    fetch('/api/config').then(r => r.json()).then(d => {
      if (d && d.waNumber) {
        const waEl = document.getElementById('pwaNavWa');
        if (waEl) waEl.href = 'https://wa.me/' + d.waNumber;
      }
    }).catch(() => {});
  }

  // 6. Setup Install Prompts (Header button + Floating card)
  function setupInstallPrompts() {
    const actionsGroup = document.querySelector('.nav-actions-group');
    if (actionsGroup && !document.getElementById('pwaHeaderInstallBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'pwaHeaderInstallBtn';
      btn.className = 'pwa-header-btn';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
        <span class="btn-label-text">Installer l'App</span>
      `;
      btn.addEventListener('click', triggerInstallFlow);

      // Prepend in actions group so WhatsApp is on right
      actionsGroup.insertBefore(btn, actionsGroup.firstChild);
    }

    const dismissedUntil = Number(localStorage.getItem('np_pwa_dismissed') || 0);
    const now = Date.now();
    if (now < dismissedUntil) return;

    setTimeout(() => {
      if (isStandalone) return;
      renderFloatingBanner();
    }, 3200);
  }

  function renderFloatingBanner() {
    if (document.getElementById('pwaInstallBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.className = 'pwa-install-banner';
    banner.innerHTML = `
      <img src="/logo-192.png" alt="NeonPass" class="pwa-banner-icon">
      <div class="pwa-banner-info">
        <div class="pwa-banner-title">Installer NeonPass</div>
        <p class="pwa-banner-desc">Application rapide · Écran d'accueil</p>
      </div>
      <button type="button" class="pwa-btn-cta" id="pwaBannerActionBtn">Installer</button>
      <button type="button" class="pwa-btn-close" id="pwaBannerCloseBtn" aria-label="Fermer">✕</button>
    `;

    document.body.appendChild(banner);
    setTimeout(() => banner.classList.add('show'), 50);

    banner.querySelector('#pwaBannerActionBtn').addEventListener('click', triggerInstallFlow);
    banner.querySelector('#pwaBannerCloseBtn').addEventListener('click', () => {
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 400);
      localStorage.setItem('np_pwa_dismissed', String(Date.now() + (4 * 86400000)));
    });
  }

  // 7. Install Trigger
  function triggerInstallFlow() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          deferredInstallPrompt = null;
          const banner = document.getElementById('pwaInstallBanner');
          if (banner) banner.remove();
        }
      });
      return;
    }

    openIosGuideModal();
  }

  function openIosGuideModal() {
    let backdrop = document.getElementById('pwaModalBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'pwaModalBackdrop';
      backdrop.className = 'pwa-modal-backdrop';

      backdrop.innerHTML = `
        <div class="pwa-sheet">
          <div class="pwa-sheet-handle"></div>
          <div class="pwa-sheet-head">
            <img src="/logo-192.png" alt="NeonPass" class="pwa-sheet-icon">
            <div>
              <h3>Installer NeonPass</h3>
              <p>Ajoutez l'application directement à votre écran d'accueil sans passer par l'App Store.</p>
            </div>
          </div>

          <div class="pwa-steps">
            <div class="pwa-step-row">
              <div class="pwa-step-num">1</div>
              <div class="pwa-step-text">
                Sur Safari, appuyez sur le bouton <strong>Partager</strong> <span class="pwa-step-icon">⎋</span> situé dans la barre en bas (ou en haut sur iPad).
              </div>
            </div>
            <div class="pwa-step-row">
              <div class="pwa-step-num">2</div>
              <div class="pwa-step-text">
                Faites défiler le menu vers le bas et appuyez sur <span class="pwa-step-icon">⊞</span> <strong>« Sur l'écran d'accueil »</strong>.
              </div>
            </div>
            <div class="pwa-step-row">
              <div class="pwa-step-num">3</div>
              <div class="pwa-step-text">
                Appuyez sur <strong>« Ajouter »</strong> en haut à droite. L'icône officielle NeonPass est maintenant installée sur votre téléphone !
              </div>
            </div>
          </div>

          <button type="button" class="pwa-sheet-close" id="pwaModalCloseBtn">J'ai compris</button>
        </div>
      `;

      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeIosGuideModal();
      });
      backdrop.querySelector('#pwaModalCloseBtn').addEventListener('click', closeIosGuideModal);
    }

    setTimeout(() => backdrop.classList.add('open'), 20);
  }

  function closeIosGuideModal() {
    const backdrop = document.getElementById('pwaModalBackdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 350);
    }
  }

  function showPwaToast(msg) {
    const t = document.createElement('div');
    t.style.cssText = `
      position:fixed;top:20px;left:50%;transform:translateX(-50%);
      background:#16142e;border:1px solid #2be6ff;color:#fff;padding:12px 24px;
      border-radius:999px;font-family:'Sora',sans-serif;font-size:13px;font-weight:600;
      box-shadow:0 10px 30px rgba(0,0,0,0.6);z-index:10001;animation:pwaFadeIn .3s ease;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .3s ease';
      setTimeout(() => t.remove(), 300);
    }, 4000);
  }

  window.NeonPassPWA = {
    install: triggerInstallFlow,
    isStandalone: () => isStandalone
  };

})();