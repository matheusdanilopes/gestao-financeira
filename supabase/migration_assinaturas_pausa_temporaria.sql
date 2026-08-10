-- Desativação temporária de assinaturas (pausa por um período) + correção do
-- estado "ativa" retroativo: hoje a reativação de uma assinatura reflete em
-- todos os meses (passados e futuros), pois "ativa" é um booleano único sem
-- dimensão de tempo. Este script adiciona:
--
-- 1) assinaturas.pausada_ate: data agendada de reativação automática (pausa).
-- 2) assinaturas_status_historico: histórico de ativa/inativa ao longo do
--    tempo, no mesmo padrão de assinaturas_historico (valor), permitindo
--    calcular corretamente se a assinatura estava ativa em um mês específico.

ALTER TABLE assinaturas
  ADD COLUMN IF NOT EXISTS pausada_ate DATE;

CREATE TABLE IF NOT EXISTS assinaturas_status_historico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id UUID NOT NULL REFERENCES assinaturas(id) ON DELETE CASCADE,
  ativa         BOOLEAN NOT NULL,
  vigente_desde DATE NOT NULL,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE assinaturas_status_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_assinaturas_status_historico" ON assinaturas_status_historico;
CREATE POLICY "allow_all_assinaturas_status_historico" ON assinaturas_status_historico
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_assinaturas_status_hist_lookup
  ON assinaturas_status_historico(assinatura_id, vigente_desde DESC);

-- Backfill: registra o status atual de cada assinatura como versão inicial
-- (idempotente: só insere se a assinatura ainda não tiver nenhum histórico).
INSERT INTO assinaturas_status_historico (assinatura_id, ativa, vigente_desde, criado_em)
SELECT a.id, a.ativa, COALESCE(a.created_at::date, '2000-01-01'), COALESCE(a.created_at, NOW())
FROM assinaturas a
WHERE NOT EXISTS (
  SELECT 1 FROM assinaturas_status_historico h WHERE h.assinatura_id = a.id
);
