#!/usr/bin/env bash
# Sauvegarde automatique de la base NeonPass :
#   1. export de la base (scripts/export-db.sh)
#   2. chiffrement GPG AES-256 avec le mot de passe du fichier PASSPHRASE_FILE
#   3. envoi du fichier chiffré sur la branche Git « backups » (jamais de fichier en clair)
#   4. suppression des fichiers locaux de plus de KEEP_DAYS jours
#   5. notification Telegram/Discord du résultat (succès ou échec)
#
# Usage : ./scripts/backup-auto.sh            (prévu pour cron, voir le README)
#
# Variables facultatives :
#   BACKUP_DIR       dossier local des sauvegardes    (défaut : <projet>/backups)
#   PASSPHRASE_FILE  fichier du mot de passe GPG      (défaut : $BACKUP_DIR/.backup-passphrase)
#   KEEP_DAYS        jours de rétention en local      (défaut : 30)
#   BACKUP_BRANCH    branche Git des sauvegardes      (défaut : backups)
#   BACKUP_SSH_KEY   clé SSH pour pousser sur GitHub  (défaut : agent / config SSH habituelle)
#   NO_PUSH=1        ne pas pousser sur Git (sauvegarde locale uniquement)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$BACKUP_DIR/.backup-passphrase}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_BRANCH="${BACKUP_BRANCH:-backups}"
GIT_DIR_LOCAL="$BACKUP_DIR/git-$BACKUP_BRANCH"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="neonpass-$STAMP.sql.gz"
umask 077

if [[ -n "${BACKUP_SSH_KEY:-}" ]]; then
  export GIT_SSH_COMMAND="ssh -i $BACKUP_SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes"
fi

# --- Notifications (lit .env sans l'exécuter) ---
env_value() {
  [[ -f "$ROOT/.env" ]] || return 0
  grep -E "^$1=" "$ROOT/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
notify() {
  local text="$1" tg_token tg_chat discord
  tg_token="$(env_value TELEGRAM_BOT_TOKEN)"
  tg_chat="$(env_value TELEGRAM_CHAT_ID)"
  discord="$(env_value DISCORD_WEBHOOK_URL)"
  if [[ -n "$tg_token" && -n "$tg_chat" ]]; then
    curl -fsS -m 10 -o /dev/null "https://api.telegram.org/bot$tg_token/sendMessage" \
      --data-urlencode "chat_id=$tg_chat" --data-urlencode "text=$text" || echo "[backup] notification Telegram échouée" >&2
  fi
  if [[ "$discord" =~ ^https://(discord|discordapp)\.com/api/webhooks/ ]]; then
    local payload
    payload="$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps({"content": sys.stdin.read(), "allowed_mentions": {"parse": []}}))')"
    curl -fsS -m 10 -o /dev/null -H 'Content-Type: application/json' -d "$payload" "$discord" \
      || echo "[backup] notification Discord échouée" >&2
  fi
}

STEP="démarrage"
on_error() {
  local code=$?
  echo "[backup] ÉCHEC à l'étape : $STEP (code $code)" >&2
  notify "❌ Sauvegarde NeonPass ÉCHOUÉE ($(hostname), $STAMP) — étape : $STEP"
  exit "$code"
}
trap on_error ERR

# Une seule sauvegarde à la fois
mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "[backup] une sauvegarde est déjà en cours" >&2; exit 0; }

STEP="vérification du mot de passe"
[[ -s "$PASSPHRASE_FILE" ]] || { echo "[backup] fichier de mot de passe introuvable : $PASSPHRASE_FILE" >&2; false; }

STEP="export de la base"
"$ROOT/scripts/export-db.sh" "$BACKUP_DIR/$NAME" >/dev/null

STEP="chiffrement"
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME
trap 'rm -rf "$GNUPGHOME"' EXIT
gpg -q --batch --yes --no-tty --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
  --symmetric --cipher-algo AES256 -o "$BACKUP_DIR/$NAME.gpg" "$BACKUP_DIR/$NAME" 2>/dev/null || true
# Vérifie que le fichier chiffré se déchiffre bien en un fichier identique
gpg -q --batch --yes --no-tty --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
  -o "$GNUPGHOME/check.sql.gz" -d "$BACKUP_DIR/$NAME.gpg" 2>/dev/null || true
cmp -s "$GNUPGHOME/check.sql.gz" "$BACKUP_DIR/$NAME"
SIZE="$(du -h "$BACKUP_DIR/$NAME.gpg" | cut -f1)"

PUSHED="non (NO_PUSH)"
if [[ "${NO_PUSH:-0}" != "1" ]]; then
  STEP="préparation du dépôt Git"
  REMOTE="$(git -C "$ROOT" remote get-url origin)"
  if [[ ! -d "$GIT_DIR_LOCAL/.git" ]]; then
    git clone -q --single-branch --branch "$BACKUP_BRANCH" "$REMOTE" "$GIT_DIR_LOCAL"
  fi
  git -C "$GIT_DIR_LOCAL" fetch -q origin "$BACKUP_BRANCH"
  git -C "$GIT_DIR_LOCAL" reset -q --hard "origin/$BACKUP_BRANCH"

  STEP="envoi sur Git"
  mkdir -p "$GIT_DIR_LOCAL/db-backups"
  cp "$BACKUP_DIR/$NAME.gpg" "$GIT_DIR_LOCAL/db-backups/"
  git -C "$GIT_DIR_LOCAL" add "db-backups/$NAME.gpg"
  git -C "$GIT_DIR_LOCAL" -c user.name="NeonPass backup" -c user.email="backup@localhost" \
    commit -q -m "Sauvegarde automatique $STAMP"
  git -C "$GIT_DIR_LOCAL" push -q origin "HEAD:$BACKUP_BRANCH"
  PUSHED="oui (branche $BACKUP_BRANCH)"
fi

STEP="nettoyage"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'neonpass-*.sql.gz' -o -name 'neonpass-*.sql.gz.gpg' \) \
  -mtime +"$KEEP_DAYS" -delete

echo "[backup] OK $NAME.gpg ($SIZE) — envoyé sur Git : $PUSHED"
notify "✅ Sauvegarde NeonPass OK ($STAMP, $SIZE) — Git : $PUSHED"
