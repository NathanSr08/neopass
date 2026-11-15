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
   '["Chaînes en direct", "Replay 7 jours", "Compatible mobile et TV"]'::jsonb, 40, FALSE, TRUE, 60),
  ('canva-pro', 'Canva Pro', 'logiciels', 'Création', 30, 110,
   'Crée facilement des visuels professionnels avec les outils premium de Canva.',
   '["Modèles et contenus premium", "Suppression d’arrière-plan", "Redimensionnement magique", "Outils de création avec IA"]'::jsonb, 285, FALSE, TRUE, 70),
  ('capcut-pro', 'CapCut Pro', 'logiciels', 'Montage vidéo', 30, 109.99,
   'Réalise des montages vidéo avancés avec les outils premium de CapCut.',
   '["Effets et transitions premium", "Sous-titres automatiques", "Outils IA de montage", "Modèles et ressources premium"]'::jsonb, 195, FALSE, TRUE, 80),
  ('hbo-max', 'HBO Max', 'tv', 'Streaming', 35, 69.90,
   'Retrouve les grandes séries HBO, des films et des documentaires.',
   '["Séries HBO Original", "Films et nouveautés", "Documentaires", "Visionnage à la demande"]'::jsonb, 225, FALSE, TRUE, 90),
  ('paramount-plus-fr', 'Paramount+ France', 'tv', 'Streaming', 35, 79.90,
   'Découvre les films, séries et productions originales de Paramount+.',
   '["Films et séries exclusifs", "Productions Paramount", "Séries originales", "Catalogue de divertissement"]'::jsonb, 210, FALSE, TRUE, 100)
) AS v(slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort)
WHERE NOT EXISTS (SELECT 1 FROM offers);

-- Avis clients (publiés après validation par l'admin)
CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  offer_id    INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT NOT NULL DEFAULT '',
  approved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_offer_idx ON reviews (offer_id, approved, created_at DESC);

-- Codes promo
CREATE TABLE IF NOT EXISTS promo_codes (
  code        TEXT PRIMARY KEY,
  pct         INTEGER NOT NULL CHECK (pct BETWEEN 1 AND 90),
  expires_at  TIMESTAMPTZ,
  max_uses    INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses        INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_pct INTEGER;

-- Commandes saisies depuis l'admin + infos client
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'site';

-- Sécurité de l'administration
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
DELETE FROM admin_sessions WHERE expires_at < now();

CREATE TABLE IF NOT EXISTS admin_audit (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON admin_audit (at DESC);

-- Échéances et rappels de renouvellement
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
UPDATE orders SET expires_at = created_at + interval '12 months' WHERE status = 'confirmed' AND expires_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_expires_idx ON orders (expires_at) WHERE status = 'confirmed';

-- Table clients
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  airtable_id TEXT DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_airtable_id_idx ON clients (airtable_id);

-- Coffre-fort de comptes & licences (stock et attribution aux commandes)
CREATE TABLE IF NOT EXISTS accounts (
  id           SERIAL PRIMARY KEY,
  offer_id     INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL DEFAULT '',
  login        TEXT NOT NULL,
  password     TEXT NOT NULL DEFAULT '',
  slot_profile TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'archived')),
  supplier     TEXT NOT NULL DEFAULT '',
  supplier_url TEXT NOT NULL DEFAULT '',
  cost         NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  private_notes TEXT NOT NULL DEFAULT '',
  airtable_id  TEXT DEFAULT NULL,
  order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  assigned_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS supplier_url TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS private_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS airtable_id TEXT DEFAULT NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS warranty_claim BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS defect_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS defect_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS replaced_by_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_airtable_id_idx ON accounts (airtable_id);
CREATE INDEX IF NOT EXISTS accounts_offer_idx ON accounts (offer_id, status);
CREATE INDEX IF NOT EXISTS accounts_order_idx ON accounts (order_id);

-- Support des packs multi-services et découplage stock/packs
ALTER TABLE offers ADD COLUMN IF NOT EXISTS pack_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 2;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_access_token_idx ON orders (access_token);
INSERT INTO offers (slug, name, category, tag, price, was_price, description, features, hue, is_pack, active, sort, pack_items)
VALUES ('disney-plus', 'Disney+', 'streaming', 'Populaire', 25.00, 35.00, 'Films et séries Disney, Pixar, Marvel, Star Wars et Star.', '["Films et séries illimités", "4K Ultra HD", "Profil personnel", "Garantie 1 an"]'::jsonb, 210, FALSE, TRUE, 25, '[]'::jsonb)
ON CONFLICT (slug) DO NOTHING;
