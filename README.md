# Sauvegardes chiffrées de la base NeonPass

Fichiers chiffrés avec GPG (AES-256, mot de passe). Illisibles sans le mot de passe,
qui n'est **pas** dans ce dépôt.

## Restaurer

```bash
gpg -d db-backups/neonpass-AAAAMMJJ-HHMMSS.sql.gz.gpg > neonpass.sql.gz   # demande le mot de passe
./scripts/import-db.sh neonpass.sql.gz                                    # depuis la branche main
rm neonpass.sql.gz
```

## Ajouter une sauvegarde

```bash
./scripts/export-db.sh backup.sql.gz
gpg --symmetric --cipher-algo AES256 -o db-backups/neonpass-$(date +%Y%m%d-%H%M%S).sql.gz.gpg backup.sql.gz
rm backup.sql.gz
```

Ne jamais ajouter ici de fichier `.sql` ou `.sql.gz` non chiffré.
