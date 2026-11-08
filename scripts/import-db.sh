#!/usr/bin/env bash
# Importe un export de la base NeonPass (.sql ou .sql.gz) en REMPLAÇANT les données actuelles.
#
# Usage : ./scripts/import-db.sh <fichier.sql.gz|fichier.sql> [-y]
#   -y  ne pas demander de confirmation
#
# Par sécurité, le script :
#   1. sauvegarde la base actuelle dans backups/avant-import-*.sql.gz
#   2. arrête le conteneur de l'application pendant l'import
#   3. importe dans une seule transaction (tout ou rien)
#   4. redémarre l'application
#
# Variables facultatives :
#   DB_CONTAINER   conteneur PostgreSQL     (défaut : neonpass-db)
#   APP_CONTAINER  conteneur de l'appli     (défaut : neonpass-app)
#   DB_USER / DB_NAME                       (défaut : neonpass / neonpass)
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-neonpass-db}"
APP_CONTAINER="${APP_CONTAINER:-neonpass-app}"
DB_USER="${DB_USER:-neonpass}"
DB_NAME="${DB_NAME:-neonpass}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FILE=""
YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) FILE="$arg" ;;
  esac
done

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage : $0 <fichier.sql.gz|fichier.sql> [-y]" >&2
  [[ -n "$FILE" ]] && echo "Erreur : fichier introuvable : $FILE" >&2
  exit 1
fi

case "$FILE" in
  *.gz) READ=(gzip -dc "$FILE"); gzip -t "$FILE" || { echo "Erreur : archive gzip corrompue." >&2; exit 1; } ;;
  *)    READ=(cat "$FILE") ;;
esac

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "Erreur : le conteneur « $DB_CONTAINER » ne tourne pas (docker compose up -d db)." >&2
  exit 1
fi

if [[ $YES -ne 1 ]]; then
  echo "ATTENTION : les données actuelles de « $DB_NAME » vont être remplacées par $FILE"
  read -r -p "Tape « oui » pour continuer : " answer
  [[ "$answer" == "oui" ]] || { echo "Annulé."; exit 1; }
fi

echo "1/4 Sauvegarde de la base actuelle…"
"$ROOT/scripts/export-db.sh" "$ROOT/backups/avant-import-$(date +%Y%m%d-%H%M%S).sql.gz"

APP_WAS_RUNNING=0
if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  APP_WAS_RUNNING=1
  echo "2/4 Arrêt de l'application ($APP_CONTAINER)…"
  docker stop "$APP_CONTAINER" >/dev/null
else
  echo "2/4 Application non démarrée, rien à arrêter."
fi
restart_app() {
  if [[ $APP_WAS_RUNNING -eq 1 ]]; then
    echo "4/4 Redémarrage de l'application…"
    docker start "$APP_CONTAINER" >/dev/null
  fi
}
trap restart_app EXIT

echo "3/4 Import de $FILE…"
"${READ[@]}" | docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null

echo "Import terminé."
