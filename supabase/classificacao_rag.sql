-- ============================================================
-- Classificação com RAG e Active Learning
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================

-- 18. Tabela de memória de longo prazo para classificações aprendidas pelo usuário
-- Cada linha representa uma descrição sanitizada com a categoria confirmada pelo usuário.
-- A frequência aumenta a cada confirmação, tornando o histórico mais confiável ao longo do tempo.
CREATE TABLE IF NOT EXISTS classificacoes_aprendidas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL DEFAULT 'default',
  descricao_limpa    TEXT NOT NULL,
  categoria_validada TEXT NOT NULL,
  frequencia         INT NOT NULL DEFAULT 1,
  ultima_atualizacao TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT classificacoes_aprendidas_uid UNIQUE (user_id, descricao_limpa)
);

ALTER TABLE classificacoes_aprendidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_classificacoes_aprendidas" ON classificacoes_aprendidas;
CREATE POLICY "allow_all_classificacoes_aprendidas" ON classificacoes_aprendidas
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_classif_aprendidas_user_desc
  ON classificacoes_aprendidas(user_id, descricao_limpa);

CREATE INDEX IF NOT EXISTS idx_classif_aprendidas_user_freq
  ON classificacoes_aprendidas(user_id, frequencia DESC);

CREATE INDEX IF NOT EXISTS idx_classif_aprendidas_categoria
  ON classificacoes_aprendidas(user_id, categoria_validada);

-- 19. Coluna de status de classificação por IA em transacoes_nubank
-- Separada do status de conciliação (PENDENTE / CONFLITO_VALOR) para não
-- sobrescrever a lógica existente.
-- Valores: 'validado' | 'revisao_pendente' | NULL (não classificado via RAG)
ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS classificacao_status TEXT;

CREATE INDEX IF NOT EXISTS idx_transacoes_classificacao_status
  ON transacoes_nubank(classificacao_status);
