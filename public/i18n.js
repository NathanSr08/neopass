/**
 * ⚡ NeonPass Internationalization & RTL Engine (i18n)
 * Supports: Français (FR), English (EN), עברית (HE - RTL)
 * Automatic system language detection & persistent selection
 */
(function() {
  'use strict';

  const SUPPORTED_LANGS = ['fr', 'en', 'he'];
  const LANG_META = {
    fr: { code: 'FR', flag: '🇫🇷', name: 'Français', dir: 'ltr' },
    en: { code: 'EN', flag: '🇬🇧', name: 'English', dir: 'ltr' },
    he: { code: 'HE', flag: '🇮🇱', name: 'עברית', dir: 'rtl' }
  };

  const TRANSLATIONS = {
    fr: {
      // Navigation
      nav_offers: 'Offres',
      nav_composer: 'Composer',
      nav_news: 'Nouveautés',
      nav_tracking: 'Suivi',
      nav_status: 'Statut',
      nav_faq: 'FAQ',
      nav_login: 'Connexion',
      nav_account: 'Mon Compte',
      nav_logout: 'Déconnexion',

      // Hero
      hero_tag: 'Concours Instagram en cours : 1 an de Netflix, Disney+ et VPN à gagner',
      hero_title_pre: 'Votre divertissement, au prix d\'un ',
      hero_title_highlight: 'café par mois.',
      hero_lead: 'Streaming, VPN, musique et chaînes TV. Des formules annuelles à tarif fixe, une commande en un message WhatsApp, un interlocuteur unique jusqu\'à l\'activation.',
      hero_cta_offers: 'Découvrir les offres',
      hero_cta_composer: 'Composer mon pack',
      hero_stat_plans: 'formules annuelles',
      hero_stat_from: 'dès',
      hero_stat_per_year: 'par an',
      hero_stat_msg: 'msg',
      hero_stat_to_order: 'pour commander',

      // Floating cards preview
      fcard_now_playing: 'EN LECTURE',
      fcard_protected: 'PROTÉGÉ',
      fcard_encrypted_conn: 'Connexion chiffrée',
      fcard_server_paris: 'Serveur · Paris',
      fcard_live: 'EN DIRECT',
      fcard_movie_night: 'Soirée film · épisode 4',
      fcard_playlist_neon: 'Playlist · Nuit néon',
      ticker_annual_pack: 'Pack annuel',
      ticker_wa_order: 'Commande WhatsApp',
      card_affil_add: '+ Affiliation',
      card_affil_remove: '− Affiliation',
      card_affil_input: 'Nom du parrain',
      card_first_review: 'Donner le premier avis',
      comp_add_more: 'Ajoute {n} service(s) pour la remise de {pct} %',

      // Catalog
      cat_eyebrow: 'Catalogue & Formules',
      cat_title: 'Des abonnements premium au meilleur tarif.',
      cat_desc: 'Abonnements vérifiés avec durée garantie (1 mois, 6 mois, 1 an). Accès instantané et support dédié 7j/7.',
      tab_all: 'Tous',
      tab_packs: 'Packs',
      tab_streaming: 'Streaming',
      tab_vpn: 'VPN',
      tab_music: 'Musique',
      tab_tv: 'TV',
      tab_software: 'Logiciels',
      loading_catalog: 'Chargement du catalogue…',
      no_offers_cat: 'Aucune offre dans cette catégorie pour le moment.',
      catalog_error: 'Le catalogue est momentanément indisponible. Réessaie dans un instant.',
      retry: 'Réessayer',
      card_save: 'ÉCONOMIE',
      card_monthly_equiv: 'soit env.',
      card_reviews: 'avis',
      card_order_btn: 'Commander via WhatsApp',

      // Durations
      dur_1_month: '1 mois',
      dur_6_months: '6 mois',
      dur_1_year: '1 an',
      dur_n_months: '{n} mois',
      dur_per_month: '/ mois',
      dur_per_6_months: '/ 6 mois',
      dur_per_year: '/ an',
      dur_per_n_months: '/ {n} mois',

      // Composer
      comp_eyebrow: 'Sur mesure',
      comp_title: 'Composez votre pack.',
      comp_desc: 'Sélectionnez les services et abonnements de votre choix. Une remise s\'applique automatiquement dès 3 services.',
      comp_receipt_title: 'Votre pack',
      comp_total_per_year: 'Total / an',
      comp_total_order: 'Total commande',
      comp_promo_placeholder: 'Code promo',
      comp_promo_apply: 'Appliquer',
      comp_promo_remove: 'Retirer',
      comp_promo_enter: 'Saisis un code promo.',
      comp_affil_placeholder: 'Affiliation : nom du parrain (facultatif)',
      comp_name_placeholder: 'Votre prénom (facultatif)',
      comp_phone_placeholder: 'Votre numéro WhatsApp (facultatif)',
      comp_order_btn: 'Commander ce pack',
      comp_empty: 'Sélectionne au moins une offre pour composer ton pack.',
      comp_discount_pack: 'remise pack',

      // Steps
      steps_eyebrow: 'Commande',
      steps_title: 'Trois étapes, aucun formulaire.',
      step1_title: 'Choisissez une formule',
      step1_desc: 'Parcourez le catalogue ou composez votre pack sur mesure avec le sélecteur.',
      step2_title: 'Le message se prépare',
      step2_desc: 'WhatsApp s\'ouvre avec un message pré-rempli : offre, tarif annuel et numéro de référence. Vous gardez la main avant l\'envoi.',
      step3_title: 'Confirmez la commande',
      step3_desc: 'Le paiement et l\'activation se règlent directement dans la conversation, avec un interlocuteur dédié.',

      // FAQ
      faq_eyebrow: 'Questions fréquentes',
      faq_title: 'L\'essentiel à connaître.',
      faq_q1: 'Comment se passe une commande ?',
      faq_a1: 'Vous choisissez une formule, le message pré-rempli s\'ouvre dans WhatsApp avec l\'offre et son tarif. Vous l\'envoyez : nous confirmons la disponibilité et vous transmettons les instructions de paiement, avec un numéro de référence pour le suivi.',
      faq_q2: 'Quels moyens de paiement acceptez-vous ?',
      faq_a2: 'Revolut ou crypto (USDT, BTC ou ETH selon le réseau disponible). Aucune coordonnée bancaire n\'est saisie sur le site : tout se règle dans la conversation WhatsApp, une fois le tarif confirmé.',
      faq_q3: 'Sous quel délai l\'accès est-il livré ?',
      faq_a3: 'Dès réception du paiement, l\'activation est immédiate, 7 jours sur 7. Comptez quelques minutes en cas de forte affluence ; au-delà de 30 minutes, relancez-nous dans la même conversation.',
      faq_q4: 'Que couvre la garantie ?',
      faq_a4: 'Chaque abonnement est couvert pendant toute sa durée, soit 12 mois à compter de la date d\'achat. Si l\'accès est interrompu, nous remplaçons le service ou remboursons au prorata des mois restants.',
      faq_q5: 'Sur combien d\'appareils puis-je en profiter ?',
      faq_a5: 'Chaque formule est prévue pour un usage personnel, sur un appareil à la fois, sauf mention contraire sur la fiche. Pour plusieurs écrans en simultané, choisissez une formule famille.',
      faq_q6: 'Puis-je commander pour un proche ?',
      faq_a6: 'Oui. Indiquez son nom dans le champ « Affiliation » : il est ajouté au message et la personne est créditée du parrainage.',
      faq_q7: 'Que se passe-t-il à la fin de l\'année ?',
      faq_a7: 'L\'accès s\'arrête à échéance, sans reconduction automatique. Un rappel vous est envoyé avant la fin si vous souhaitez renouveler.',

      // Reviews modal
      reviews_title: 'Avis vérifiés',
      reviews_overall: 'Note globale',
      reviews_leave_title: 'Laisser un avis certifié',
      reviews_your_name: 'Votre prénom',
      reviews_your_comment: 'Votre expérience avec cet abonnement (qualité, réactivité, activation)...',
      reviews_submit: 'Publier mon avis',
      reviews_note: 'Avis modéré avant publication pour garantir des retours authentiques.',

      // Footer
      foot_desc: 'Distribution de formules annuelles d\'abonnements numériques et de divertissement. Service d\'assistance réactif 7j/7 et garantie totale sur toute la durée souscrite.',
      foot_services: 'Services & Nouveautés',
      foot_plans: 'Formules Annuelles',
      foot_custom_pack: 'Composez votre Pack',
      foot_news_contest: 'Actualités & Concours',
      foot_network_status: 'État du Réseau en direct',
      foot_portal_support: 'Espace Abonné & SAV',
      foot_my_account: 'Mon Espace Client',
      foot_find_access: 'Retrouver mes accès',
      foot_warranty_charter: 'Charte de Garantie & SAV',
      foot_faq_link: 'Foire aux questions',
      foot_order_procedure: 'Procédure de commande',
      foot_install_app: 'Installer l\'application',
      foot_legal_security: 'Cadre Légal & Sécurité',
      foot_terms: 'Conditions Générales de Vente',
      foot_legal: 'Mentions Légales',
      foot_rgpd: 'Protection des données RGPD',
      foot_ssl: 'Transactions chiffrées SSL',
      foot_rights: '© 2026 NeonPass. Tous droits réservés.',
      foot_payments: 'Paiements sécurisés via Revolut, Virement SEPA et Réseaux Cryptographiques. Aucune reconduction automatique.',

      // WhatsApp floating & templates
      wa_float_text: 'WhatsApp',
      wa_float_aria: 'Écrire sur WhatsApp',
      wa_single_msg: "Bonjour, je souhaite commander l'offre « {name} » ({dur}) à {price}.",
      wa_pack_msg: "Bonjour, je souhaite composer ce pack : {items}. Total : {total}.",
      wa_question_msg: "Bonjour, j'ai une question sur vos offres.",
      hero_offers_count_plural: "offres disponibles",
      hero_offers_count_singular: "offre disponible",

      // Client portal
      compte_tab_login: 'Connexion',
      compte_tab_register: 'Créer un compte',
      compte_email_label: 'Adresse email',
      compte_password_label: 'Mot de passe',
      compte_login_btn: 'Se connecter',
      compte_forgot_btn: 'Mot de passe oublié ?',
      compte_register_btn: 'Valider et continuer',
      compte_tab_subs: 'Mes Abonnements',
      compte_tab_link: 'Rattacher une commande',
      compte_tab_profile: 'Mon Profil & Sécurité',
      compte_tab_referral: '🎁 Parrainage (-50%)',
      compte_kpi_total: 'Total investi',
      compte_kpi_subs: 'Abonnements Actifs',
      compte_kpi_expiry: 'Prochaine Échéance',
      compte_kpi_warranty: 'Garantie 12 Mois'
    },

    en: {
      // Navigation
      nav_offers: 'Offers',
      nav_composer: 'Build Pack',
      nav_news: 'What\'s New',
      nav_tracking: 'Tracking',
      nav_status: 'Status',
      nav_faq: 'FAQ',
      nav_login: 'Login',
      nav_account: 'My Account',
      nav_logout: 'Log Out',

      // Hero
      hero_tag: 'Instagram Giveaway: Win 1 year of Netflix, Disney+ & VPN',
      hero_title_pre: 'Your entertainment, for the price of a ',
      hero_title_highlight: 'coffee a month.',
      hero_lead: 'Streaming, VPN, music and TV channels. Fixed annual plans, order in a single WhatsApp message, dedicated support until activation.',
      hero_cta_offers: 'Explore Offers',
      hero_cta_composer: 'Build My Pack',
      hero_stat_plans: 'annual plans',
      hero_stat_from: 'from',
      hero_stat_per_year: 'per year',
      hero_stat_msg: 'msg',
      hero_stat_to_order: 'to order',

      // Floating cards preview
      fcard_now_playing: 'NOW PLAYING',
      fcard_protected: 'PROTECTED',
      fcard_encrypted_conn: 'Encrypted Connection',
      fcard_server_paris: 'Server · Paris',
      fcard_live: 'LIVE',
      fcard_movie_night: 'Movie night · episode 4',
      fcard_playlist_neon: 'Playlist · Neon night',
      ticker_annual_pack: 'Annual Bundle',
      ticker_wa_order: 'Order via WhatsApp',
      card_affil_add: '+ Referral',
      card_affil_remove: '− Referral',
      card_affil_input: 'Referrer name',
      card_first_review: 'Be the first to review',
      comp_add_more: 'Add {n} more service(s) for a {pct}% discount',

      // Catalog
      cat_eyebrow: 'Catalog & Plans',
      cat_title: 'Premium subscriptions at the best price.',
      cat_desc: 'Verified subscriptions with guaranteed duration (1 month, 6 months, 1 year). Instant delivery and 7/7 support.',
      tab_all: 'All',
      tab_packs: 'Packs',
      tab_streaming: 'Streaming',
      tab_vpn: 'VPN',
      tab_music: 'Music',
      tab_tv: 'TV',
      tab_software: 'Software',
      loading_catalog: 'Loading catalog…',
      no_offers_cat: 'No offers in this category for now.',
      catalog_error: 'Catalog is momentarily unavailable. Please retry in a moment.',
      retry: 'Retry',
      card_save: 'SAVE',
      card_monthly_equiv: 'i.e. approx.',
      card_reviews: 'reviews',
      card_order_btn: 'Order via WhatsApp',

      // Durations
      dur_1_month: '1 month',
      dur_6_months: '6 months',
      dur_1_year: '1 year',
      dur_n_months: '{n} months',
      dur_per_month: '/ month',
      dur_per_6_months: '/ 6 months',
      dur_per_year: '/ year',
      dur_per_n_months: '/ {n} months',

      // Composer
      comp_eyebrow: 'Custom Pack',
      comp_title: 'Build your custom pack.',
      comp_desc: 'Select the subscriptions of your choice. An automatic discount applies starting from 3 services.',
      comp_receipt_title: 'Your Pack',
      comp_total_per_year: 'Total / year',
      comp_total_order: 'Order Total',
      comp_promo_placeholder: 'Promo code',
      comp_promo_apply: 'Apply',
      comp_promo_remove: 'Remove',
      comp_promo_enter: 'Please enter a promo code.',
      comp_affil_placeholder: 'Affiliation: referrer name (optional)',
      comp_name_placeholder: 'Your first name (optional)',
      comp_phone_placeholder: 'Your WhatsApp number (optional)',
      comp_order_btn: 'Order this pack',
      comp_empty: 'Select at least one offer to build your pack.',
      comp_discount_pack: 'pack discount',

      // Steps
      steps_eyebrow: 'Ordering',
      steps_title: 'Three simple steps, zero forms.',
      step1_title: 'Choose a plan',
      step1_desc: 'Browse the catalog or build your custom bundle with the pack composer.',
      step2_title: 'Message prepares',
      step2_desc: 'WhatsApp opens with a pre-filled message: selected offers, annual price and reference number. You stay in control.',
      step3_title: 'Confirm your order',
      step3_desc: 'Payment and instant activation are finalized directly in the chat with a dedicated support agent.',

      // FAQ
      faq_eyebrow: 'Frequently Asked Questions',
      faq_title: 'Everything you need to know.',
      faq_q1: 'How does an order work?',
      faq_a1: 'You select a plan, the pre-filled message opens in WhatsApp with the offer and its rate. You send it: we confirm availability and provide payment instructions with a tracking number.',
      faq_q2: 'Which payment methods do you accept?',
      faq_a2: 'Revolut or crypto (USDT, BTC or ETH). No banking info is entered on our site: everything is settled securely in the WhatsApp chat.',
      faq_q3: 'How fast is access delivered?',
      faq_a3: 'Upon payment receipt, activation is immediate, 7 days a week. In peak times it takes just a few minutes.',
      faq_q4: 'What does the guarantee cover?',
      faq_a4: 'Every subscription is covered for its entire term, 12 months from purchase. If access is interrupted, we replace it or refund prorata.',
      faq_q5: 'How many devices can I use?',
      faq_a5: 'Each plan is intended for personal use on one device at a time, unless specified. For multiple screens, choose a family plan.',
      faq_q6: 'Can I order for someone else?',
      faq_a6: 'Yes! Simply enter their name in the Affiliation field: it will be included in the message and credited to them.',
      faq_q7: 'What happens at the end of the year?',
      faq_a7: 'Access ends at maturity with no automatic renewal. A friendly reminder is sent before expiry if you wish to renew.',

      // Reviews modal
      reviews_title: 'Verified Customer Reviews',
      reviews_overall: 'Overall Rating',
      reviews_leave_title: 'Leave a verified review',
      reviews_your_name: 'Your first name',
      reviews_your_comment: 'Your experience with this subscription (speed, quality, activation)...',
      reviews_submit: 'Post my review',
      reviews_note: 'Reviews are moderated to guarantee authentic feedback.',

      // Footer
      foot_desc: 'Distribution of annual digital entertainment plans and licenses. Dedicated 7/7 customer support and full guarantee over the entire duration.',
      foot_services: 'Services & News',
      foot_plans: 'Annual Plans',
      foot_custom_pack: 'Build your Pack',
      foot_news_contest: 'News & Giveaways',
      foot_network_status: 'Live Server Status',
      foot_portal_support: 'Customer Portal & Support',
      foot_my_account: 'My Account',
      foot_find_access: 'Find my access',
      foot_warranty_charter: 'Warranty & Support Charter',
      foot_faq_link: 'FAQ',
      foot_order_procedure: 'Order Procedure',
      foot_install_app: 'Install App',
      foot_legal_security: 'Legal & Security',
      foot_terms: 'Terms of Service',
      foot_legal: 'Legal Notice',
      foot_rgpd: 'GDPR Privacy Protection',
      foot_ssl: 'SSL Encrypted Transactions',
      foot_rights: '© 2026 NeonPass. All rights reserved.',
      foot_payments: 'Secure payments via Revolut, SEPA wire transfer and Cryptocurrencies. No auto-renewal.',

      // WhatsApp floating & templates
      wa_float_text: 'WhatsApp',
      wa_float_aria: 'Message on WhatsApp',
      wa_single_msg: "Hello, I would like to order the « {name} » ({dur}) plan at {price}.",
      wa_pack_msg: "Hello, I would like to order this custom pack: {items}. Total: {total}.",
      wa_question_msg: "Hello, I have a question regarding your offers.",
      hero_offers_count_plural: "available offers",
      hero_offers_count_singular: "available offer",

      // Client portal
      compte_tab_login: 'Login',
      compte_tab_register: 'Create Account',
      compte_email_label: 'Email address',
      compte_password_label: 'Password',
      compte_login_btn: 'Sign In',
      compte_forgot_btn: 'Forgot password?',
      compte_register_btn: 'Continue',
      compte_tab_subs: 'My Subscriptions',
      compte_tab_link: 'Link an Order',
      compte_tab_profile: 'Profile & Security',
      compte_tab_referral: '🎁 Referral (-50%)',
      compte_kpi_total: 'Total spent',
      compte_kpi_subs: 'Active Subscriptions',
      compte_kpi_expiry: 'Next Expiry',
      compte_kpi_warranty: '12-Month Guarantee'
    },

    he: {
      // Navigation
      nav_offers: 'מבצעים',
      nav_composer: 'הרכבת חבילה',
      nav_news: 'מה חדש',
      nav_tracking: 'מעקב הזמנה',
      nav_status: 'סטטוס שרתים',
      nav_faq: 'שאלות נפוצות',
      nav_login: 'התחברות',
      nav_account: 'האזור האישי',
      nav_logout: 'התנתקות',

      // Hero
      hero_tag: 'הגרלת אינסטגרם פעילה: זכו בשנה של נטפליקס, דיסני+ ו-VPN',
      hero_title_pre: 'הבידור שלכם, במחיר של ',
      hero_title_highlight: 'כוס קפה בחודש.',
      hero_lead: 'סטרימינג, VPN, מוזיקה וערוצי טלוויזיה. מנויים שנתיים במחיר קבוע, הזמנה בהודעת וואטסאפ אחת, ומענה אישי עד להפעלה מיידית.',
      hero_cta_offers: 'גלו את המבצעים',
      hero_cta_composer: 'הרכיבו חבילה מותאמת',
      hero_stat_plans: 'תוכניות שנתיות',
      hero_stat_from: 'החל מ-',
      hero_stat_per_year: 'לשנה',
      hero_stat_msg: 'הודעה 1',
      hero_stat_to_order: 'להזמנה מהירה',

      // Floating cards preview
      fcard_now_playing: 'פועל כעת',
      fcard_protected: 'מאובטח',
      fcard_encrypted_conn: 'חיבור מוצפן',
      fcard_server_paris: 'שרת · פריז',
      fcard_live: 'בשידור חי',
      fcard_movie_night: 'ערב סרט · פרק 4',
      fcard_playlist_neon: 'פלייליסט · ליל ניאון',
      ticker_annual_pack: 'חבילה שנתית',
      ticker_wa_order: 'הזמנה בוואטסאפ',
      card_affil_add: '+ שיוך ממליץ',
      card_affil_remove: '− שיוך ממליץ',
      card_affil_input: 'שם הממליץ',
      card_first_review: 'היו הראשונים לדרג',
      comp_add_more: 'הוסיפו עוד {n} שירות(ים) לקבלת הנחה של {pct}%',

      // Catalog
      cat_eyebrow: 'קטלוג ומבצעים',
      cat_title: 'מנויי פרימיום במחירים המשתלמים ביותר.',
      cat_desc: 'מנויים מאומתים עם תקופת אחריות מלאה (חודש, 6 חודשים, שנה). הפעלה מיידית ותמיכה 7 ימים בשבוע.',
      tab_all: 'הכל',
      tab_packs: 'חבילות',
      tab_streaming: 'סטרימינג',
      tab_vpn: 'VPN',
      tab_music: 'מוזיקה',
      tab_tv: 'טלוויזיה',
      tab_software: 'תוכנות',
      loading_catalog: 'טוען את הקטלוג…',
      no_offers_cat: 'אין כרגע הצעות בקטגוריה זו.',
      catalog_error: 'הקטלוג אינו זמין כרגע. נסו שוב בעוד רגע.',
      retry: 'נסה שוב',
      card_save: 'חיסכון',
      card_monthly_equiv: 'כלומר כ-',
      card_reviews: 'ביקורות',
      card_order_btn: 'להזמנה בוואטסאפ',

      // Durations
      dur_1_month: 'חודש 1',
      dur_6_months: '6 חודשים',
      dur_1_year: 'שנה 1',
      dur_n_months: '{n} חודשים',
      dur_per_month: '/ חודש',
      dur_per_6_months: '/ 6 חודשים',
      dur_per_year: '/ שנה',
      dur_per_n_months: '/ {n} חודשים',

      // Composer
      comp_eyebrow: 'חבילה בהתאמה אישית',
      comp_title: 'הרכיבו את החבילה שלכם.',
      comp_desc: 'בחרו את המנויים והשירותים הרצויים. הנחה מיוחדת מופעלת אוטומטית החל מ-3 שירותים ומעלה.',
      comp_receipt_title: 'החבילה שבחרתם',
      comp_total_per_year: 'סה״כ / לשנה',
      comp_total_order: 'סה״כ להזמנה',
      comp_promo_placeholder: 'קוד קופון',
      comp_promo_apply: 'החל קוד',
      comp_promo_remove: 'הסר',
      comp_promo_enter: 'נא להזין קוד קופון.',
      comp_affil_placeholder: 'שיוך: שם הממליץ (אופציונלי)',
      comp_name_placeholder: 'שם פרטי (אופציונלי)',
      comp_phone_placeholder: 'מספר וואטסאפ (אופציונלי)',
      comp_order_btn: 'הזמנת חבילה זו בוואטסאפ',
      comp_empty: 'יש לבחור לפחות מנוי אחד להרכבת החבילה.',
      comp_discount_pack: 'הנחת חבילה',

      // Steps
      steps_eyebrow: 'תהליך הזמנה',
      steps_title: 'שלושה שלבים קלים, ללא טפסים מסובכים.',
      step1_title: 'בחרו תוכנית',
      step1_desc: 'עיינו בקטלוג או הרכיבו חבילה אישית באמצעות המחשבון המהיר.',
      step2_title: 'ההודעה מוכנה בוואטסאפ',
      step2_desc: 'וואטסאפ נפתח עם הודעה מוכנה הכוללת את המוצרים, המחיר ומספר ההזמנה שלכם.',
      step3_title: 'אישור והפעלה',
      step3_desc: 'התשלום וההפעלה המיידית מתבצעים ישירות מול נציג שירות אישי בצ\'אט.',

      // FAQ
      faq_eyebrow: 'שאלות ותשובות',
      faq_title: 'כל מה שחשוב לדעת.',
      faq_q1: 'איך מתבצעת ההזמנה?',
      faq_a1: 'בוחרים תוכנית, נפתחת הודעה מוכנה בוואטסאפ עם ההצעה והמחיר. שולחים לנו אותה, אנו מאשרים זמינות ושולחים הוראות תשלום עם מספר מעקב.',
      faq_q2: 'אילו אמצעי תשלום מתקבלים?',
      faq_a2: 'תשלום באמצעות Revolut, העברה בנקאית או מטבעות דיגיטליים (קריפטו). אין צורך להזין פרטי אשראי באתר: הכל מתבצע בצורה מאובטחת בוואטסאפ.',
      faq_q3: 'תוך כמה זמן מקבלים את הפרטים?',
      faq_a3: 'מרגע קבלת התשלום, ההפעלה מתבצעת באופן מיידי, 7 ימים בשבוע. לרוב תוך מספר דקות בודדות.',
      faq_q4: 'מה כוללת האחריות?',
      faq_a4: 'כל מנוי מכוסה באחריות מלאה לכל תקופת הרכישה (12 חודשים). במקרה של תקלה אנו מחליפים את החשבון מיידית או מזכים בהתאם.',
      faq_q5: 'בכמה מכשירים ניתן להשתמש בו-זמנית?',
      faq_a5: 'כל מנוי מיועד לשימוש אישי במכשיר אחד בכל פעם, אלא אם צוין אחרת במפורש. למספר מסכים יש לבחור בחבילה משפחתית.',
      faq_q6: 'האם אפשר להזמין עבור חבר?',
      faq_a6: 'כן בהחלט! רשמו את שמו בשדה השיוך, וההזמנה תקושר אליו אוטומטית.',
      faq_q7: 'מה קורה בסיום תקופת המנוי?',
      faq_a7: 'המנוי מסתיים בתום התקופה ללא חידוש אוטומטי וללא חיובים נסתרים. נשלח לכם תזכורת ידידותית אם תרצו לחדש.',

      // Reviews modal
      reviews_title: 'חוות דעת מאומתות מלקוחות',
      reviews_overall: 'דירוג כללי',
      reviews_leave_title: 'הוספת חוות דעת מאומתת',
      reviews_your_name: 'שמכם הפרטי',
      reviews_your_comment: 'ספרו על חווית השירות (איכות, מהירות הפעלה, תמיכה)...',
      reviews_submit: 'פרסום חוות דעת',
      reviews_note: 'חוות הדעת נבדקות לפני פרסום כדי להבטיח אמינות מלאה.',

      // Footer
      foot_desc: 'אספקת מנויים שנתיים לשירותי סטרימינג ובידור מובילים. תמיכה אישית 7 ימים בשבוע ואחריות מלאה לכל אורך תקופת המנוי.',
      foot_services: 'שירותים וחדשות',
      foot_plans: 'תוכניות שנתיות',
      foot_custom_pack: 'הרכבת חבילה אישית',
      foot_news_contest: 'חדשות והגרלות',
      foot_network_status: 'סטטוס שרתים בזמן אמת',
      foot_portal_support: 'אזור אישי ותמיכה',
      foot_my_account: 'האזור האישי שלי',
      foot_find_access: 'איתור פרטי גישה',
      foot_warranty_charter: 'אמנת שירות ואחריות',
      foot_faq_link: 'שאלות ותשובות',
      foot_order_procedure: 'איך זה עובד',
      foot_install_app: 'התקנת האפליקציה',
      foot_legal_security: 'מידע משפטי ואבטחה',
      foot_terms: 'תנאי שימוש',
      foot_legal: 'מידע משפטי',
      foot_rgpd: 'הגנת פרטיות',
      foot_ssl: 'הצפנת SSL מאובטחת',
      foot_rights: '© 2026 NeonPass. כל הזכויות שמורות.',
      foot_payments: 'תשלומים מאובטחים באמצעות Revolut, העברה בנקאית וקריפטו. ללא חידוש אוטומטי.',

      // WhatsApp floating & templates
      wa_float_text: 'וואטסאפ',
      wa_float_aria: 'שלחו הודעה בוואטסאפ',
      wa_single_msg: "שלום, ברצוני להזמין את ההצעה « {name} » ({dur}) במחיר {price}.",
      wa_pack_msg: "שלום, ברצוני להזמין חבילה זו: {items}. סה״כ לתשלום: {total}.",
      wa_question_msg: "שלום, יש לי שאלה לגבי המבצעים שלכם.",
      hero_offers_count_plural: "הצעות זמינות",
      hero_offers_count_singular: "הצעה זמינה",

      // Client portal
      compte_tab_login: 'התחברות',
      compte_tab_register: 'יצירת חשבון',
      compte_email_label: 'כתובת אימייל',
      compte_password_label: 'סיסמה',
      compte_login_btn: 'כניסה לחשבון',
      compte_forgot_btn: 'שכחתי סיסמה',
      compte_register_btn: 'המשך בהרשמה',
      compte_tab_subs: 'המנויים שלי',
      compte_tab_link: 'שיוך הזמנה',
      compte_tab_profile: 'פרופיל ואבטחה',
      compte_tab_referral: '🎁 תוכנית חברים (-50%)',
      compte_kpi_total: 'סה״כ שולם',
      compte_kpi_subs: 'מנויים פעילים',
      compte_kpi_expiry: 'תוקף קרוב',
      compte_kpi_warranty: '12 חודשי אחריות'
    }
  };

  // Traductions dédiées pour le catalogue de produits (cartes, descriptions, features, tags)
  const OFFERS_I18N = {
    'pack-xpressvpn-disney': {
      en: {
        name: 'Pack XpressVPN + Disney+',
        tag: 'Bundle',
        description: 'Family streaming and secure VPN in one single annual plan.',
        features: ['Family movies & series in HD', 'Unlimited VPN, 5 devices', 'One single payment per year']
      },
      he: {
        name: 'חבילת XpressVPN + Disney+',
        tag: 'חבילה',
        description: 'סטרימינג לכל המשפחה ו-VPN פרימיום במנוי שנתי אחד משתלם.',
        features: ['סרטים וסדרות לכל המשפחה ב-HD', 'חיבור VPN ללא הגבלה, 5 מכשירים', 'תשלום שנתי אחד קבוע']
      }
    },
    'netflix': {
      en: {
        name: 'Netflix',
        tag: 'Streaming',
        description: 'Original series and movies, 100% ad-free.',
        features: ['Full catalog in 4K Ultra HD', '1 simultaneous screen', '1 Dedicated Profile']
      },
      he: {
        name: 'Netflix',
        tag: 'סטרימינג',
        description: 'סדרות וסרטים מקוריים, ללא פרסומות.',
        features: ['קטלוג מלא באיכות 4K', 'מסך 1 בו-זמנית', 'פרופיל אישי ייעודי']
      }
    },
    'prime-video': {
      en: {
        name: 'Prime Video',
        tag: 'Streaming',
        description: 'Recent movies, exclusive series and cinema releases.',
        features: ['New releases every week', 'Offline downloads', 'Multi-language subtitles']
      },
      he: {
        name: 'Prime Video',
        tag: 'סטרימינג',
        description: 'סרטים חדשים, סדרות בלעדיות והפקות קולנוע.',
        features: ['תכנים חדשים מדי שבוע', 'הורדה לצפייה ללא אינטרנט', 'כתוביות בשפות שונות']
      }
    },
    'xpressvpn': {
      en: {
        name: 'XpressVPN',
        tag: 'VPN',
        description: 'Essential encrypted connection, simple, fast and reliable.',
        features: ['Servers across 60 countries', '3 simultaneous devices', 'Military-grade 256-bit encryption']
      },
      he: {
        name: 'XpressVPN',
        tag: 'VPN',
        description: 'חיבור מוצפן חיוני, פשוט ומהיר לגלישה בטוחה.',
        features: ['שרתים ב-60 מדינות', 'עד 3 מכשירים במקביל', 'הצפנת 256-bit מתקדמת']
      }
    },
    'nordvpn': {
      en: {
        name: 'NordVPN',
        tag: 'VPN',
        description: 'More devices, ultra-fast speeds and reinforced cybersecurity.',
        features: ['Ultra-fast servers in 100 countries', 'Up to 10 devices', 'Ad & tracker blocker']
      },
      he: {
        name: 'NordVPN',
        tag: 'VPN',
        description: 'יותר מכשירים, מהירות שיא והגנה מקוונת מוגברת.',
        features: ['שרתים ב-100 מדינות', 'עד 10 מכשירים', 'חסימת פרסומות ומעקבים']
      }
    },
    'spotify-premium': {
      en: {
        name: 'Spotify Premium',
        tag: 'Music',
        description: 'All your music, ad-free, with offline playback anytime.',
        features: ['High-fidelity lossless audio', 'Personalized daily playlists', 'Offline listening']
      },
      he: {
        name: 'Spotify Premium',
        tag: 'מוזיקה',
        description: 'כל המוזיקה שאתם אוהבים, ללא פרסומות ועם האזנה אופליין.',
        features: ['איכות שמע מעולה (Hi-Fi)', 'פלייליסטים בהתאמה אישית', 'האזנה ללא חיבור לאינטרנט']
      }
    },
    'iptv-premium': {
      en: {
        name: 'IPTV Premium',
        tag: 'TV',
        description: 'Live international TV channels and replay on all your screens.',
        features: ['Full live TV & sports channels', '7-day catch-up replay', 'Mobile & Smart TV compatible']
      },
      he: {
        name: 'IPTV פרימיום',
        tag: 'טלוויזיה',
        description: 'ערוצים בשידור חי ו-VOD עשיר בכל המסכים שלכם.',
        features: ['ערוצי שידור חי וספורט', 'שידור חוזר 7 ימים (Replay)', 'תואם לסמארטפון ולטלוויזיה']
      }
    },
    'canva-pro': {
      en: {
        name: 'Canva Pro',
        tag: 'Design',
        description: 'Easily create professional visual designs with Canva Pro premium tools.',
        features: ['Unlimited premium templates & assets', 'One-click background remover', 'Magic Resize tool', 'AI-powered creative tools']
      },
      he: {
        name: 'Canva Pro',
        tag: 'עיצוב',
        description: 'יצירת גרפיקה מקצועית בקלות עם כל כלי הפרימיום של Canva.',
        features: ['תבניות ואלמנטים פרימיום ללא הגבלה', 'הסרת רקע בלחיצת כפתור', 'שינוי גודל אוטומטי (Magic Resize)', 'כלי יצירה מבוססי AI']
      }
    },
    'capcut-pro': {
      en: {
        name: 'CapCut Pro',
        tag: 'Video Editing',
        description: 'Produce advanced video edits with CapCut suite of premium tools.',
        features: ['Premium effects & pro transitions', 'Auto-generated captions', 'AI video editing suite', 'Full premium asset library']
      },
      he: {
        name: 'CapCut Pro',
        tag: 'עריכת וידאו',
        description: 'עריכת סרטונים מקצועית ברמה הגבוהה ביותר עם כלי CapCut.',
        features: ['אפקטים ומעברים מקצועיים', 'כתוביות אוטומטיות מהירות', 'כלי עריכה מתקדמים ב-AI', 'מאגר תבניות ואלמנטים פרימיום']
      }
    },
    'hbo-max': {
      en: {
        name: 'HBO Max',
        tag: 'Streaming',
        description: 'Stream acclaimed HBO Original series, hit movies and documentaries.',
        features: ['HBO Original series', 'Blockbuster movies & new releases', 'Award-winning documentaries', 'On-demand 4K streaming']
      },
      he: {
        name: 'HBO Max',
        tag: 'סטרימינג',
        description: 'כל סדרות המופת של HBO, סרטי קולנוע ותכנים דוקומנטריים.',
        features: ['סדרות מקור עטורות שבחים מ-HBO', 'סרטים שוברי קופות חדשים', 'סרטים דוקומנטריים מובילים', 'צפייה ישירה באיכות 4K']
      }
    },
    'paramount-plus-fr': {
      en: {
        name: 'Paramount+',
        tag: 'Streaming',
        description: 'Stream exclusive movies, series and Paramount+ hit original shows.',
        features: ['Exclusive films & hit series', 'Paramount Studios productions', 'Original exclusive shows', 'Full entertainment catalog']
      },
      he: {
        name: 'Paramount+',
        tag: 'סטרימינג',
        description: 'סרטים בלעדיים, סדרות מובילות ותכני מקור של Paramount+.',
        features: ['סרטים וסדרות בלעדיים', 'הפקות ענק של Paramount', 'סדרות מקור חדשות', 'ספריית בידור עשירה']
      }
    },
    'disney-plus': {
      en: {
        name: 'Disney+',
        tag: 'Popular',
        description: 'Unlimited movies & series from Disney, Pixar, Marvel, Star Wars and Star.',
        features: ['Unlimited movies & series', '4K Ultra HD quality', 'Personal private profile', '1-Year full warranty']
      },
      he: {
        name: 'Disney+',
        tag: 'פופולרי',
        description: 'סרטים וסדרות מבית דיסני, פיקסאר, מארוול, מלחמת הכוכבים ו-Star.',
        features: ['סרטים וסדרות ללא הגבלה', 'איכות 4K Ultra HD', 'פרופיל אישי פרטי', 'אחריות מלאה ל-12 חודשים']
      }
    },
    'crunchyroll': {
      en: {
        name: 'Crunchyroll',
        tag: 'Anime',
        description: "Stream the world's largest anime library with simulcasts direct from Japan.",
        features: ['Simulcast episodes 1 hour after Japan', 'Ad-free HD anime streaming', 'Offline downloads']
      },
      he: {
        name: 'Crunchyroll',
        tag: 'אנימה',
        description: 'ספריית האנימה הגדולה בעולם בצפייה ישירה ובאיכות גבוהה.',
        features: ['פרקים חדשים שעה לאחר השידור ביפן', 'צפייה ללא פרסומות ב-HD', 'הורדה לצפייה ללא אינטרנט']
      }
    },
    'duolingo': {
      en: {
        name: 'Duolingo Super',
        tag: 'Software',
        description: 'Master languages fast and effectively with no ads and unlimited hearts.',
        features: ['Unlimited hearts', '100% ad-free learning', 'Personalized mistake review', 'Weekly progress insights']
      },
      he: {
        name: 'Duolingo Super',
        tag: 'תוכנות',
        description: 'לימוד שפות מהיר ומהנה ללא פרסומות ועם לבבות ללא הגבלה.',
        features: ['לבבות ללא הגבלה', 'ללא פרסומות כלל', 'אימונים מותאמים אישית', 'מעקב התקדמות שבועי']
      }
    },
    'claude-nolimittoken': {
      en: {
        name: 'Claude AI Pro',
        tag: 'AI',
        description: 'Next-gen AI assistant for advanced coding, writing and complex reasoning.',
        features: ['Claude 3.5 Sonnet & Opus access', 'Massive context window', 'Fast peak performance', 'Multi-file document analysis']
      },
      he: {
        name: 'Claude AI Pro',
        tag: 'בינה מלאכותית',
        description: 'עוזר בינה מלאכותית מהמתקדמים בעולם לכתיבה, תכנות ומחקר.',
        features: ['גישה לדגמי Claude 3.5 המובילים', 'חלון הקשר ענק לניתוח קבצים', 'זמינות ומהירות מענה מקסימלית', 'יכולות תכנות ומחקר ברמה הגבוהה ביותר']
      }
    },
    'iptv-2-ecran': {
      en: {
        name: 'IPTV 2 Screens',
        tag: 'TV',
        description: 'Watch live channels and movies simultaneously across 2 devices.',
        features: ['2 simultaneous screens', 'Full sports & cinema channels', 'VOD 4K library', 'Full 12-month warranty']
      },
      he: {
        name: 'IPTV 2 מסכים',
        tag: 'טלוויזיה',
        description: 'ערוצי פרימיום בשידור חי בו-זמנית בשני מסכים נפרדים.',
        features: ['2 מסכים לצפייה במקביל', 'כל ערוצי הספורט והסרטים', 'ספריית VOD באיכות 4K', 'אחריות ותמיכה ל-12 חודשים']
      }
    }
  };

  // Dictionnaire de secours pour les puces et tags récurrents
  const PHRASE_I18N = {
    en: {
      'Populaire': 'Popular',
      'Streaming': 'Streaming',
      'VPN': 'VPN',
      'Musique': 'Music',
      'TV': 'TV',
      'Logiciels': 'Software',
      'Logiciel': 'Software',
      'Montage vidéo': 'Video Editing',
      'Création': 'Design',
      'Pack': 'Bundle',
      'AI': 'AI',
      'Qualité audio haute fidélité': 'High-fidelity audio quality',
      'Listes personnalisées': 'Personalized playlists',
      'Écoute hors ligne': 'Offline listening',
      '1 Profil': '1 Dedicated Profile',
      '1 écrans en simultané': '1 screen at a time',
      '2 écrans en simultané': '2 simultaneous screens',
      'Catalogue complet en 4K': 'Full 4K catalog',
      'Films et séries illimités': 'Unlimited movies & series',
      '4K Ultra HD': '4K Ultra HD',
      'Profil personnel': 'Personal Profile',
      'Garantie 1 an': '1-Year Warranty',
      'Serveurs dans 60 pays': 'Servers in 60 countries',
      'Serveurs dans 100 pays': 'Servers in 100 countries',
      '3 appareils': '3 devices',
      '10 appareils': '10 devices',
      'Chiffrement 256 bits': '256-bit encryption',
      'Chaînes en direct': 'Live channels',
      'Replay 7 jours': '7-day catch-up replay',
      'Compatible mobile et TV': 'Mobile & TV compatible',
      'Séries HBO Original': 'HBO Original series',
      'Films et nouveautés': 'New hit movies',
      'Documentaires': 'Documentaries',
      'Visionnage à la demande': 'On-demand streaming',
      'Films et séries exclusifs': 'Exclusive movies & series',
      'Productions Paramount': 'Paramount productions',
      'Séries originales': 'Original series',
      'Catalogue de divertissement': 'Entertainment catalog',
      'Modèles et contenus premium': 'Premium templates & assets',
      'Suppression d’arrière-plan': 'Background remover',
      'Redimensionnement magique': 'Magic resize tool',
      'Outils de création avec IA': 'AI creative tools',
      'Effets et transitions premium': 'Pro effects & transitions',
      'Sous-titres automatiques': 'Auto-generated captions',
      'Outils IA de montage': 'AI video editing tools',
      'Modèles et ressources premium': 'Premium templates & assets',
      'Nouveautés chaque semaine': 'New releases every week',
      'Téléchargement hors ligne': 'Offline downloads',
      'Sous-titres multilingues': 'Multi-language subtitles',
      'Blocage des traqueurs': 'Ad & tracker blocker',
      'Films et séries famille en HD': 'Family movies & series in HD',
      'VPN illimité, 5 appareils': 'Unlimited VPN, 5 devices',
      'Un seul paiement par an': 'One single payment per year'
    },
    he: {
      'Populaire': 'פופולרי',
      'Streaming': 'סטרימינג',
      'VPN': 'VPN',
      'Musique': 'מוזיקה',
      'TV': 'טלוויזיה',
      'Logiciels': 'תוכנות',
      'Logiciel': 'תוכנות',
      'Montage vidéo': 'עריכת וידאו',
      'Création': 'עיצוב',
      'Pack': 'חבילה',
      'AI': 'בינה מלאכותית',
      'Qualité audio haute fidélité': 'איכות שמע מעולה ב-Hi-Fi',
      'Listes personnalisées': 'פלייליסטים מותאמים אישית',
      'Écoute hors ligne': 'האזנה ללא אינטרנט',
      '1 Profil': 'פרופיל אישי ייעודי',
      '1 écrans en simultané': 'מסך 1 בו-זמנית',
      '2 écrans en simultané': '2 מסכים בו-זמנית',
      'Catalogue complet en 4K': 'קטלוג מלא באיכות 4K',
      'Films et séries illimités': 'סרטים וסדרות ללא הגבלה',
      '4K Ultra HD': '4K Ultra HD',
      'Profil personnel': 'פרופיל אישי פרטי',
      'Garantie 1 an': 'שנת אחריות מלאה',
      'Serveurs dans 60 pays': 'שרתים ב-60 מדינות',
      'Serveurs dans 100 pays': 'שרתים ב-100 מדינות',
      '3 appareils': 'עד 3 מכשירים',
      '10 appareils': 'עד 10 מכשירים',
      'Chiffrement 256 bits': 'הצפנת 256-bit מתקדמת',
      'Chaînes en direct': 'ערוצים בשידור חי',
      'Replay 7 jours': 'שידור חוזר 7 ימים',
      'Compatible mobile et TV': 'תואם לנייד ולטלוויזיה',
      'Séries HBO Original': 'סדרות מקור של HBO',
      'Films et nouveautés': 'סרטים חדשים ובלעדיים',
      'Documentaires': 'סרטים תיעודיים מובילים',
      'Visionnage à la demande': 'צפייה ישירה VOD',
      'Films et séries exclusifs': 'סרטים וסדרות בלעדיים',
      'Productions Paramount': 'הפקות ענק של Paramount',
      'Séries originales': 'סדרות מקור חדשות',
      'Catalogue de divertissement': 'ספריית בידור עשירה',
      'Modèles et contenus premium': 'תבניות ואלמנטים פרימיום',
      'Suppression d’arrière-plan': 'הסרת רקע בלחיצת כפתור',
      'Redimensionnement magique': 'שינוי גודל אוטומטי',
      'Outils de création avec IA': 'כלי יצירה ב-AI',
      'Effets et transitions premium': 'אפקטים ומעברים מקצועיים',
      'Sous-titres automatiques': 'כתוביות אוטומטיות מהירות',
      'Outils IA de montage': 'כלי עריכה ב-AI',
      'Modèles et ressources premium': 'תבניות ומשאבים פרימיום',
      'Nouveautés chaque semaine': 'תכנים חדשים מדי שבוע',
      'Téléchargement hors ligne': 'הורדה לצפייה ללא אינטרנט',
      'Sous-titres multilingues': 'כתוביות בשפות שונות',
      'Blocage des traqueurs': 'חסימת פרסומות ומעקבים',
      'Films et séries famille en HD': 'סרטים וסדרות לכל המשפחה ב-HD',
      'VPN illimité, 5 appareils': 'חיבור VPN ללא הגבלה, 5 מכשירים',
      'Un seul paiement par an': 'תשלום שנתי אחד קבוע'
    }
  };

  function translateOffer(o, lang = currentLang) {
    if (!o) return o;
    if (lang === 'fr') return o;

    const slug = o.slug || '';
    const offerDict = (OFFERS_I18N[slug] && OFFERS_I18N[slug][lang]) || {};
    const phrases = PHRASE_I18N[lang] || {};

    const name = offerDict.name || phrases[o.name] || o.name;
    const tag = offerDict.tag || phrases[o.tag] || (phrases[o.category] || o.tag || '');
    const description = offerDict.description || phrases[o.description] || o.description;
    
    const features = (o.features || []).map((feat, idx) => {
      if (offerDict.features && offerDict.features[idx]) return offerDict.features[idx];
      return phrases[feat] || feat;
    });

    return {
      ...o,
      name,
      tag,
      description,
      features
    };
  }

  // 1. Détection intelligente de la langue
  function detectLanguage() {
    // 1. Paramètre URL prioritaire (?lang=...)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlLang = (urlParams.get('lang') || '').toLowerCase();
      if (SUPPORTED_LANGS.includes(urlLang)) {
        localStorage.setItem('np_lang', urlLang);
        return urlLang;
      }
    } catch (_) {}

    // 2. Préférence utilisateur mémorisée dans localStorage
    try {
      const saved = localStorage.getItem('np_lang');
      if (saved && SUPPORTED_LANGS.includes(saved)) {
        return saved;
      }
    } catch (_) {}

    // 3. Détection de la langue du système / navigateur (navigator.languages ou navigator.language)
    const navLangs = navigator.languages || [navigator.language || navigator.userLanguage || ''];
    for (const l of navLangs) {
      if (!l) continue;
      const lower = l.toLowerCase();
      if (lower.startsWith('he') || lower.startsWith('iw')) return 'he';
      if (lower.startsWith('en')) return 'en';
      if (lower.startsWith('fr')) return 'fr';
    }

    // 4. Par défaut : Français
    return 'fr';
  }

  let currentLang = detectLanguage();

  function t(key, fallback = '') {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.fr;
    if (dict && dict[key] !== undefined) return dict[key];
    const frDict = TRANSLATIONS.fr;
    if (frDict && frDict[key] !== undefined) return frDict[key];
    return fallback || key;
  }

  // 2. Application de la langue et direction (LTR / RTL)
  function applyLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) lang = 'fr';
    currentLang = lang;
    try { localStorage.setItem('np_lang', lang); } catch (_) {}

    const meta = LANG_META[lang] || LANG_META.fr;
    const isRtl = meta.dir === 'rtl';

    // Attributs racine HTML
    const html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', meta.dir);

    if (isRtl) {
      html.classList.add('is-rtl');
      if (document.body) document.body.classList.add('is-rtl');
    } else {
      html.classList.remove('is-rtl');
      if (document.body) document.body.classList.remove('is-rtl');
    }

    // Traduction de tous les éléments DOM marqués
    translateDom();

    // Mise à jour de l'affichage du sélecteur
    updateSwitcherUI();

    // Émission de l'événement global
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang, meta, isRtl } }));
  }

  // 3. Traduction des balises DOM
  function translateDom() {
    // Balises textes simples
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const text = t(key);
      if (text) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.value = text;
        } else {
          el.textContent = text;
        }
      }
    });

    // Balises HTML riches
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      const text = t(key);
      if (text) el.innerHTML = text;
    });

    // Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const text = t(key);
      if (text) el.setAttribute('placeholder', text);
    });

    // Titres / Tooltips
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      const text = t(key);
      if (text) el.setAttribute('title', text);
    });

    // Labels d'accessibilité (aria-label)
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      const text = t(key);
      if (text) el.setAttribute('aria-label', text);
    });
  }

  // 4. Injection des styles CSS essentiels pour le Sélecteur & RTL
  function injectI18nStyles() {
    if (document.getElementById('np-i18n-styles')) return;
    const style = document.createElement('style');
    style.id = 'np-i18n-styles';
    style.textContent = `
      /* Sélecteur de Langue NeonPass */
      .lang-switcher-wrapper {
        position: relative;
        display: inline-flex;
        align-items: center;
        z-index: 50;
      }
      .lang-switcher-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(160, 150, 255, 0.22);
        color: #efecff;
        padding: 7px 12px;
        border-radius: 999px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      .lang-switcher-btn:hover {
        background: rgba(43, 230, 255, 0.12);
        border-color: rgba(43, 230, 255, 0.45);
        color: #2be6ff;
        box-shadow: 0 0 16px rgba(43, 230, 255, 0.25);
      }
      .lang-switcher-btn .lang-flag {
        font-size: 14px;
        line-height: 1;
      }
      .lang-switcher-btn .lang-caret {
        width: 10px;
        height: 10px;
        transition: transform 0.2s;
        fill: currentColor;
      }
      .lang-switcher-wrapper.is-open .lang-caret {
        transform: rotate(180deg);
      }
      .lang-menu-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        min-width: 140px;
        background: rgba(12, 10, 26, 0.96);
        border: 1px solid rgba(160, 150, 255, 0.28);
        border-radius: 14px;
        padding: 6px;
        box-shadow: 0 18px 40px -10px rgba(0, 0, 0, 0.75), 0 0 20px rgba(122, 92, 255, 0.18);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        display: none;
        flex-direction: column;
        gap: 3px;
        z-index: 1000;
      }
      html[dir="rtl"] .lang-menu-dropdown {
        right: auto;
        left: 0;
      }
      .lang-switcher-wrapper.is-open .lang-menu-dropdown {
        display: flex;
        animation: langPop .2s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes langPop {
        from { opacity: 0; transform: translateY(-6px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .lang-opt-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        border-radius: 10px;
        border: none;
        background: transparent;
        color: #efecff;
        font-family: 'Sora', sans-serif;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        text-align: left;
      }
      html[dir="rtl"] .lang-opt-item {
        text-align: right;
      }
      .lang-opt-item:hover {
        background: rgba(43, 230, 255, 0.12);
        color: #2be6ff;
      }
      .lang-opt-item.is-active {
        background: rgba(43, 230, 255, 0.16);
        color: #2be6ff;
        font-weight: 700;
      }
      .lang-opt-item .opt-check {
        font-size: 12px;
        color: #2be6ff;
        opacity: 0;
      }
      .lang-opt-item.is-active .opt-check {
        opacity: 1;
      }

      /* Barres sélecteurs dans le Drawer Mobile */
      .drawer-lang-selector {
        padding: 14px 18px;
        border-top: 1px solid rgba(160, 150, 255, 0.12);
        margin-top: auto;
      }
      .drawer-lang-pills {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
      .drawer-lang-pill {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 9px 8px;
        border-radius: 12px;
        border: 1px solid rgba(160, 150, 255, 0.18);
        background: rgba(255, 255, 255, 0.04);
        color: #efecff;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
      }
      .drawer-lang-pill.is-active {
        background: rgba(43, 230, 255, 0.18);
        border-color: #2be6ff;
        color: #2be6ff;
        box-shadow: 0 0 14px rgba(43, 230, 255, 0.25);
      }

      /* ======================================================== */
      /* RÈGLES RTL (HÉBREU)                                      */
      /* ======================================================== */
      html[dir="rtl"] {
        direction: rtl;
        text-align: right;
      }
      html[dir="rtl"] body {
        direction: rtl;
        text-align: right;
      }
      html[dir="rtl"] .wa-float {
        right: auto !important;
        left: calc(max(16px, env(safe-area-inset-left, 0px))) !important;
      }
      html[dir="rtl"] .hero-cta {
        flex-direction: row;
      }
      html[dir="rtl"] .feat li {
        flex-direction: row;
      }
      html[dir="rtl"] .nav-drawer {
        direction: rtl;
        text-align: right;
      }
      html[dir="rtl"] .nav-drawer-item {
        flex-direction: row-reverse;
      }
      html[dir="rtl"] .nav-drawer-item .drawer-chevron {
        transform: rotate(180deg);
      }
      html[dir="rtl"] .rating-row {
        text-align: right;
      }
      html[dir="rtl"] .chips {
        justify-content: flex-start;
      }
      html[dir="rtl"] .promo {
        flex-direction: row;
      }
      html[dir="rtl"] .step {
        text-align: right;
      }
      html[dir="rtl"] .faq details summary {
        text-align: right;
      }
      html[dir="rtl"] .vault-item {
        text-align: right;
      }
      html[dir="rtl"] .order-header {
        text-align: right;
      }
      html[dir="rtl"] .toast {
        direction: rtl;
        text-align: right;
      }
      html[dir="rtl"] .nav-burger span {
        margin-right: auto;
      }
    `;
    document.head.appendChild(style);
  }

  // 5. Montage du sélecteur de langue dans l'en-tête et le drawer
  function mountLanguageSwitcher() {
    injectI18nStyles();

    // Montage dans la barre de navigation
    const navIn = document.querySelector('.nav-in') || document.querySelector('header .wrap') || document.querySelector('header');
    if (navIn && !document.getElementById('npLangSwitcher')) {
      const actionsGroup = navIn.querySelector('.nav-actions-group') || navIn;

      const switcherWrapper = document.createElement('div');
      switcherWrapper.id = 'npLangSwitcher';
      switcherWrapper.className = 'lang-switcher-wrapper';

      switcherWrapper.innerHTML = `
        <button type="button" class="lang-switcher-btn" id="npLangBtn" aria-label="Changer de langue / Change language / החלפת שפה" aria-haspopup="true" aria-expanded="false">
          <span class="lang-flag" id="npLangFlag">🇫🇷</span>
          <span class="lang-code" id="npLangCode">FR</span>
          <svg class="lang-caret" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg>
        </button>
        <div class="lang-menu-dropdown" id="npLangMenu" role="menu">
          <button type="button" class="lang-opt-item" data-lang="fr" role="menuitem">
            <span>🇫🇷 Français</span>
            <span class="opt-check">✓</span>
          </button>
          <button type="button" class="lang-opt-item" data-lang="en" role="menuitem">
            <span>🇬🇧 English</span>
            <span class="opt-check">✓</span>
          </button>
          <button type="button" class="lang-opt-item" data-lang="he" role="menuitem">
            <span>🇮🇱 עברית</span>
            <span class="opt-check">✓</span>
          </button>
        </div>
      `;

      // Insérer avant le bouton login / hamburger pour une harmonie parfaite
      const burger = actionsGroup.querySelector('.nav-burger');
      const loginBtn = actionsGroup.querySelector('#navLogin') || actionsGroup.querySelector('.btn-primary');
      if (loginBtn) {
        actionsGroup.insertBefore(switcherWrapper, loginBtn);
      } else if (burger) {
        actionsGroup.insertBefore(switcherWrapper, burger);
      } else {
        actionsGroup.appendChild(switcherWrapper);
      }

      // Événements du menu
      const btn = switcherWrapper.querySelector('#npLangBtn');
      const menu = switcherWrapper.querySelector('#npLangMenu');

      if (btn && menu) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = switcherWrapper.classList.toggle('is-open');
          btn.setAttribute('aria-expanded', String(isOpen));
        });

        menu.querySelectorAll('.lang-opt-item').forEach((opt) => {
          opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetLang = opt.getAttribute('data-lang');
            if (targetLang) {
              applyLanguage(targetLang);
              switcherWrapper.classList.remove('is-open');
              btn.setAttribute('aria-expanded', 'false');
            }
          });
        });
      }

      // Fermeture au clic extérieur
      document.addEventListener('click', (e) => {
        if (!switcherWrapper.contains(e.target)) {
          switcherWrapper.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Montage dans le Drawer Mobile (#navDrawer) s'il existe
    const drawer = document.getElementById('navDrawer');
    if (drawer && !drawer.querySelector('.drawer-lang-selector')) {
      const drawerInner = drawer.querySelector('.nav-drawer-inner') || drawer;
      const langBox = document.createElement('div');
      langBox.className = 'drawer-lang-selector';
      langBox.innerHTML = `
        <span class="drawer-section-label">Langue · Language · שפה</span>
        <div class="drawer-lang-pills">
          <button type="button" class="drawer-lang-pill" data-lang="fr">🇫🇷 FR</button>
          <button type="button" class="drawer-lang-pill" data-lang="en">🇬🇧 EN</button>
          <button type="button" class="drawer-lang-pill" data-lang="he">🇮🇱 עברית</button>
        </div>
      `;

      langBox.querySelectorAll('.drawer-lang-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          const l = pill.getAttribute('data-lang');
          if (l) applyLanguage(l);
        });
      });

      drawerInner.appendChild(langBox);
    }

    updateSwitcherUI();
  }

  // 6. Mise à jour des boutons actifs dans l'UI
  function updateSwitcherUI() {
    const meta = LANG_META[currentLang] || LANG_META.fr;

    const flagEl = document.getElementById('npLangFlag');
    const codeEl = document.getElementById('npLangCode');
    if (flagEl) flagEl.textContent = meta.flag;
    if (codeEl) codeEl.textContent = meta.code;

    document.querySelectorAll('.lang-opt-item').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-lang') === currentLang);
    });

    document.querySelectorAll('.drawer-lang-pill').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-lang') === currentLang);
    });
  }

  // 7. Initialisation dès le chargement du document
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountLanguageSwitcher();
      applyLanguage(currentLang);
    });
  } else {
    mountLanguageSwitcher();
    applyLanguage(currentLang);
  }

  // Observer pour ré-attacher le sélecteur si le header ou drawer est régénéré par un script tiers
  const observer = new MutationObserver(() => {
    if (!document.getElementById('npLangSwitcher')) {
      mountLanguageSwitcher();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Exposition globale
  window.NeonPassI18N = {
    t,
    setLanguage: applyLanguage,
    getLanguage: () => currentLang,
    getSupportedLanguages: () => [...SUPPORTED_LANGS],
    getLanguageMeta: (l) => LANG_META[l || currentLang],
    translatePage: translateDom,
    translateOffer: (o, l) => translateOffer(o, l || currentLang),
    translations: TRANSLATIONS
  };
  window.t = t;
})();
