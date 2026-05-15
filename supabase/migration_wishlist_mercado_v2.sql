-- V2: Adiciona campos de autoria e enriquecimento de dados

-- wishlist_items: emoji, categoria, nota, favoritado, criado_por
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS criado_por    TEXT;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS emoji         TEXT;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS categoria     TEXT;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS nota          TEXT;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS favoritado    BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_wishlist_favoritado ON wishlist_items(favoritado);
CREATE INDEX IF NOT EXISTS idx_wishlist_categoria  ON wishlist_items(categoria);

-- lista_mercado_itens: criado_por
ALTER TABLE lista_mercado_itens ADD COLUMN IF NOT EXISTS criado_por TEXT;
