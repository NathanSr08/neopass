/**
 * ⚡ NeonPass - Chatbot Assistant IA Professionnel (Volt)
 * Propulsé par Google AI Studio & Gemini
 */
(function() {
  'use strict';

  // Évite les doubles initialisations
  if (window.__NEONPASS_CHATBOT_INITIALIZED__) return;
  window.__NEONPASS_CHATBOT_INITIALIZED__ = true;

  const STORAGE_KEY = 'np_chat_history_v1';
  let isChatOpen = false;
  let isSending = false;
  let chatHistory = [];
  let chatbotConfig = null;

  // Récupération de la langue active
  function getLang() {
    return (window.I18N && typeof window.I18N.getLang === 'function') ? window.I18N.getLang() : (localStorage.getItem('np_lang') || 'fr');
  }

  function isRTL() {
    return getLang() === 'he' || document.documentElement.dir === 'rtl';
  }

  // Traductions professionnelles et sobres
  const I18N_STRINGS = {
    fr: {
      title: 'Support Client · NeonPass',
      status: 'Disponible 24/7',
      welcome: "Bonjour, je suis Volt, l'assistant du support client NeonPass. Comment puis-je vous renseigner aujourd'hui ? (offres, commande, tutoriel IPTV, suivi de commande ou SAV)",
      placeholder: 'Posez votre question ou saisissez votre code commande...',
      send: 'Envoyer',
      thinking: 'Vérification en cours...',
      tooltip: 'Une question ? Discutez avec notre assistant',
      chip_pricing: 'Tarifs des abonnements',
      chip_order: 'Comment commander',
      chip_iptv: 'Tutoriel IPTV',
      chip_sav: 'Garantie et SAV',
      clear: 'Effacer la discussion',
      close: 'Fermer',
      powered: 'Support Client NeonPass · Propulsé par Google Gemini',
      human: 'Contacter un conseiller sur WhatsApp',
      error: 'Le service d\'assistance est momentanément indisponible. Notre équipe reste joignable directement sur WhatsApp.'
    },
    en: {
      title: 'Customer Support · NeonPass',
      status: 'Available 24/7',
      welcome: "Hello, I'm Volt, NeonPass customer support assistant. How can I assist you today? (plans, orders, IPTV setup, order tracking or support)",
      placeholder: 'Ask a question or enter your order code...',
      send: 'Send',
      thinking: 'Checking information...',
      tooltip: 'Need assistance? Chat with support',
      chip_pricing: 'Plans & Pricing',
      chip_order: 'How to order',
      chip_iptv: 'IPTV Setup Tutorial',
      chip_sav: 'Warranty & Support',
      clear: 'Clear conversation',
      close: 'Close',
      powered: 'NeonPass Support · Powered by Google Gemini',
      human: 'Contact a representative on WhatsApp',
      error: 'Support service is temporarily unavailable. Our team remains available directly on WhatsApp.'
    },
    he: {
      title: 'שירות לקוחות · ניאון פאס',
      status: 'זמין 24/7',
      welcome: 'שלום, אני וולט, נציג השירות הווירטואלי של ניאון פאס. כיצד אוכל לסייע לך היום? (חבילות, הזמנות, הגדרת IPTV, מעקב הזמנה או שירות לקוחות)',
      placeholder: 'שאל שאלה או הזן מספר הזמנה...',
      send: 'שלח',
      thinking: 'בודק נתונים...',
      tooltip: 'צריך עזרה? דבר עם נציג השירות',
      chip_pricing: 'מחירים וחבילות',
      chip_order: 'איך מזמינים',
      chip_iptv: 'מדריך הגדרת IPTV',
      chip_sav: 'אחריות ושירות',
      clear: 'נקה שיחה',
      close: 'סגור',
      powered: 'שירות לקוחות ניאון פאס · מופעל על ידי Google Gemini',
      human: 'פנה לנציג בוואטסאפ',
      error: 'השירות אינו זמין זמנית. הצוות שלנו זמין ישירות בוואטסאפ.'
    }
  };

  function t(k) {
    const l = getLang();
    const table = I18N_STRINGS[l] || I18N_STRINGS.fr;
    return table[k] || I18N_STRINGS.fr[k] || k;
  }

  // Échappement HTML sécurisé
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Parser Markdown sobre et fluide
  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Gras : **texte**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italique : *texte*
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Code : `code`
    html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    // Puces : • ou -
    html = html.replace(/^[•\-\*]\s+(.*)$/gm, '<li class="chat-li">$1</li>');
    html = html.replace(/(<li class="chat-li">.*<\/li>(\n)?)+/g, '<ul class="chat-ul">$&</ul>');
    // Liens : [texte](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+|\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="chat-link">$1</a>');
    // Sauts de ligne
    html = html.replace(/\n{2,}/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  // Injection des styles CSS sobres et soignés
  function injectStyles() {
    if (document.getElementById('neonpassChatbotStyles')) return;
    const style = document.createElement('style');
    style.id = 'neonpassChatbotStyles';
    style.textContent = `
      /* ----- Floating Trigger Button (Style épuré d'origine) ----- */
      .wa-float, #npChatTrigger {
        position: fixed;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        right: calc(max(16px, env(safe-area-inset-right, 0px)));
        z-index: 9990;
        width: 54px;
        height: 54px;
        padding: 0;
        border-radius: 50%;
        background: #ffffff;
        color: #0d0f1e;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 10px 34px -6px rgba(43, 230, 255, .5);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
        user-select: none;
      }
      .wa-float:hover, #npChatTrigger:hover {
        transform: translateY(-3px) scale(1.05);
        box-shadow: 0 14px 40px -4px rgba(43, 230, 255, .7);
      }
      .wa-float:active, #npChatTrigger:active {
        transform: scale(0.96);
      }
      .wa-float svg, #npChatTrigger svg {
        width: 24px;
        height: 24px;
        fill: currentColor;
      }
      html[dir="rtl"] .wa-float, html[dir="rtl"] #npChatTrigger {
        right: auto;
        left: calc(max(16px, env(safe-area-inset-left, 0px)));
      }
      @media (max-width: 480px) {
        .wa-float, #npChatTrigger {
          width: 48px;
          height: 48px;
          bottom: calc(76px + env(safe-area-inset-bottom, 0px));
        }
      }

      /* Tooltip invitation sobre */
      #npChatTooltip {
        position: absolute;
        bottom: 64px;
        right: 0;
        background: rgba(15, 17, 34, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 8px 14px;
        border-radius: 10px;
        font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #efecff;
        white-space: nowrap;
        box-shadow: 0 10px 25px rgba(0,0,0,0.6);
        pointer-events: none;
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      html[dir="rtl"] #npChatTooltip {
        right: auto;
        left: 0;
      }
      #npChatTooltip.np-show {
        opacity: 1;
        transform: translateY(0);
      }

      /* ----- Chat Dialog Window ----- */
      #npChatWindow {
        position: fixed;
        bottom: calc(82px + env(safe-area-inset-bottom, 0px));
        right: calc(max(16px, env(safe-area-inset-right, 0px)));
        z-index: 9995;
        width: 380px;
        height: 560px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 105px);
        background: rgba(13, 15, 30, 0.98);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(160, 150, 255, 0.22);
        border-radius: 18px;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 30px rgba(43, 230, 255, 0.15);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        transform: translateY(14px) scale(0.97);
        transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      html[dir="rtl"] #npChatWindow {
        right: auto;
        left: calc(max(16px, env(safe-area-inset-left, 0px)));
        direction: rtl;
      }
      #npChatWindow.np-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }

      /* Header */
      .np-chat-header {
        padding: 13px 16px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .np-chat-brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .np-chat-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #ffffff;
        color: #0d0f1e;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        font-weight: 700;
        box-shadow: 0 0 10px rgba(43, 230, 255, 0.4);
      }
      .np-chat-title-group h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: -0.01em;
      }
      .np-chat-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #10b981;
        font-weight: 500;
        margin-top: 1px;
      }
      .np-chat-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 6px #10b981;
      }
      .np-chat-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .np-chat-icon-btn {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        padding: 6px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, background 0.15s;
      }
      .np-chat-icon-btn:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
      }

      /* Messages */
      .np-chat-messages {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        scroll-behavior: smooth;
      }
      .np-chat-messages::-webkit-scrollbar {
        width: 4px;
      }
      .np-chat-messages::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 8px;
      }

      .np-chat-msg {
        display: flex;
        gap: 10px;
        max-width: 88%;
        font-size: 13.5px;
        line-height: 1.45;
        word-break: break-word;
      }
      .np-chat-msg.np-bot {
        align-self: flex-start;
      }
      .np-chat-msg.np-user {
        align-self: flex-end;
        flex-direction: row-reverse;
      }
      .np-msg-content {
        padding: 10px 14px;
        border-radius: 14px;
      }
      .np-bot .np-msg-content {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #efecff;
        border-bottom-left-radius: 4px;
      }
      html[dir="rtl"] .np-bot .np-msg-content {
        border-bottom-left-radius: 14px;
        border-bottom-right-radius: 4px;
      }
      .np-user .np-msg-content {
        background: #0284c7;
        color: #ffffff;
        border-bottom-right-radius: 4px;
      }
      html[dir="rtl"] .np-user .np-msg-content {
        border-bottom-right-radius: 14px;
        border-bottom-left-radius: 4px;
      }
      .chat-ul {
        margin: 6px 0 6px 18px;
        padding: 0;
      }
      .chat-li {
        margin: 3px 0;
      }
      .chat-inline-code {
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 1px 5px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
      }
      .chat-link {
        color: #38bdf8;
        text-decoration: underline;
        font-weight: 500;
      }

      /* Quick chips */
      .np-chat-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }
      .np-chat-chip {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #e2e8f0;
        font-size: 11.5px;
        font-weight: 500;
        padding: 6px 11px;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .np-chat-chip:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(56, 189, 248, 0.5);
        color: #ffffff;
      }

      /* Typing indicator */
      .np-typing-indicator {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        width: fit-content;
      }
      .np-typing-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #38bdf8;
        animation: npTypingAnim 1.4s infinite ease-in-out both;
      }
      .np-typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .np-typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes npTypingAnim {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1.1); opacity: 1; }
      }

      /* Footer */
      .np-chat-footer {
        padding: 12px 14px;
        background: rgba(15, 17, 34, 0.9);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      .np-chat-form {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .np-chat-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 9px 12px;
        font-size: 13.5px;
        color: #ffffff;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .np-chat-input:focus {
        border-color: #38bdf8;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
      }
      .np-chat-send {
        background: #0284c7;
        border: none;
        color: #ffffff;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s, background 0.15s;
        flex-shrink: 0;
      }
      .np-chat-send:hover {
        background: #0369a1;
        transform: scale(1.04);
      }
      .np-chat-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .np-chat-sub {
        font-size: 10.5px;
        color: rgba(255, 255, 255, 0.4);
        text-align: center;
        margin-top: 8px;
      }
      .np-chat-sub a {
        color: #38bdf8;
        text-decoration: none;
      }
      .np-chat-sub a:hover {
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  // Création ou rattachement du widget
  function createWidget() {
    injectStyles();

    // Recherche d'un déclencheur existant (#npChatTrigger)
    let trigger = document.getElementById('npChatTrigger');
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.id = 'npChatTrigger';
      trigger.className = 'wa-float';
      trigger.type = 'button';
      trigger.setAttribute('aria-label', t('title'));
      trigger.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2zm0 18.200a8.200 8.200 0 0 1-4.200-1.200l-.3-.2-3 .8.8-2.900-.2-.3A8.200 8.200 0 1 1 12 20.200z"/>
        </svg>
      `;
      document.body.appendChild(trigger);
    }

    // Ajout du tooltip
    let tooltip = document.getElementById('npChatTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'npChatTooltip';
      tooltip.textContent = t('tooltip');
      trigger.appendChild(tooltip);
    }

    // Fenêtre de dialogue
    let win = document.getElementById('npChatWindow');
    if (!win) {
      win = document.createElement('div');
      win.id = 'npChatWindow';
      win.innerHTML = `
        <div class="np-chat-header">
          <div class="np-chat-brand">
            <div class="np-chat-avatar">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/>
              </svg>
            </div>
            <div class="np-chat-title-group">
              <h4>${t('title')}</h4>
              <div class="np-chat-status">
                <span class="np-chat-status-dot"></span>
                <span>${t('status')}</span>
              </div>
            </div>
          </div>
          <div class="np-chat-header-actions">
            <button type="button" class="np-chat-icon-btn" id="npChatClear" title="${t('clear')}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
            <button type="button" class="np-chat-icon-btn" id="npChatClose" title="${t('close')}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="np-chat-messages" id="npChatMessages"></div>
        <div class="np-chat-footer">
          <form class="np-chat-form" id="npChatForm">
            <input type="text" class="np-chat-input" id="npChatInput" placeholder="${t('placeholder')}" maxlength="1000" autocomplete="off" />
            <button type="submit" class="np-chat-send" id="npChatSendBtn" aria-label="${t('send')}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
          <div class="np-chat-sub">
            <span>${t('powered')}</span> · <a href="https://wa.me/${chatbotConfig?.waNumber || '972552899450'}" target="_blank" rel="noopener">${t('human')}</a>
          </div>
        </div>
      `;
      document.body.appendChild(win);
    }

    // Événements
    trigger.addEventListener('click', toggleChat);
    const closeBtn = document.getElementById('npChatClose');
    if (closeBtn) closeBtn.addEventListener('click', closeChat);
    const clearBtn = document.getElementById('npChatClear');
    if (clearBtn) clearBtn.addEventListener('click', clearChat);
    const form = document.getElementById('npChatForm');
    if (form) form.addEventListener('submit', onUserSubmit);

    // Infobulle discrète à la première visite (2.5s)
    setTimeout(() => {
      const tip = document.getElementById('npChatTooltip');
      if (tip && !isChatOpen && !sessionStorage.getItem('np_tooltip_seen')) {
        tip.classList.add('np-show');
        setTimeout(() => tip.classList.remove('np-show'), 4500);
        sessionStorage.setItem('np_tooltip_seen', '1');
      }
    }, 2500);

    // Chargement de l'historique
    loadHistory();
  }

  function toggleChat() {
    if (isChatOpen) closeChat();
    else openChat();
  }

  function openChat() {
    const win = document.getElementById('npChatWindow');
    if (!win) return;
    win.classList.add('np-open');
    isChatOpen = true;
    const inp = document.getElementById('npChatInput');
    if (inp) setTimeout(() => inp.focus(), 150);
    scrollToBottom();
  }

  function closeChat() {
    const win = document.getElementById('npChatWindow');
    if (!win) return;
    win.classList.remove('np-open');
    isChatOpen = false;
  }

  function scrollToBottom() {
    const box = document.getElementById('npChatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function renderMessage(role, text) {
    const box = document.getElementById('npChatMessages');
    if (!box) return;

    const msg = document.createElement('div');
    msg.className = 'np-chat-msg ' + (role === 'user' ? 'np-user' : 'np-bot');

    const content = document.createElement('div');
    content.className = 'np-msg-content';
    content.innerHTML = formatMarkdown(text);

    msg.appendChild(content);
    box.appendChild(msg);
    scrollToBottom();
  }

  function renderWelcomeMessage() {
    const welcome = chatbotConfig?.chatbotWelcomeMessage || t('welcome');
    renderMessage('model', welcome);

    // Ajout des suggestions de questions rapides
    const box = document.getElementById('npChatMessages');
    if (!box) return;

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'np-chat-chips';
    chipsContainer.id = 'npQuickChips';

    const chips = [
      { label: t('chip_pricing'), prompt: 'Quels sont les tarifs et formules disponibles ?' },
      { label: t('chip_order'), prompt: 'Comment passer commande et recevoir mes accès ?' },
      { label: t('chip_iptv'), prompt: 'Comment installer et configurer mon abonnement IPTV ?' },
      { label: t('chip_sav'), prompt: 'Comment fonctionne la garantie en cas de problème sur un accès ?' }
    ];

    chips.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'np-chat-chip';
      btn.textContent = c.label;
      btn.addEventListener('click', () => {
        const inp = document.getElementById('npChatInput');
        if (inp) inp.value = c.prompt;
        const chipsEl = document.getElementById('npQuickChips');
        if (chipsEl) chipsEl.remove();
        sendMessage(c.prompt);
      });
      chipsContainer.appendChild(btn);
    });

    box.appendChild(chipsContainer);
    scrollToBottom();
  }

  function loadHistory() {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        chatHistory = JSON.parse(saved);
        if (Array.isArray(chatHistory) && chatHistory.length > 0) {
          chatHistory.forEach(m => renderMessage(m.role, m.text));
          return;
        }
      } catch (_) {}
    }
    chatHistory = [];
    renderWelcomeMessage();
  }

  function clearChat() {
    sessionStorage.removeItem(STORAGE_KEY);
    chatHistory = [];
    const box = document.getElementById('npChatMessages');
    if (box) box.innerHTML = '';
    renderWelcomeMessage();
  }

  function showTyping() {
    const box = document.getElementById('npChatMessages');
    if (!box || document.getElementById('npTypingIndicator')) return;

    const typing = document.createElement('div');
    typing.className = 'np-chat-msg np-bot';
    typing.id = 'npTypingIndicator';
    typing.innerHTML = `
      <div class="np-typing-indicator">
        <span class="np-typing-dot"></span>
        <span class="np-typing-dot"></span>
        <span class="np-typing-dot"></span>
        <span style="font-size:11px;color:rgba(255,255,255,0.5);margin-left:4px">${t('thinking')}</span>
      </div>
    `;
    box.appendChild(typing);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById('npTypingIndicator');
    if (el) el.remove();
  }

  async function onUserSubmit(e) {
    e.preventDefault();
    const inp = document.getElementById('npChatInput');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || isSending) return;
    inp.value = '';

    const chipsEl = document.getElementById('npQuickChips');
    if (chipsEl) chipsEl.remove();

    await sendMessage(text);
  }

  async function sendMessage(text) {
    if (isSending) return;
    isSending = true;

    const sendBtn = document.getElementById('npChatSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    renderMessage('user', text);
    chatHistory.push({ role: 'user', text });

    showTyping();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: chatHistory.slice(-8)
        })
      });

      hideTyping();

      const data = await response.json();
      if (!response.ok || !data.ok) {
        const errText = data.error || t('error');
        renderMessage('model', errText);
      } else {
        const botReply = data.reply;
        renderMessage('model', botReply);
        chatHistory.push({ role: 'model', text: botReply });
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory));
      }
    } catch (err) {
      hideTyping();
      renderMessage('model', t('error'));
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      const inp = document.getElementById('npChatInput');
      if (inp) inp.focus();
    }
  }

  // Initialisation
  async function init() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      chatbotConfig = await res.json();
      if (chatbotConfig.chatbotEnabled === false) {
        return; // Désactivé depuis l'administration
      }
      createWidget();

      window.addEventListener('languagechange', () => {
        const tip = document.getElementById('npChatTooltip');
        if (tip) tip.textContent = t('tooltip');
        const inp = document.getElementById('npChatInput');
        if (inp) inp.placeholder = t('placeholder');
      });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
