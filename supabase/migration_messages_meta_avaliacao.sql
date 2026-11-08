-- ============================================================
-- Registro completo e avaliação das respostas do Fin.
--
-- meta: como a resposta foi produzida —
--   { "modelo": "...", "rodadas": 3, "duracaoMs": 8200,
--     "uso": { "entrada": 9100, "saida": 420, "raciocinio": 800 },
--     "revisoes": ["lastro"],
--     "lastro": { "citados": 5, "semLastro": [] },
--     "tela": "dashboard" }
--   A trilha (coluna ferramentas) passa a guardar também o resultado de cada
--   consulta, então dá para reconstruir de onde veio cada número.
--
-- avaliacao: 👍 (1) / 👎 (-1) dado pelo usuário no chat. Cada 👎 é candidato
--   a caso do conjunto de avaliação (scripts/evals).
--
-- Tudo nullable e opcional: o app grava sem essas colunas se ainda não existirem.
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS avaliacao SMALLINT CHECK (avaliacao IN (-1, 1));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS avaliacao_comentario TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS avaliado_em TIMESTAMPTZ;

-- Busca dos 👎 para montar casos de avaliação.
CREATE INDEX IF NOT EXISTS idx_messages_avaliacao
  ON messages (avaliado_em DESC) WHERE avaliacao IS NOT NULL;
