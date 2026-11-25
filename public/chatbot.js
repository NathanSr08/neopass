/**
 * ⚡ NeonPass - Chatbot Assistant IA Cyberpunk (Volt)
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

  // Traductions intégrées légères pour le widget
  const I18N_STRINGS = {
    fr: {
      title: 'Volt · Assistant IA',
      status: 'En ligne 24/7',
      welcome: "⚡ Bonjour ! Je suis Volt, l'assistant virtuel de NeonPass. Comment puis-je vous aider aujourd'hui ? (tarifs, stock, commande, SAV...)",
      placeholder: 'Posez votre question à Volt...',
      send: 'Envoyer',
      thinking: 'Volt analyse votre demande...',
      tooltip: 'Besoin d\'aide ? Discutez avec notre IA !',
      chip_pricing: '💳 Tarifs des offres',
      chip_order: '⚡ Comment commander ?',
      chip_sav: '🛡️ Garantie & SAV',
      chip_stock: '📦 Stock disponible',
      clear: 'Effacer la discussion',
      close: 'Fermer',
      powered: 'IA NeonPass · Propulsé par Google Gemini',
      human: 'Parler à un humain sur WhatsApp',
      error: 'Désolé, une erreur est survenue. N\'hésitez pas à nous écrire sur WhatsApp !'
    },
    en: {
      title: 'Volt · AI Assistant',
      status: 'Online 24/7',
      welcome: "⚡ Hello! I'm Volt, NeonPass's official AI assistant. How can I help you today? (pricing, stock, ordering, support...)",
      placeholder: 'Ask Volt a question...',
      send: 'Send',
      thinking: 'Volt is thinking...',
      tooltip: 'Need help? Chat with our AI!',
      chip_pricing: '💳 Plans & Pricing',
      chip_order: '⚡ How to order?',
      chip_sav: '🛡️ Warranty & SAV',
      chip_stock: '📦 Stock availability',
      clear: 'Clear conversation',
      close: 'Close',
      powered: 'NeonPass AI · Powered by Google Gemini',
      human: 'Talk to a human on WhatsApp',
      error: 'Sorry, an error occurred. Feel free to contact our team on WhatsApp!'
    },
    he: {
      title: 'Volt · עוזר בינה מלאכותית',
      status: 'מחובר 24/7',
      welcome: '⚡ שלום! אני וולט, עוזר ה-AI של ניאון פאס. איך אוכל לעזור לך היום? (מחירים, מלאי, הזמנות, אחריות...)',
      placeholder: 'שאל את וולט שאלה...',
      send: 'שלח',
      thinking: 'וולט חושב...',
      tooltip: 'צריך עזרה? דבר עם ה-AI שלנו!',
      chip_pricing: '💳 מחירים ותוכניות',
      chip_order: '⚡ איך מזמינים?',
      chip_sav: '🛡️ אחריות ותמיכה',
      chip_stock: '📦 זמינות מלאי',
      clear: 'נקה שיחה',
      close: 'סגור',
      powered: 'ניאון פאס AI · מופעל על ידי Google Gemini',
      human: 'דבר עם נציג בוואטסאפ',
      error: 'סליחה, אירעה שגיאה. אתה מוזמן לפנות אלינו ישירות בוואטסאפ!'
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

  // Mini-parser Markdown fluide (gras, puces, liens, code)
  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Gras : **texte**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italique : *texte*
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Code en ligne : `code`
    html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    // Puces : • ou -
    html = html.replace(/^[•\-\*]\s+(.*)$/gm, '<li class="chat-li">$1</li>');
    html = html.replace(/(<li class="chat-li">.*<\/li>(\n)?)+/g, '<ul class="chat-ul">$&</ul>');
    // Liens : [texte](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="chat-link">$1</a>');
    // Sauts de ligne simples
    html = html.replace(/\n{2,}/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  // Injection des styles CSS Cyberpunk
  function injectStyles() {
    if (document.getElementById('neonpassChatbotStyles')) return;
    const style = document.createElement('style');
    style.id = 'neonpassChatbotStyles';
    style.textContent = `
      /* ----- Chatbot Trigger Bubble ----- */
      #npChatTrigger {
        position: fixed;
        bottom: calc(20px + env(safe-area-inset-bottom, 0px));
        right: calc(20px + env(safe-area-inset-right, 0px));
        z-index: 9990;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: linear-gradient(135deg, #a855f7 0%, #06b6d4 100%);
        border: 2px solid rgba(255, 255, 255, 0.25);
        box-shadow: 0 8px 30px rgba(168, 85, 247, 0.5), 0 0 20px rgba(6, 182, 212, 0.4);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease;
        user-select: none;
      }
      #npChatTrigger:hover {
        transform: scale(1.08) translateY(-2px);
        box-shadow: 0 12px 35px rgba(168, 85, 247, 0.65), 0 0 25px rgba(6, 182, 212, 0.6);
      }
      #npChatTrigger:active {
        transform: scale(0.96);
      }
      html[dir="rtl"] #npChatTrigger {
        right: auto;
        left: calc(20px + env(safe-area-inset-left, 0px));
      }
      .np-pulse-ring {
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        border: 2px solid rgba(43, 230, 255, 0.7);
        animation: npRingPulse 2.4s cubic-bezier(0.25, 0, 0, 1) infinite;
        pointer-events: none;
      }
      @keyframes npRingPulse {
        0% { transform: scale(0.9); opacity: 0.9; }
        70% { transform: scale(1.4); opacity: 0; }
        100% { transform: scale(1.4); opacity: 0; }
      }
      .np-online-badge {
        position: absolute;
        top: 1px;
        right: 1px;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: #10b981;
        border: 2px solid #0f1021;
        box-shadow: 0 0 8px #10b981;
      }
      html[dir="rtl"] .np-online-badge {
        right: auto;
        left: 1px;
      }

      /* Tooltip invitation */
      #npChatTooltip {
        position: absolute;
        bottom: 68px;
        right: 0;
        background: rgba(15, 17, 34, 0.95);
        border: 1px solid rgba(168, 85, 247, 0.4);
        padding: 9px 14px;
        border-radius: 12px;
        font: 600 12.5px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #efecff;
        white-space: nowrap;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 15px rgba(168, 85, 247, 0.2);
        pointer-events: none;
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.3s ease, transform 0.3s ease;
      }
      html[dir="rtl"] #npChatTooltip {
        right: auto;
        left: 0;
      }
      #npChatTooltip.np-show {
        opacity: 1;
        transform: translateY(0);
      }

      /* Coordination avec le bouton flottant WhatsApp */
      body.has-np-chatbot .wa-float {
        bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
        transition: bottom 0.3s ease, transform 0.2s;
      }
      @media (max-width: 480px) {
        body.has-np-chatbot #npChatTrigger {
          bottom: calc(76px + env(safe-area-inset-bottom, 0px)) !important;
          width: 52px;
          height: 52px;
        }
        body.has-np-chatbot .wa-float {
          bottom: calc(138px + env(safe-area-inset-bottom, 0px)) !important;
        }
      }

      /* ----- Chat Dialog Window ----- */
      #npChatWindow {
        position: fixed;
        bottom: calc(88px + env(safe-area-inset-bottom, 0px));
        right: calc(20px + env(safe-area-inset-right, 0px));
        z-index: 9995;
        width: 380px;
        height: 560px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 110px);
        background: rgba(13, 15, 30, 0.97);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(160, 150, 255, 0.25);
        border-radius: 20px;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(168, 85, 247, 0.25);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        transform: translateY(16px) scale(0.96);
        transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      html[dir="rtl"] #npChatWindow {
        right: auto;
        left: calc(20px + env(safe-area-inset-left, 0px));
        direction: rtl;
      }
      #npChatWindow.np-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }

      /* Header */
      .np-chat-header {
        padding: 14px 16px;
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
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: linear-gradient(135deg, #a855f7, #06b6d4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        color: #fff;
        box-shadow: 0 0 12px rgba(168, 85, 247, 0.5);
      }
      .np-chat-title-group h4 {
        margin: 0;
        font-size: 14.5px;
        font-weight: 700;
        color: #fff;
        letter-spacing: -0.01em;
      }
      .np-chat-status {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
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
        gap: 6px;
      }
      .np-chat-icon-btn {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        padding: 6px;
        border-radius: 8px;
        font-size: 15px;
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

      /* Messages container */
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
        width: 5px;
      }
      .np-chat-messages::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 10px;
      }

      /* Bubbles */
      .np-chat-msg {
        display: flex;
        gap: 10px;
        max-width: 86%;
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
        border-radius: 16px;
      }
      .np-bot .np-msg-content {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #efecff;
        border-bottom-left-radius: 4px;
      }
      html[dir="rtl"] .np-bot .np-msg-content {
        border-bottom-left-radius: 16px;
        border-bottom-right-radius: 4px;
      }
      .np-user .np-msg-content {
        background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
        color: #fff;
        border-bottom-right-radius: 4px;
        box-shadow: 0 4px 15px rgba(236, 72, 153, 0.3);
      }
      html[dir="rtl"] .np-user .np-msg-content {
        border-bottom-right-radius: 16px;
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
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 1px 5px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
      }
      .chat-link {
        color: #38bdf8;
        text-decoration: underline;
      }

      /* Quick chips */
      .np-chat-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }
      .np-chat-chip {
        background: rgba(168, 85, 247, 0.12);
        border: 1px solid rgba(168, 85, 247, 0.35);
        color: #e9d5ff;
        font-size: 11.5px;
        font-weight: 500;
        padding: 5px 10px;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, transform 0.15s;
      }
      .np-chat-chip:hover {
        background: rgba(168, 85, 247, 0.25);
        border-color: rgba(168, 85, 247, 0.6);
        transform: translateY(-1px);
      }

      /* Typing indicator */
      .np-typing-indicator {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        width: fit-content;
      }
      .np-typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #06b6d4;
        animation: npTypingAnim 1.4s infinite ease-in-out both;
      }
      .np-typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .np-typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes npTypingAnim {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1.1); opacity: 1; }
      }

      /* Footer Input */
      .np-chat-footer {
        padding: 12px 14px;
        background: rgba(15, 17, 34, 0.85);
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
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13.5px;
        color: #fff;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .np-chat-input:focus {
        border-color: #a855f7;
        box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.25);
      }
      .np-chat-send {
        background: linear-gradient(135deg, #a855f7, #06b6d4);
        border: none;
        color: #fff;
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s, opacity 0.15s;
        flex-shrink: 0;
      }
      .np-chat-send:hover {
        transform: scale(1.05);
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

  // Création du DOM du widget
  function createWidget() {
    injectStyles();
    document.body.classList.add('has-np-chatbot');

    // Trigger button
    const trigger = document.createElement('div');
    trigger.id = 'npChatTrigger';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', t('title'));
    trigger.innerHTML = `
      <div class="np-pulse-ring"></div>
      <div class="np-online-badge"></div>
      <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.03 2 11c0 2.87 1.5 5.43 3.84 7.07-.15.93-.65 2.5-1.58 3.5 0 0 2.37.13 4.54-1.39.73.19 1.49.29 2.26.29 5.52 0 10-4.03 10-9s-4.48-9-10-9zm1 13h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 8.9 12 9.5 12 11h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 .88-.36 1.68-.93 2.25z"/>
      </svg>
      <div id="npChatTooltip">${t('tooltip')}</div>
    `;

    // Chat Window
    const win = document.createElement('div');
    win.id = 'npChatWindow';
    win.innerHTML = `
      <div class="np-chat-header">
        <div class="np-chat-brand">
          <div class="np-chat-avatar">⚡</div>
          <div class="np-chat-title-group">
            <h4>${t('title')}</h4>
            <div class="np-chat-status">
              <span class="np-chat-status-dot"></span>
              <span>${t('status')}</span>
            </div>
          </div>
        </div>
        <div class="np-chat-header-actions">
          <button type="button" class="np-chat-icon-btn" id="npChatClear" title="${t('clear')}">🗑️</button>
          <button type="button" class="np-chat-icon-btn" id="npChatClose" title="${t('close')}">✕</button>
        </div>
      </div>
      <div class="np-chat-messages" id="npChatMessages"></div>
      <div class="np-chat-footer">
        <form class="np-chat-form" id="npChatForm">
          <input type="text" class="np-chat-input" id="npChatInput" placeholder="${t('placeholder')}" maxlength="1000" autocomplete="off" />
          <button type="submit" class="np-chat-send" id="npChatSendBtn" aria-label="${t('send')}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </form>
        <div class="np-chat-sub">
          <span>${t('powered')}</span> · <a href="https://wa.me/${chatbotConfig?.waNumber || '972552899450'}" target="_blank" rel="noopener">${t('human')}</a>
        </div>
      </div>
    `;

    document.body.appendChild(trigger);
    document.body.appendChild(win);

    // Événements
    trigger.addEventListener('click', toggleChat);
    document.getElementById('npChatClose').addEventListener('click', closeChat);
    document.getElementById('npChatClear').addEventListener('click', clearChat);
    document.getElementById('npChatForm').addEventListener('submit', onUserSubmit);

    // Affichage temporaire du tooltip de bienvenue (après 2.5s)
    setTimeout(() => {
      const tip = document.getElementById('npChatTooltip');
      if (tip && !isChatOpen && !sessionStorage.getItem('np_tooltip_seen')) {
        tip.classList.add('np-show');
        setTimeout(() => tip.classList.remove('np-show'), 5000);
        sessionStorage.setItem('np_tooltip_seen', '1');
      }
    }, 2500);

    // Chargement de l'historique ou du message initial
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

    // Ajout des chips de questions rapides
    const box = document.getElementById('npChatMessages');
    if (!box) return;

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'np-chat-chips';
    chipsContainer.id = 'npQuickChips';

    const chips = [
      { label: t('chip_pricing'), prompt: 'Quels sont les tarifs et abonnements disponibles sur NeonPass ?' },
      { label: t('chip_order'), prompt: 'Comment se passe la commande et le paiement sur WhatsApp ?' },
      { label: t('chip_sav'), prompt: 'Quelle est la garantie et comment fonctionne le SAV en cas de panne ?' },
      { label: t('chip_stock'), prompt: 'Avez-vous du stock disponible immédiatement ?' }
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

    // Retirer les chips rapides s'ils sont encore affichés
    const chipsEl = document.getElementById('npQuickChips');
    if (chipsEl) chipsEl.remove();

    await sendMessage(text);
  }

  async function sendMessage(text) {
    if (isSending) return;
    isSending = true;

    const sendBtn = document.getElementById('npChatSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    // Affiche le message de l'utilisateur
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
        renderMessage('model', '⚠️ ' + errText);
      } else {
        const botReply = data.reply;
        renderMessage('model', botReply);
        chatHistory.push({ role: 'model', text: botReply });
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory));
      }
    } catch (err) {
      hideTyping();
      renderMessage('model', '⚠️ ' + t('error'));
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      const inp = document.getElementById('npChatInput');
      if (inp) inp.focus();
    }
  }

  // Initialisation au chargement du DOM
  async function init() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      chatbotConfig = await res.json();
      if (chatbotConfig.chatbotEnabled === false) {
        return; // Chatbot désactivé dans l'admin
      }
      createWidget();

      // Écoute de changement de langue
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
