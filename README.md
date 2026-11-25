<div align="center">

# ⚡ NeonPass

**Plateforme E-Commerce, CRM Abonnements & Coffre-fort de Licences Numériques**  
*Tunnel de vente WhatsApp · Espace client sécurisé 24/7 · Stock unitaire & packs commerciaux · Suivi SAV · Sauvegardes intégrées*

[![Node.js](https://img.shields.io/badge/Node.js-v22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Traefik](https://img.shields.io/badge/Traefik-v2.6-24A1C1?style=for-the-badge&logo=traefik&logoColor=white)](https://traefik.io/)
[![Security](https://img.shields.io/badge/Security-2FA%20%7C%20Audit%20Log-8A2BE2?style=for-the-badge&logo=shield&logoColor=white)](#-sécurité--conformité)
[![Status](https://img.shields.io/badge/Production-Ready-00F2FE?style=for-the-badge)](#-déploiement-en-production)

---
</div>

## 📑 Sommaire

- [Aperçu & Vision](#-aperçu--vision)
- [Fonctionnalités Clés](#-fonctionnalités-clés)
  - [Boutique & Tunnel WhatsApp](#1-boutique-en-ligne--tunnel-whatsapp)
  - [Panel Admin CRM](#2-panel-admin-crm-moderne)
  - [Gestion de Stock & Découplage Packs](#3-coffre-fort-de-comptes--gestion-de-stock)
  - [Workflow SAV & Remplacement](#4-workflow-sav--remplacement-intelligent)
  - [Espace Abonné Sécurisé 24/7](#5-espace-abonné-sécurisé-247-accestoken)
  - [Sauvegarde & Restauration BDD](#6-sauvegarde--restauration-de-la-base-de-données)
  - [PWA & Responsive Mobile](#7-progressive-web-app-pwa--responsive-mobile)
  - [Espace Confiance & Suivi](#8-pages-de-confiance-statut-réseau--suivi)
  - [Comptes Clients & Sécurité OTP](#9-comptes-clients-espace-mon-compte--sécurité-otp-email)
  - [Communication & Campagnes](#10-communication-marketing-campagnes-email--assistant-whatsapp)
  - [Programme de Parrainage (-50%)](#11-programme-de-parrainage--récompenses--50-dès-5-commandes-validées)
  - [Multi-langue & RTL (FR, EN, HE)](#12-moteur-multi-langue-internationalisation-i18n--rtl)
  - [Changelog & Historique](#13-journal-des-mises-à-jour--changelog)
  - [Assistant IA Chatbot (Gemini)](#14-assistant-ia--chatbot-client-google-ai-studio)
- [Architecture & Stack Technique](#-architecture--stack-technique)
- [Installation & Déploiement](#-installation--déploiement)
- [Variables d'Environnement](#-variables-denvironnement-env)
- [Guide Sauvegarde & Restauration](#-guide-sauvegarde--restauration)
- [Sécurité & Conformité](#-sécurité--conformité)
- [Suite de Tests Automatisée](#-suite-de-tests--validation-automatisée)
- [API & Endpoints](#-api--endpoints)
- [Maintenance & Dépannage](#-maintenance--dépannage)

---

## 🌟 Aperçu & Vision

**NeonPass** est une solution complète prête à l'emploi dédiée à la commercialisation d'abonnements numériques et de licences (IPTV, VPN, streaming, logiciels pro). Elle combine :
1. Une **vitrine e-commerce ultra-rapide** optimisée pour la conversion mobile avec tunnel WhatsApp direct.
2. Un **panneau d'administration CRM puissant** avec vue 360° des clients, suivi des échéances et gestion fine de la rentabilité.
3. Un **coffre-fort d'identifiants** gérant le stock unitaire, les packs commerciaux, et les alertes automatiques de réapprovisionnement.
4. Un **module SAV automatisé** pour le remplacement des comptes défectueux sans friction client.
5. Un **système de sauvegarde & restauration** complet directement intégré dans l'interface d'administration (SQL & JSON).

---

## 🚀 Fonctionnalités Clés

### 1. Boutique en ligne & Tunnel WhatsApp
* **Catalogue interactif** : Filtrage par catégorie, notes et avis clients certifiés, badges de réduction.
* **Composeur sur mesure** : Regroupement dynamique de plusieurs services avec calcul de remise automatique paramétrable.
* **Codes promotionnels** : Remises en pourcentage, validité dans le temps, nombre max d'utilisations, lien d'activation directe (`/?promo=CODE`).
* **Tunnel WhatsApp fluide** : Génération instantanée de la commande en base et redirection WhatsApp avec message pré-formaté prêt à l'envoi.

### 2. Panel Admin CRM Moderne
* **Gestion stricte des durées d'offres** :
  * Définition de la durée exacte par l'administrateur (1 mois, 3 mois, 6 mois, 1 an / 12 mois ou durée personnalisée).
  * Cohérence totale du panier et de la commande : le client commande exactement selon la durée configurée.
* **Fiche Commande ergonomique** :
  * **Mode Consultation d'abord** : Synthèse complète du client, durée, échéance, badge des jours restants, produits achetés, comptes attribués et notes privées.
  * **Croix de fermeture rapide `✕`** en haut à droite.
  * **Mode Édition à la demande** avec bouton `✏️ Modifier la commande` et retour direct.
* **CRM Clients complet** :
  * Liste de tous les clients avec statistiques agrégées (commandes passées, CA généré, abonnements actifs, accès détenus).
  * Fiche client 360° avec accès direct WhatsApp, historique des commandes et liste de tous les identifiants attribués (groupés par pack ou individuels).
* **Gestion & Purge du Journal d'Audit** :
  * Purge sélective des logs d'audit directement depuis l'interface avec sélecteur de période : 1h, 6h, 12h, 1 jour, 3 jours, 7 jours, 1 mois ou purge complète.

### 3. Coffre-fort de Comptes & Gestion de Stock
* **Découplage intelligent Packs vs Stock unitaire** :
  * Les packs commerciaux (ex. *Pack XpressVPN + Disney+*) sont vendus au client sous une seule offre, mais piochés individuellement dans leurs stocks unitaires respectifs.
  * Fini les identifiants combinés artificiels : le stock reste modulaire et réutilisable.
* **Double mode d'attribution du stock** :
  * **Attribution Automatique (`⚡ Auto`)** : Pioche instantanément le premier compte disponible en stock libre pour chaque offre ou composant de pack de la commande.
  * **Attribution de Stock Spécifique (`🎯 Spécifique`)** : Modal interactif permettant à l'administrateur de filtrer, comparer et choisir précisément le compte en stock (par exemple selon un slot/profil d'écran, un fournisseur précis ou des notes d'installation) et de l'assigner manuellement à la commande.
  * **Attribution directe depuis l'onglet Stock (`🎯 Attribuer`)** : Depuis chaque compte disponible du coffre-fort, bouton d'attribution directe ouvrant les commandes candidates avec mise en avant immédiate des commandes en attente de ce produit (`⭐ En attente de ce produit`).
* **Notes privées Admin** : Champ confidentiel visible uniquement dans l'administration pour conserver la facture d'achat, le fournisseur, l'identifiant de garantie ou le numéro d'invoice.
* **Jauges critiques & Alertes de Stock** :
  * Possibilité d'activer ou désactiver globalement les alertes automatiques.
  * Curseur de jauge minimale personnalisable individuellement pour chaque service/compte unitaire.
  * Alerte visuelle et notifications (Telegram / Discord) en cas de stock critique.

### 4. Workflow SAV & Remplacement Intelligent
* **Signalement de panne** :
  * Marque l'accès en SAV avec date exacte et motif de la panne.
  * Affiche immédiatement la note privée d'achat (invoice fournisseur, date de garantie) sans impacter les identifiants du client.
* **Remplacement en un clic** :
  * Attribue un nouveau compte disponible depuis le stock et archive l'ancien compte défectueux.
  * Prépare instantanément un message WhatsApp clair et courtois informant le client du remplacement de ses identifiants.

### 5. Espace Abonné Sécurisé 24/7 (`/acces/:token`)
* **Lien d'accès unique chiffré** pour chaque client.
* **Portail responsive sécurisé** :
  * Affichage propre des identifiants (Login, mot de passe, profil assigné).
  * Formatage spécialisé IPTV : détection automatique des URLs Xtream Codes, liens serveurs Smarters / Samsung / LG et URL playlist M3U.
  * Compteur et badge de garantie en direct.
  * Formulaire d'avis client interactif direct (notation 1 à 5 étoiles, commentaire certifié, lié automatiquement au produit acheté).
  * Bouton direct de contact WhatsApp en cas de besoin.

### 6. Sauvegarde & Restauration de la Base de Données
* **Export direct depuis l'Admin** :
  * `💾 Sauvegarder (SQL)` : Génération à la volée d'un dump PostgreSQL complet (`pg_dump --clean --if-exists`) horodaté englobant l'intégralité du schéma public.
  * `📄 Sauvegarder (JSON v2)` : Snapshot structuré et lisible de l'intégralité des 12 tables applicatives : commandes, stock & comptes, clients CRM, comptes clients web (`customer_accounts`), terminaux de confiance (`customer_known_devices`), récompenses de parrainage (`customer_referral_rewards`), traçabilité des emails (`email_logs`), journal d'audit (`admin_audit`), offres, codes promo, avis et réglages.
* **Restauration sécurisée** :
  * Téléversement simple d'un fichier `.sql` ou `.json`.
  * **Sauvegarde préventive automatique** créée sur le serveur avant toute opération.
  * Restauration JSON intelligente avec respect strict de l'ordre topologique des contraintes de clés étrangères (FK) et réalignement automatique des séquences `SERIAL`.
  * Réapplication systématique des migrations idempotentes (`init.sql`) pour garantir la parfaite synchronisation des colonnes et index.
  * Notification automatique sur Telegram / Discord lors de chaque restauration.

### 7. Progressive Web App (PWA) & Responsive Mobile
* **Installation native sur smartphone et tablette** :
  * Compatible Android (Chrome TWA / WebAPK) et iOS / iPadOS (Safari).
  * Détection d'environnement stricte :
    * **Sur PC / Ordinateur** : Aucun bandeau ni bouton d'installation intempestif.
    * **Sur Mobile non installé** : Bouton d'installation discret dans l'en-tête et notification avec croix de fermeture `✕`.
    * **Sur Mobile déjà installé** : Détection automatique et suppression totale des invites d'installation.
  * Barre de navigation applicative inférieure (Bottom Navigation) en mode plein écran / standalone.
  * Menu tiroir (drawer hamburger) 100% responsive, sans débordement horizontal ni scroll résiduel.

### 8. Pages de Confiance, Statut Réseau & Suivi
* **Suivi de commande & Récupération d'accès (`/suivi`)** :
  * Recherche sécurisée par numéro de commande ou numéro de suivi client unique.
* **Statut réseau en direct (`/status`)** :
  * Disponibilité opérationnelle des serveurs IPTV, VPN et streaming (99.98% uptime, latence FR/EU).
* **Nouveautés & Concours (`/news`)** :
  * Mises en avant des lancements (DAZN, Google One AI Pro) et du jeu concours officiel Instagram `@neonpass_officiel`.
* **Cadre Légal & SAV (`/garantie`, `/cgv`, `/mentions-legales`)** :
  * Charte de garantie 12 mois, engagement SAV en moins de 30 minutes, conformité RGPD.

### 9. Comptes Clients, Espace "Mon Compte" & Sécurité OTP Email
* **Création de compte client en libre-service (`/compte`, `/inscription`, `/connexion`)** :
  * Inscription rapide (Nom, Prénom, Email, Téléphone, Mot de passe).
  * Vérification obligatoire par **code OTP à 6 chiffres envoyé par email** via SMTP sécurisé (Mailo SSL/TLS ou tout fournisseur compatible).
* **Détection proactive de connexion suspecte** :
  * Chaque appareil et adresse IP fait l'objet d'un hachage d'empreinte d'appareil sécurisé (`device_hash`).
  * En cas de tentative de connexion depuis un **nouvel appareil** ou une **adresse IP inconnue**, la connexion directe par mot de passe est bloquée et un code OTP de confirmation est immédiatement envoyé par email avec les détails de la connexion (IP, appareil, date/heure).
  * Une fois le code validé, l'appareil/IP est enregistré dans les équipements de confiance du compte.
* **Espace Client unifié & Coffre-fort d'abonnements** :
  * **Indicateur financier clair** : KPI dédié affichant le total cumulé investi/payé par le client (`totalSpent`) sur l'ensemble de ses abonnements confirmés.
  * **Module SAV en libre-service** : Bouton `🚨 Signaler un problème (SAV)` sur chaque carte d'accès avec sélection du motif (identifiants invalides, compte bloqué, profil saturé) et prise en charge instantanée avec bandeau d'état.
  * Tableau de bord synthétique (abonnements actifs, statut de garantie, date d'échéance la plus proche).
  * Vue détaillée de chaque commande avec statut, durée exacte et date de fin.
  * Cartes d'accès avec identifiants (Login, mot de passe avec bascule afficher/masquer, nom du profil assigné, liens Xtream Codes / M3U) et copie en un clic.
  * Module de **rattachement de commande** permettant de lier d'anciens achats via leur code de suivi (`NP-TRK-...`) ou lien d'accès.
  * Gestion autonome du profil (coordonnées) et mise à jour sécurisée du mot de passe.
  * Association automatique de toute nouvelle commande passée avec l'email du client connecté.
* **Gestion des Clients & Sécurité Avancée dans l'Admin** :
  * **Assignation automatique des commandes en 1 clic** : Lorsqu'un client a validé son compte par email, l'administrateur dispose dans la fiche client d'un bouton `⚡ Assigner les commandes au compte` qui rattache instantanément toutes ses commandes historiques ou passées sans email (`customer_account_id`). Le client retrouve ainsi immédiatement l'intégralité de ses abonnements et identifiants sur son espace `/compte` sans aucune saisie manuelle de code de suivi.
  * **Lien d'accès "Vue Client" unique** : Génération d'un token magique temporaire permettant à l'administrateur d'ouvrir et consulter l'espace abonné exactement sous les yeux du client (« vue client et non vue admin ») sans avoir besoin de son mot de passe.
  * **Réinitialisation de mot de passe administrateur** : Définition d'un mot de passe personnalisé ou génération automatique d'un mot de passe temporaire avec expédition immédiate par email.
  * **Remplacement SAV automatisé avec notification email** : Lorsqu'un compte défectueux est remplacé dans l'admin, les nouveaux accès sont instantanément mis à jour sur le compte du client et transmis par email aux couleurs de NeonPass.

### 10. Communication Marketing, Campagnes Email & Assistant WhatsApp
* **Onglet Communication centralisé dans l'Admin** :
  * **Campagnes Email & Publicités Marketing** :
    * Vrai éditeur visuel (WYSIWYG) et mode code HTML brut `</>`.
    * Outils de mise en forme complets (titres H1-H3, gras, souligné, alignements, listes, liens, séparateurs).
    * Insertion de **boutons d'action (CTA)** optimisés conversion et images/bannières.
    * Balises dynamiques personnalisées : `{PRENOM}`, `{NOM}`, `{EMAIL}`, `{TRACKING_CODE}`, `{LIEN_COMPTE}`, `{SITE_URL}`.
    * 4 modèles prédéfinis prêts à l'envoi : *Promo Flash (-30%)*, *Lancement Espace Client*, *Soirée Événement Sportif*, *Relance Expiration*.
    * Prévisualisation en direct avec bascule Desktop / Mobile (375px).
    * Envoi immédiat d'un **email de test** pour vérifier le rendu en boîte de réception.
    * Envoi groupé par segmentation (Tous les clients, Abonnés actifs, Comptes Web, Expirations &le; 7j) avec dispatch sécurisé par lots SMTP.
  * **Journal des Emails (Logs d'envoi)** :
    * Traçabilité intégrale de chaque email expédié (test, OTP d'activation, alerte de sécurité, remplacement SAV, campagne).
    * Affichage horodaté avec destinataire, statut (délivré / échec), Message-ID et réponse exacte du serveur SMTP (`250 2.0.0 OK`).
  * **Assistant WhatsApp pour Clients Existants** :
    * Moteur de recherche et sélection rapide de clients enregistrés.
    * Génération instantanée d'un message WhatsApp personnalisé avec le prénom du client, sa commande et son code de suivi `NP-TRK-...`.
    * Intégration d'un **lien direct d'activation** (`/compte?action=register&email=...&trk=...`) qui pré-remplit les coordonnées et rattache automatiquement toutes ses commandes à la validation du compte.
    * Boutons en 1 clic : `📋 Copier le message`, `💬 Ouvrir dans WhatsApp Web / App`, `🔗 Copier le lien direct`.
    * Modèle de diffusion générale (Broadcast / Statuts WhatsApp) prêt à l'emploi.
    * Bouton direct `⚡ Inviter Espace Client (WhatsApp)` intégré dans la fiche client du CRM.
* **Modernisation du Header Public** :
  * Suppression définitive du bouton WhatsApp rose en haut à droite.
  * Remplacement par le bouton **Connexion / Espace Client** avec icône utilisateur, optimisé desktop et mobile.

### 11. Programme de Parrainage & Récompenses (-50% dès 5 commandes validées)
* **Lien de parrainage unique & partage instantané** :
  * Chaque compte client dispose d'un code unique (`NP-REF-XXXX`) et d'un lien personnalisé (`/?ref=NP-REF-XXXX`).
  * Détection automatique lors de l'accès au site : enregistrement en cache/session et toast de bienvenue visuel pour le filleul.
  * Outils de partage intégrés dans l'espace client : copie en un clic et bouton de partage WhatsApp avec message d'invitation pré-rempli.
* **Comptabilisation stricte basée sur les commandes validées** :
  * Une recommandation n'est comptabilisée que lorsque la commande du filleul est **validée/confirmée** par l'administrateur (`status = 'confirmed'`).
  * Les commandes en cours de traitement apparaissent en statut transparent *« ⏳ En attente de validation »*.
  * Protection anti-fraude intégrée : auto-parrainage interdit et contrôles d'unicité.
* **Déblocage automatique du code promo -50%** :
  * Dès le palier de **5 commandes validées** atteint, le système génère automatiquement un code promo unique à usage unique (`PARRAIN50-XXXXXX`) offrant **-50% de réduction immédiate** sur n'importe quel produit du catalogue.
  * Envoi d'un email de félicitations aux couleurs du site avec le code promo et bouton direct vers la boutique.
  * Système multi-paliers : un nouveau bon de -50% est débloqué à chaque nouveau palier de 5 commandes validées (5, 10, 15...).
* **Tableau de bord de Parrainage dans l'Espace Client (`/compte`)** :
  * **Compteurs KPI en direct** : Commandes Validées, Commandes en attente, Bons -50% débloqués.
  * **Jauge de progression animée** : Barre visuelle affichant la progression en pourcentage et le nombre exact de commandes restantes pour le prochain bon.
  * **Carte Bon -50% actif** : Affichage en surbrillance du code promo débloqué, bouton de copie et raccourci boutique.
  * **Tableau d'historique détaillé** : Date, filleul (anonymisé pour le respect de la vie privée), produits achetés, montant total et badge d'état (`✅ Validée (+1)` ou `⏳ En attente validation`).
* **Suivi & Visibilité dans le Panel Admin** :
  * Badge `🤝 NP-REF-...` visible directement sur les lignes du tableau des commandes.
  * Filtre de recherche par code de parrainage dans l'onglet Commandes.
  * Synthèse des performances de parrainage (filleuls, commandes validées, bons accordés) intégrée dans la fiche client du CRM.

### 12. Moteur Multi-langue, Internationalisation (i18n) & RTL
* **3 Langues intégrées nativement** :
  * 🇫🇷 **Français (FR)** : Langue par défaut et vitrine d'origine.
  * 🇬🇧 **English (EN)** : Traduction complète du catalogue, panier, FAQ et footer.
  * 🇮🇱 **עברית (Hébreu - HE)** : Traduction complète et support intégral Right-to-Left (RTL).
* **Détection automatique de la langue système** :
  * Analyse automatique de `navigator.languages` et `navigator.language` dès la première visite de l'utilisateur.
  * Si le navigateur est configuré en Hébreu (`he`, `he-IL`, `iw`), le site bascule instantanément en hébreu avec inversion RTL.
  * Si le navigateur est configuré en Anglais (`en`, `en-US`, `en-GB`...), le site s'affiche en anglais.
  * Si le navigateur est en Français (`fr`, `fr-FR`...), le site reste en français.
* **Sélecteur de langue interactif & mémorisation** :
  * Bouton discret avec drapeau et code ISO (`🇫🇷 FR`, `🇬🇧 EN`, `🇮🇱 עברית`) dans la barre de navigation et dans le menu mobile.
  * Menu déroulant stylisé néon et pilules tactiles rapides dans le tiroir mobile.
  * Mémorisation persistante dans `localStorage` (`np_lang`) et support du paramètre URL prioritaire `?lang=fr|en|he`.
* **Moteur RTL complet pour l'Hébreu** :
  * Bascule dynamique des attributs `dir="rtl"` et de la classe `.is-rtl`.
  * Réalignement automatique des textes, inversion du flux flexbox, positionnement miroir du bouton flottant WhatsApp et retournement des flèches/chevrons de navigation.
* **Messages WhatsApp et paniers multilingues** :
  * Génération des messages pré-remplis de commande WhatsApp traduits selon la langue active du visiteur.
  * Rafraîchissement réactif instantané sans rechargement de page via l'événement personnalisé `languagechange`.

### 13. Journal des Mises à Jour & Changelog
* **Traçabilité complète des évolutions** :
  * Historique horodaté (date et heure exacte) de l'ensemble des releases, fonctionnalités majeures, améliorations techniques et correctifs de sécurité.
  * Structure de données normalisée dans `data/changelog.json`.
* **Intégration directe dans le Dashboard Admin (`/admin`)** :
  * Onglet dédié **`Changelog v2.4.0`** dans la barre de navigation de l'administration.
  * Barre de recherche instantanée (filtrage par version, mot-clé, composant ou description).
  * Filtres par pastilles de catégories : *Toutes*, *✨ Fonctionnalités*, *🚀 Améliorations*, *🛡️ Sécurité*.
  * Timeline visuelle cyberpunk sombre avec puces de version, dates formatées, badges de composants et liste détaillée des changements.
* **Page Standalone & API REST** :
  * Page autonome accessible sur `/changelog` et `/admin/changelog`.
  * Endpoint REST dédié `GET /api/changelog` pour synchronisation ou intégrations externes.

### 14. Assistant IA & Chatbot Client (Google AI Studio)
* **Widget conversationnel Cyberpunk Volt** :
  * Bulle flottante interactive animée en bas à droite et fenêtre de discussion néon (glassmorphism avec avatar, bulles stylisées, rendu markdown fluide, suggestions de questions rapides et persistance de la conversation en session).
* **Intelligence connectée au catalogue en temps réel** :
  * Connaissance instantanée des 16 produits, prix en euros, stock disponible, notes et avis clients certifiés, parcours de commande WhatsApp et politiques SAV.
  * Réponses immédiates adaptées à la langue du visiteur (Français, Anglais ou Hébreu).
* **Panneau de contrôle dans les Réglages Admin** :
  * Activation / Désactivation en 1 clic (`chatbot_enabled`).
  * Clé API Google AI Studio modifiable avec bouton pour afficher/masquer.
  * Sélecteur de modèle Gemini (`gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-2.5-pro`).
  * Visualisation et personnalisation intégrale du System Prompt avec bouton de réinitialisation par défaut.
  * Bouton de test en direct permettant d'éprouver le prompt et la clé API immédiatement depuis l'administration.
* **Sécurité & Proxy Serveur** :
  * Clé API strictement protégée côté serveur, jamais divulguée au navigateur.
  * Endpoint proxy `POST /api/chat` avec rate limiting anti-abus (30 requêtes/minute/IP).

---

## 🏗️ Architecture & Stack Technique

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Web / Mobile                   │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTPS (Port 443)             │ Espace Abonné (/acces/:token)
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Reverse Proxy Traefik v2.6                  │
│          SSL Let's Encrypt automatique + Headers Sécurité   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP (Port 3000)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Conteneur neonpass-app                      │
│   Node.js 22 · Express · pg · nodemailer · postgresql16     │
│   - API publique (/api/offers, /api/orders, /healthz)       │
│   - API Client sécurisée (/api/client/*)                    │
│   - API Admin sécurisée (/api/admin/*)                      │
│   - Moteur OTP Email (SMTP SSL/TLS)                         │
│   - Moteur de Sauvegarde / Restauration (pg_dump / psql)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Conteneur neonpass-db                       │
│   PostgreSQL 16 Alpine (Volume db_data)                     │
│   - Commandes, Clients CRM, Stocks & Comptes, Offres        │
│   - Comptes clients, OTPs, Appareils & Sessions             │
│   - Sessions chiffrées, Journal d'audit, Codes promo        │
└─────────────────────────────────────────────────────────────┘
```

| Composant | Technologie | Rôle |
|---|---|---|
| **Back-end** | Node.js 22 + Express | Serveur HTTP, logique métier, contrôleurs REST |
| **Front-end** | HTML5 / CSS3 / Vanilla JS | Interface ultra-rapide sans framework lourd, zéro dépendance client |
| **Messagerie & OTP** | Nodemailer (SMTP SSL/TLS) | Envoi des codes OTP (création, connexion suspecte, réinitialisation) |
| **Base de données** | PostgreSQL 16 Alpine | Stockage relationnel ACID, index JSONB, typage fort |
| **Outils BDD** | postgresql16-client | `pg_dump` et `psql` intégrés dans l'image pour backups natifs |
| **Conteneurs** | Docker Compose v2 | Orchestration multi-conteneurs, réseau isolé |
| **Reverse Proxy** | Traefik | Routage HTTPS automatique, certificats SSL Let's Encrypt |
| **Notifications** | Telegram Bot & Discord Webhook | Alertes temps réel (ventes, SAV, stocks, sécurité) |

---

## ⚙️ Installation & Déploiement

### Prérequis
* Un serveur Linux (Ubuntu 22.04+ / Debian 12 recommandé).
* **Docker** et **Docker Compose** installés (`docker compose version`).
* **Traefik** configuré avec un réseau partagé (par défaut `traefik`) et résolveur Let's Encrypt (`letsencrypt`).
* Un nom de domaine pointant vers votre serveur (ex. `neonpass.domaine.com`).

### Déploiement en 4 étapes

```bash
# 1. Cloner le dépôt
git clone git@github.com:NathanSr08/neopass.git
cd neopass

# 2. Configurer les variables d'environnement
cp .env.exemple .env
nano .env

# 3. Créer le réseau Traefik si nécessaire
docker network create traefik

# 4. Construire et démarrer les conteneurs
docker compose up -d --build
```

Vérifier la bonne exécution :
```bash
docker compose ps
# neonpass-app (healthy)
# neonpass-db  (healthy)

docker compose logs -f app
# [db] schéma prêt
# [http] NeonPass écoute sur le port 3000
```

Votre boutique est accessible sur `https://<VOTRE_DOMAINE>` et l'administration sur `https://<VOTRE_DOMAINE>/admin`.

---

## 🔐 Variables d'Environnement (`.env`)

| Variable | Requis | Exemple / Défaut | Description |
|---|:---:|---|---|
| `DOMAIN` | **Oui** | `neonpass.uned.live` | Nom de domaine pointé vers Traefik |
| `WA_NUMBER` | **Oui** | `33612345678` | Numéro WhatsApp recevant les commandes (format international, chiffres uniquement) |
| `DB_PASSWORD` | **Oui** | `openssl rand -base64 32` | Mot de passe robuste de la base PostgreSQL |
| `ADMIN_USER` | Non | `admin` | Identifiant de connexion au panneau d'administration |
| `ADMIN_PASSWORD` | **Oui** | `SuperMotDePasse123!` | Mot de passe administrateur (8 caractères min, 14+ recommandé) |
| `TRAEFIK_NETWORK` | Non | `traefik` | Nom du réseau Docker externe partagé avec Traefik |
| `TRAEFIK_ENTRYPOINT` | Non | `websecure` | Point d'entrée HTTPS de Traefik |
| `TRAEFIK_CERTRESOLVER` | Non | `letsencrypt` | Résolveur de certificat SSL de Traefik |
| `TELEGRAM_BOT_TOKEN` | Non | `123456:ABC-DEF1234ghIkl` | Token du bot Telegram pour alertes |
| `TELEGRAM_CHAT_ID` | Non | `987654321` | Chat ID Telegram recevant les notifications |
| `DISCORD_WEBHOOK_URL` | Non | `https://discord.com/api/webhooks/...` | URL Webhook Discord pour alertes |
| `SMTP_HOST` | Non | `smtp.gmail.com` | Hôte SMTP pour l'envoi des codes OTP email (Google Gmail) |
| `SMTP_PORT` | Non | `465` | Port SMTP (465 pour SSL ou 587 pour STARTTLS) |
| `SMTP_SECURE` | Non | `true` | Connexion SSL/TLS directe (`true` pour port 465) |
| `SMTP_USER` | Non | `neonpass.officiel@gmail.com` | Identifiant / Adresse email de connexion SMTP |
| `SMTP_PASS` | Non | `mrsbklwwfjmmiuvq` | Mot de passe d'application Google (App Password) |
| `SMTP_FROM` | Non | `"NeonPass <neonpass.officiel@gmail.com>"` | Nom d'affichage et adresse expéditeur des emails |

---

## 💾 Guide Sauvegarde & Restauration

### Option 1 : Directement depuis le Panel Admin (Recommandé)
1. Rendez-vous dans l'onglet **Paramètres** de l'administration.
2. Dans la section **💾 Sauvegarde & Restauration de la Base de Données** :
   * Cliquez sur **`💾 Sauvegarder (SQL)`** pour télécharger immédiatement un dump complet `.sql`.
   * Cliquez sur **`📄 Sauvegarder (JSON)`** pour obtenir un snapshot `.json`.
3. Pour restaurer :
   * Cliquez sur **`📁 Parcourir un fichier...`** et sélectionnez votre sauvegarde (`.sql` ou `.json`).
   * Cliquez sur **`⚠️ Lancer la restauration`** et confirmez.
   * La base est remplacée, les index et séquences sont synchronisés, et une copie préventive est créée sur le serveur.

### Option 2 : En Ligne de Commande (CLI)

#### Exporter un dump SQL :
```bash
./scripts/export-db.sh
# Génère un fichier dans backups/neonpass-AAAAMMJJ-HHMMSS.sql.gz
```

Ou directement avec Docker :
```bash
docker exec neonpass-app pg_dump "$DATABASE_URL" --clean --if-exists > backup_$(date +%F).sql
```

#### Restaurer un dump SQL :
```bash
./scripts/import-db.sh backups/mon-fichier.sql.gz
```

Ou directement avec Docker :
```bash
cat backup.sql | docker exec -i neonpass-app psql "$DATABASE_URL"
```

---

## 🛡️ Sécurité & Conformité

* **Protection des Mots de Passe & Authentification Client** :
  * Dérivation de clé cryptographique `scrypt` native avec sel aléatoire unique par compte (protection mémoire-dure contre attaques matérielles/GPU).
  * Codes OTP 6 chiffres hachés en SHA-256 en base, expirant au bout de 10 minutes, verrouillés à 5 tentatives maximum.
  * Détection automatique de nouvel appareil (`device_hash`) ou nouvelle IP avec challenge OTP obligatoire.
* **Authentification Forte Admin (2FA TOTP)** :
  * Compatible Google Authenticator, Authy, 1Password, Bitwarden.
  * Génération de **codes de secours uniques** imprimables.
* **Sécurité des Sessions** :
  * Cookies chiffrés `HttpOnly`, `Secure`, `SameSite=Lax/Strict` (`np_admin_session`, `np_client_session`).
  * Déconnexion automatique des administrateurs après 12 heures d'inactivité.
  * Protection CSRF via en-tête dédié obligatoire (`X-NP-Admin: 1`).
* **Protection Brute-Force & Rate Limiting** :
  * Blocage automatique temporaire après 5 tentatives échouées depuis la même IP.
  * Cooldown de 60 secondes sur les renvois de codes OTP.
  * Notification instantanée sur Telegram / Discord en cas d'intrusion.
* **Liste Blanche d'IP** :
  * Restriction optionnelle de l'accès à l'administration aux seules adresses IP autorisées.
* **Journal d'Audit Intègre (`admin_audit`)** :
  * Historisation de chaque action : connexions, modifications de stock, exports, commandes, restaurations BDD.

---

## 📡 API & Endpoints

### API Publique
| Méthode | Route | Description |
|---|---|---|
| `GET` | `/healthz` | Sonde de santé applicative et connectivité base |
| `GET` | `/api/config` | Paramètres publics (numéro WhatsApp, configuration pack) |
| `GET` | `/api/offers` | Liste des offres actives et notes certifiées |
| `POST` | `/api/offers/:id/reviews` | Dépôt d'un avis client certifié |
| `POST` | `/api/orders` | Création d'une commande et génération lien WhatsApp |
| `POST` | `/api/orders/lookup` | Retrouver ses accès via numéro de commande ou suivi |
| `POST` | `/api/promo/check` | Vérification de la validité d'un code promo |
| `GET` | `/api/acces/:token` | Données de l'espace client sécurisé 24/7 |

### API Espace Client (`/api/client/*`)
| Méthode | Route | Description |
|---|---|---|
| `POST` | `/register` | Inscription client, hachage mot de passe & envoi premier OTP email |
| `POST` | `/login` | Connexion mot de passe ; déclenche l'OTP si appareil ou IP non reconnu |
| `POST` | `/verify-otp` | Validation du code OTP à 6 chiffres, enregistrement de l'appareil & session |
| `POST` | `/resend-otp` | Renvoi d'un nouveau code OTP avec cooldown anti-abus (60s) |
| `GET` | `/me` | Données de session : profil, abonnements actifs, commandes, total dépensé et dashboard parrainage |
| `POST` | `/request-sav` | Déclaration autonome d'un problème sur un abonnement (SAV) avec motif |
| `POST` | `/link-order` | Rattachement manuel d'une commande via code de suivi (`NP-TRK-...`) |
| `POST` | `/update-profile` | Modification du nom, prénom, téléphone ou mise à jour du mot de passe |
| `POST` | `/forgot-password` | Demande de code OTP pour réinitialisation de mot de passe oublié |
| `POST` | `/reset-password` | Validation du code OTP et définition d'un nouveau mot de passe |
| `POST` | `/logout` | Révocation de la session active et suppression du cookie sécurisé |

### API Administration (`/api/admin/*`)
| Méthode | Route | Description |
|---|---|---|
| `POST` | `/login` | Connexion session admin (+ challenge 2FA) |
| `GET` | `/orders` | Liste des commandes avec filtres et pagination |
| `GET` | `/orders/:id/matching-accounts` | Recherche des stocks disponibles recommandés et généraux pour une commande |
| `POST` | `/orders/:id/set-expiry` | Mise à jour rapide de l'échéance (durée en mois ou date) |
| `GET` | `/accounts` | Inventaire complet du stock & comptes |
| `GET` | `/accounts/:id/candidate-orders` | Recherche et tri des commandes candidates pour un compte de stock précis |
| `POST` | `/orders/:id/assign-account` | Attribution d'un compte (automatique par `offerId` ou spécifique par `accountId`) |
| `POST` | `/orders/:id/activate-sav/:accId` | Déclaration d'un accès en panne SAV |
| `POST` | `/orders/:id/replace-account/:accId`| Remplacement d'un compte défectueux |
| `GET` | `/clients` | Liste et statistiques unifiées des clients CRM |
| `DELETE` | `/clients/:idOrKey` | Suppression définitive d'un client (CRM, compte web, sessions, OTP, commandes) |
| `POST` | `/clients/assign-orders` | **Assignation automatique en 1 clic** des commandes historiques au compte web du client |
| `POST` | `/clients/magic-token` | Génération d'un lien sécurisé temporaire pour accès "Vue Client" |
| `POST` | `/clients/reset-password` | Réinitialisation admin du mot de passe client avec notification email |
| `GET` | `/backup/status` | Métriques de volume (12 tables applicatives) et taille de la base |
| `GET` | `/backup/sql` | Téléchargement du dump SQL complet |
| `GET` | `/backup/json` | Téléchargement du snapshot JSON v2 complet (12 tables) |
| `POST` | `/backup/restore` | Restauration d'une sauvegarde SQL ou JSON |
| `POST` | `/audit/purge` | Purge sélective du journal d'audit par période |
| `GET` | `/sales` | Données financières, marge nette et KPI de vente |
| `GET` | `/communication/audiences` | Volumétrie et segmentation des contacts email |
| `GET` | `/communication/whatsapp-clients` | Annuaire des clients avec codes de suivi pour invitation WhatsApp |
| `GET` | `/communication/logs` | Journal d'audit détaillé des envois SMTP (`email_logs`) |
| `POST` | `/communication/test-email` | Envoi d'un email de test avec variables de démo |
| `POST` | `/communication/send-campaign` | Diffusion sécurisée d'une campagne par lots SMTP |

---

## 🧪 Suite de Tests & Validation Automatisée

Le projet intègre une suite de tests automatisée reproductible exécutable via npm ou node :

```bash
# Lancement de la suite de tests complète
npm test

# Ou directement avec Node.js
node tests/suite.js
```

### Scénarios couverts par la suite de tests :
1. **Catalogue Public & Offres (`GET /api/offers`)** : Validation du statut 200, structure des données, prix et durées d'offres.
2. **Moteur de Réduction (`POST /api/promo/check`)** : Rejet des faux codes (404), validation des codes actifs et calcul des remises.
3. **Comptes Clients & Sessions (`/api/client/*`)** : Création d'un compte vérifié, génération du code de parrainage unique (`NP-REF-XXXX`) et validation de session.
4. **Tunnel de Commande & Parrainage (`POST /api/orders`)** : Passage de commande avec détection du parrain et liaison en base.
5. **Palier Parrainage & Bon -50%** : Test de montée en charge à 5 commandes confirmées et vérification du déblocage automatique du bon unique `PARRAIN50-XXXX` à -50%.
6. **Assignation Automatique CRM (`POST /api/admin/clients/assign-orders`)** : Détection des commandes non rattachées et attribution en 1 clic vers le compte client vérifié.
7. **Sauvegarde & Restauration (`/api/admin/backup/*`)** : Vérification des compteurs réels et de l'export JSON v2 complet englobant l'intégralité des tables.
8. **Internationalisation i18n (`/i18n.js` & `/`)** : Vérification du moteur i18n, support des 3 langues (FR, EN, HE), configuration RTL de l'hébreu, détection automatique de la langue système et balises `data-i18n` sur la boutique.
9. **Rendu Catalogue Client (`app.js` & `grid`)** : Exécution réelle des scripts clients, validation de syntaxe stricte, affichage effectif de la totalité des cartes produits et bascule multilingue réactive (FR / EN / HE).
10. **Stock & Attribution (Automatique vs Spécifique)** : Validation des endpoints `matching-accounts` et `candidate-orders`, test de l'attribution manuelle d'un compte précis (`accountId`), vérification de la délivrance instantanée sur la fiche d'accès client (`/api/acces/:token`), désassignation et attribution automatique par offre (`offerId`).

---

## 🛠️ Maintenance & Dépannage

### Commandes usuelles

```bash
# Consulter les logs de l'application en direct
docker compose logs -f app

# Consulter les logs de la base de données
docker compose logs -f db

# Redémarrer l'application proprement
docker compose restart app

# Reconstruire l'image après modification
docker compose up -d --build app
```

### Problèmes fréquents

| Problème | Cause fréquente | Solution |
|---|---|---|
| **Conteneur `app` redémarre en boucle** | Variable obligatoire manquante dans `.env` | Vérifier `docker compose logs app` et renseigner `WA_NUMBER`, `ADMIN_PASSWORD`, etc. |
| **Erreur de connexion Traefik** | Réseau non créé ou mal nommé | Exécuter `docker network create traefik` et vérifier `TRAEFIK_NETWORK`. |
| **Site inaccessible en HTTPS** | DNS non propagé ou certificat Let's Encrypt | Vérifier que le domaine pointe vers l'IP du serveur (`dig +short DOMAINE`). |
| **2FA perdu (téléphone indisponible)** | Codes de secours épuisés | Réinitialiser en base : `docker exec neonpass-db psql -U neonpass -d neonpass -c "DELETE FROM settings WHERE key LIKE 'admin_totp%';"`. |

---

<div align="center">

**NeonPass** — Développé avec excellence pour une gestion e-commerce sans compromis.

</div>
