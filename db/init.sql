-- Schéma NeonPass (idempotent : exécuté à chaque démarrage)

CREATE TABLE IF NOT EXISTS offers (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  tag         TEXT NOT NULL DEFAULT '',
  price       NUMERIC(8,2) NOT NULL,
  was_price   NUMERIC(8,2),
  description TEXT NOT NULL DEFAULT '',
  features    JSONB NOT NULL DEFAULT '[]',
  hue         INTEGER NOT NULL DEFAULT 330,
  is_pack     BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  items         JSONB NOT NULL,
  total         NUMERIC(10,2) NOT NULL,
  discount      BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('discount_pct', '10'), ('discount_min', '3')
ON CONFLICT (key) DO NOTHING;

-- Catalogue de départ (marques fictives), inséré uniquement si la table est vide
INSERT INTO offers (slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort)
SELECT * FROM (VALUES
  ('pack-familyplay-shieldnet', 'Pack FamilyPlay + ShieldNet', 'packs', 'Pack', 40, 164,
   'Le streaming famille et le VPN dans un seul abonnement annuel.',
   '["Films et séries famille en HD", "VPN illimité, 5 appareils", "Un seul paiement par an"]'::jsonb, 335, TRUE, TRUE, 0),
  ('streammax', 'StreamMax', 'streaming', 'Streaming', 35, 156,
   'Séries et films originaux, sans publicité.',
   '["Catalogue complet en 4K", "2 écrans en simultané", "Profils illimités"]'::jsonb, 350, FALSE, TRUE, 10),
  ('cinebox', 'CinéBox', 'streaming', 'Streaming', 35, 90,
   'Films récents, séries exclusives et sorties cinéma.',
   '["Nouveautés chaque semaine", "Téléchargement hors ligne", "Sous-titres multilingues"]'::jsonb, 215, FALSE, TRUE, 20),
  ('shieldnet-lite', 'ShieldNet Lite', 'vpn', 'VPN', 15, 80,
   'La connexion chiffrée essentielle, simple et rapide.',
   '["Serveurs dans 60 pays", "3 appareils", "Chiffrement 256 bits"]'::jsonb, 185, FALSE, TRUE, 30),
  ('shieldnet-pro', 'ShieldNet Pro', 'vpn', 'VPN', 30, 110,
   'Plus d''appareils, plus de vitesse, protection renforcée.',
   '["Serveurs dans 100 pays", "10 appareils", "Blocage des traqueurs"]'::jsonb, 165, FALSE, TRUE, 40),
  ('beatbox', 'BeatBox', 'musique', 'Musique', 30, 120,
   'Toute la musique, sans pub, avec écoute hors ligne.',
   '["Qualité audio haute fidélité", "Listes personnalisées", "Écoute hors ligne"]'::jsonb, 275, FALSE, TRUE, 50),
  ('tvplus', 'TVPlus', 'tv', 'TV', 50, 200,
   'Chaînes en direct et replay sur tous tes écrans.',
   '["Chaînes en direct", "Replay 7 jours", "Compatible mobile et TV"]'::jsonb, 40, FALSE, TRUE, 60)
) AS v(slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort)
WHERE NOT EXISTS (SELECT 1 FROM offers);
