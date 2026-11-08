#!/usr/bin/env bash
# Exporte la base PostgreSQL de NeonPass dans un fichier .sql.gz
#
# Usage : ./scripts/export-db.sh [fichier_de_sortie.sql.gz]
#   Sans argument, le fichier est créé dans backups/neonpass-AAAAMMJJ-HHMMSS.sql.gz
#
# Variables facultatives :
#   DB_CONTAINER  nom du conteneur PostgreSQL (défaut : neonpass-db)
#   DB_USER       utilisateur PostgreSQL       (défaut : neonpass)
#   DB_NAME       nom de la base               (défaut : neonpass)
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-neonpass-db}"
DB_USER="${DB_USER:-neonpass}"
DB_NAME="${DB_NAME:-neonpass}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

OUT="${1:-$ROOT/backups/neonpass-$(date +%Y%m%d-%H%M%S).sql.gz}"
mkdir -p "$(dirname "$OUT")"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "Erreur : le conteneur « $DB_CONTAINER » ne tourne pas (docker compose up -d db)." >&2
  exit 1
fi

echo "Export de la base « $DB_NAME » depuis « $DB_CONTAINER »…"
TMP="$OUT.part"
trap 'rm -f "$TMP"' EXIT
# --clean --if-exists : le fichier remplace proprement les tables à l'import
# --no-owner --no-privileges : importable avec un autre utilisateur PostgreSQL
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --no-privileges | gzip -9 > "$TMP"
mv "$TMP" "$OUT"
trap - EXIT
chmod 600 "$OUT"

echo "OK : $OUT ($(du -h "$OUT" | cut -f1))"
