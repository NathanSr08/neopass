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
- [Architecture & Stack Technique](#-architecture--stack-technique)
- [Installation & Déploiement](#-installation--déploiement)
- [Variables d'Environnement](#-variables-denvironnement-env)
- [Guide Sauvegarde & Restauration](#-guide-sauvegarde--restauration)
- [Sécurité & Conformité](#-sécurité--conformité)
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
* **Fiche Commande ergonomique** :
  * **Mode Consultation d'abord** : Synthèse complète du client, durée, échéance, badge des jours restants, produits achetés, comptes attribués et notes privées.
  * **Croix de fermeture rapide `✕`** en haut à droite.
  * **Mode Édition à la demande** avec bouton `✏️ Modifier la commande` et retour direct.
* **Gestion flexible des durées d'abonnement** :
  * Prise en charge des formules **1 mois**, **3 mois**, **6 mois**, **1 an (12 mois)** ou date personnalisée.
  * **Boutons rapides d'ajustement** dans la fiche : recalcul immédiat de l'échéance en 1 clic.
* **CRM Clients complet** :
  * Liste de tous les clients avec statistiques agrégées (commandes passées, CA généré, abonnements actifs, accès détenus).
  * Fiche client 360° avec accès direct WhatsApp, historique des commandes et liste de tous les identifiants attribués (groupés par pack ou individuels).

### 3. Coffre-fort de Comptes & Gestion de Stock
* **Découplage intelligent Packs vs Stock unitaire** :
  * Les packs commerciaux (ex. *Pack XpressVPN + Disney+*) sont vendus au client sous une seule offre, mais piochés individuellement dans leurs stocks unitaires respectifs.
  * Fini les identifiants combinés artificiels : le stock reste modulaire et réutilisable.
* **Auto-attribution en un clic** : Analyse les produits commandés et attribue automatiquement les accès disponibles en réserve.
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
  * Bouton direct de contact WhatsApp en cas de besoin.

### 6. Sauvegarde & Restauration de la Base de Données
* **Export direct depuis l'Admin** :
  * `💾 Sauvegarder (SQL)` : Génération à la volée d'un dump PostgreSQL complet (`pg_dump --clean --if-exists`) horodaté.
  * `📄 Sauvegarder (JSON)` : Snapshot structuré et lisible de toutes les tables applicatives.
* **Restauration sécurisée** :
  * Téléversement simple d'un fichier `.sql` ou `.json`.
  * **Sauvegarde préventive automatique** créée sur le serveur avant toute opération.
  * Réapplication systématique des migrations idempotentes pour garantir la parfaite synchronisation des colonnes et index.
  * Notification automatique sur Telegram / Discord lors de chaque restauration.

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
│   Node.js 22 · Express · pg · postgresql16-client           │
│   - API publique (/api/offers, /api/orders, /healthz)       │
│   - API Admin sécurisée (/api/admin/*)                      │
│   - Moteur de Sauvegarde / Restauration (pg_dump / psql)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Conteneur neonpass-db                       │
│   PostgreSQL 16 Alpine (Volume db_data)                     │
│   - Commandes, Clients CRM, Stocks & Comptes, Offres        │
│   - Sessions chiffrées, Journal d'audit, Codes promo        │
└─────────────────────────────────────────────────────────────┘
```

| Composant | Technologie | Rôle |
|---|---|---|
| **Back-end** | Node.js 22 + Express | Serveur HTTP, logique métier, contrôleurs REST |
| **Front-end** | HTML5 / CSS3 / Vanilla JS | Interface ultra-rapide sans framework lourd, zéro dépendance client |
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

* **Authentification Forte (2FA TOTP)** :
  * Compatible Google Authenticator, Authy, 1Password, Bitwarden.
  * Génération de **codes de secours uniques** imprimables.
* **Sécurité des Sessions** :
  * Cookie admin chiffré `HttpOnly`, `Secure`, `SameSite=Strict`.
  * Déconnexion automatique après 12 heures d'inactivité.
  * Protection CSRF via en-tête dédié obligatoire (`X-NP-Admin: 1`).
* **Protection Brute-Force & Rate Limiting** :
  * Blocage automatique temporaire après 5 tentatives échouées depuis la même IP.
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
| `POST` | `/api/orders` | Création d'une commande et génération lien WhatsApp |
| `POST` | `/api/promo/check` | Vérification de la validité d'un code promo |
| `GET` | `/api/acces/:token` | Données de l'espace client sécurisé 24/7 |

### API Administration (`/api/admin/*`)
| Méthode | Route | Description |
|---|---|---|
| `POST` | `/login` | Connexion session admin (+ challenge 2FA) |
| `GET` | `/orders` | Liste des commandes avec filtres et pagination |
| `POST` | `/orders/:id/set-expiry` | Mise à jour rapide de l'échéance (durée en mois ou date) |
| `GET` | `/accounts` | Inventaire complet du stock & comptes |
| `POST` | `/orders/:id/assign-account` | Attribution d'un compte disponible à une commande |
| `POST` | `/orders/:id/activate-sav/:accId` | Déclaration d'un accès en panne SAV |
| `POST` | `/orders/:id/replace-account/:accId`| Remplacement d'un compte défectueux |
| `GET` | `/clients` | Liste et statistiques des clients CRM |
| `GET` | `/backup/status` | Métriques de volume et taille de la base |
| `GET` | `/backup/sql` | Téléchargement du dump SQL complet |
| `GET` | `/backup/json` | Téléchargement du snapshot JSON complet |
| `POST` | `/backup/restore` | Restauration d'une sauvegarde SQL ou JSON |
| `GET` | `/sales` | Données financières, marge nette et KPI de vente |

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
