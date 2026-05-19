-- V3: Web Share Target — campos para compartilhamento de imagens via PWA
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS imagem_url   TEXT;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS ai_status    TEXT NOT NULL DEFAULT 'manual'
  CHECK (ai_status IN ('identificado', 'pendente', 'nao_identificado', 'manual'));
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS descricao_ia TEXT;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS fonte        TEXT NOT NULL DEFAULT 'manual'
  CHECK (fonte IN ('manual', 'compartilhamento'));

CREATE INDEX IF NOT EXISTS idx_wishlist_ai_status ON wishlist_items(ai_status);
CREATE INDEX IF NOT EXISTS idx_wishlist_fonte     ON wishlist_items(fonte);
