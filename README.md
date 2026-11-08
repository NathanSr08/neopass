# NeonPass

Boutique en ligne d'abonnements annuels avec commande via WhatsApp et panneau d'administration.

- **Back-end** : Node.js 22 + Express, sans framework front (HTML/CSS/JS servis en statique)
- **Base de données** : PostgreSQL 16
- **Déploiement** : Docker Compose derrière un reverse-proxy [Traefik](https://traefik.io) (HTTPS automatique)

## Fonctionnalités

**Boutique (`/`)**
- Catalogue filtrable par catégorie, avec étoiles et avis clients
- Composeur « sur mesure » : services et packs combinables, remise automatique à partir de N services
- Codes promo (champ dans le composeur ou lien `/?promo=CODE`)
- Commande enregistrée en base puis ouverture de WhatsApp avec un message pré-rempli (référence, offres, total)

**Administration (`/admin`, protégée par identifiant / mot de passe)**
- Commandes : liste, filtres, statut, saisie manuelle (client, téléphone, produits, paiement, commentaire interne)
- Offres : création, modification, masquage, ordre d'affichage
- Avis : modération (publication après validation)
- Codes promo : remise, date d'expiration, nombre d'utilisations max
- Réglages : remise du pack sur mesure, état des notifications + message de test
- Notifications Telegram et/ou Discord à chaque commande et avis en attente

## Prérequis

- Un serveur Linux avec **Docker** et le plugin **Docker Compose** (`docker compose version`)
- **Traefik** déjà en place, avec :
  - un réseau Docker externe partagé (par défaut `traefik`)
  - un point d'entrée HTTPS (par défaut `websecure`) et un résolveur de certificats (par défaut `letsencrypt`)
- Un nom de domaine qui pointe vers le serveur

> Pas de Traefik ? Voir [Lancer sans Traefik](#lancer-sans-traefik-test-local).

## Installation

```bash
# 1. Récupérer le projet
git clone git@github.com:NathanSr08/neopass.git
cd neopass

# 2. Créer la configuration
cp .env.exemple .env
nano .env            # voir le tableau ci-dessous

# 3. (si besoin) créer le réseau partagé avec Traefik
docker network create traefik

# 4. Construire et démarrer
docker compose up -d --build

# 5. Vérifier
docker compose ps                 # les deux conteneurs doivent être « healthy »
docker compose logs -f app        # « [db] schéma prêt » puis « NeonPass écoute sur le port 3000 »
```

Le site est alors disponible sur `https://<DOMAIN>` et l'administration sur `https://<DOMAIN>/admin`.

Le schéma de la base (`db/init.sql`) est appliqué **automatiquement à chaque démarrage**. Il est idempotent : il crée les tables manquantes et ajoute les nouvelles colonnes sans toucher aux données existantes. Un catalogue d'exemple est inséré uniquement si la table des offres est vide.

## Configuration (`.env`)

| Variable | Obligatoire | Description |
|---|---|---|
| `DOMAIN` | oui | Nom de domaine servi par Traefik (ex. `boutique.exemple.fr`) |
| `WA_NUMBER` | oui | Numéro WhatsApp qui reçoit les commandes, format international, chiffres uniquement (ex. `33612345678`) |
| `DB_PASSWORD` | oui | Mot de passe PostgreSQL : long et aléatoire (`openssl rand -base64 32`) |
| `ADMIN_USER` | non | Identifiant de l'admin (défaut `admin`) |
| `ADMIN_PASSWORD` | oui | Mot de passe de l'admin, 8 caractères minimum. **Change la valeur d'exemple.** |
| `TRAEFIK_NETWORK` | non | Réseau Docker partagé avec Traefik (défaut `traefik`) |
| `TRAEFIK_ENTRYPOINT` | non | Point d'entrée HTTPS de Traefik (défaut `websecure`) |
| `TRAEFIK_CERTRESOLVER` | non | Résolveur de certificats de Traefik (défaut `letsencrypt`) |
| `TELEGRAM_BOT_TOKEN` | non | Token du bot Telegram pour les notifications |
| `TELEGRAM_CHAT_ID` | non | Identifiant de la conversation qui reçoit les notifications |
| `DISCORD_WEBHOOK_URL` | non | URL d'un webhook Discord pour les notifications |

Le fichier `.env` contient des secrets : il est exclu de Git (`.gitignore`), ne le commite jamais.

### Notifications

**Telegram**
1. Dans Telegram, écris à [@BotFather](https://t.me/BotFather), envoie `/newbot` et récupère le token → `TELEGRAM_BOT_TOKEN`
2. Envoie un message quelconque à ton nouveau bot
3. Récupère ton identifiant (par exemple via [@userinfobot](https://t.me/userinfobot)) → `TELEGRAM_CHAT_ID`

**Discord** : Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL → `DISCORD_WEBHOOK_URL`

Puis `docker compose up -d app` et, dans l'admin, **Réglages → Envoyer un message de test**.

## Mise à jour / redéploiement

```bash
git pull
docker compose up -d --build app
```

La base n'est pas touchée (volume Docker `db_data`), les nouvelles tables/colonnes sont ajoutées au démarrage.

> **Piège à connaître** : Docker Compose donne la priorité aux variables d'environnement du shell sur celles du `.env`.
> Si ton shell définit déjà `TELEGRAM_BOT_TOKEN` (pour un autre projet par exemple), c'est cette valeur qui sera utilisée.
> Vérifie avec `env | grep -E 'TELEGRAM|DISCORD'`, ou lance :
> ```bash
> env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u DISCORD_WEBHOOK_URL docker compose up -d --build app
> ```

## Sauvegarde et restauration de la base

Deux scripts sont fournis dans `scripts/`. Ils s'utilisent depuis la racine du projet, conteneurs démarrés.

### Exporter

```bash
./scripts/export-db.sh
# → backups/neonpass-AAAAMMJJ-HHMMSS.sql.gz

./scripts/export-db.sh /chemin/mon-export.sql.gz   # emplacement au choix
```

Le fichier contient toute la base (offres, commandes, avis, codes promo, réglages). Il est créé avec les droits `600` car il contient des données clients : stocke-le en lieu sûr. Le dossier `backups/` est exclu de Git.

### Importer

```bash
./scripts/import-db.sh backups/neonpass-20261108-150000.sql.gz
```

⚠️ **Remplace toutes les données actuelles.** Le script demande de taper `oui` (ou `-y` pour passer la confirmation), puis :

1. sauvegarde la base actuelle dans `backups/avant-import-*.sql.gz`
2. arrête le conteneur de l'application
3. importe dans **une seule transaction** : en cas d'erreur, rien n'est modifié
4. redémarre l'application

Accepte les fichiers `.sql.gz` et `.sql`.

### Migrer vers un autre serveur

```bash
# ancien serveur
./scripts/export-db.sh neonpass.sql.gz
scp neonpass.sql.gz nouveau-serveur:~/neopass/

# nouveau serveur (après l'installation ci-dessus)
./scripts/import-db.sh neonpass.sql.gz
```

### Sauvegarde automatique (optionnel)

Exemple avec `cron` : un export chaque nuit à 3 h, suppression des exports de plus de 30 jours.

```cron
0 3 * * * cd /chemin/vers/neopass && ./scripts/export-db.sh >/dev/null && find backups -name 'neonpass-*.sql.gz' -mtime +30 -delete
```

Les noms de conteneurs et de base peuvent être changés via `DB_CONTAINER`, `APP_CONTAINER`, `DB_USER` et `DB_NAME` (voir l'en-tête des scripts).

## Lancer sans Traefik (test local)

Ajoute un fichier `docker-compose.override.yml` (non versionné) pour exposer le port directement :

```yaml
services:
  app:
    ports:
      - "3000:3000"
networks:
  traefik:
    external: false
    name: neonpass-local
```

Puis `docker compose up -d --build` et ouvre <http://localhost:3000>.
Le cookie de session étant marqué `Secure`, les futures fonctionnalités de compte client nécessiteront HTTPS (ou `localhost`).

## Structure du projet

```
.
├── server.js            # API Express + service des pages
├── db/init.sql          # schéma PostgreSQL (appliqué à chaque démarrage)
├── public/              # boutique : index.html (HTML + CSS), app.js
├── admin/index.html     # panneau d'administration (servi derrière l'authentification)
├── scripts/             # export-db.sh / import-db.sh
├── Dockerfile
├── docker-compose.yml   # app + PostgreSQL, labels Traefik
└── .env.exemple         # modèle de configuration
```

## API

| Méthode | Route | Description |
|---|---|---|
| GET | `/healthz` | Santé de l'appli et de la base |
| GET | `/api/config` | Numéro WhatsApp et réglages de remise |
| GET | `/api/offers` | Offres visibles avec note moyenne |
| GET / POST | `/api/offers/:id/reviews` | Avis publiés / déposer un avis (modéré) |
| POST | `/api/promo/check` | Vérifier un code promo |
| POST | `/api/orders` | Enregistrer une commande et obtenir le lien WhatsApp |
| * | `/api/admin/...` | Administration (authentification HTTP Basic) |

## Dépannage

| Symptôme | Piste |
|---|---|
| Le conteneur `app` redémarre en boucle | `docker compose logs app` : une variable obligatoire manque dans `.env` |
| `network traefik declared as external, but could not be found` | `docker network create traefik` ou corriger `TRAEFIK_NETWORK` |
| Le site ne répond pas en HTTPS | Vérifier que le DNS pointe vers le serveur et les noms `TRAEFIK_ENTRYPOINT` / `TRAEFIK_CERTRESOLVER` |
| Le test de notification échoue | Message d'erreur affiché dans l'admin ; vérifier le token / chat_id et le piège des variables du shell ci-dessus |
