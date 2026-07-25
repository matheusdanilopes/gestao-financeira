-- Feature: Detalhes de validação por linha nos logs de importação (com reversão manual)
--
-- Cada linha de um arquivo importado via /api/nubank/importar gera um registro aqui,
-- associado ao log da importação em activity_logs. Retenção de 2 dias — a limpeza é
-- feita pelo cron diário em /api/manutencao/limpeza (ver supabase/migrations.sql).

CREATE TABLE IF NOT EXISTS import_validacoes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id          UUID        NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
  descricao       TEXT        NOT NULL,
  valor           NUMERIC(12,2),
  data_compra     DATE,
  decisao         TEXT        NOT NULL,
  -- 'inserida' | 'removida' | 'duplicada' | 'conflito' | 'conciliada' | 'conciliacao_desfeita' |
  -- 'estorno_aplicado' | 'estorno_registrado' | 'estorno_removido' | 'estorno_ignorado'
  transacao_id    UUID,        -- id atual em transacoes_nubank associado a esta linha (sem FK — a linha pode ser apagada)
  dados_linha     JSONB       NOT NULL,  -- payload completo (TransacaoNubank + status) usado para inserir; permite reinserir depois
  estado_anterior JSONB,       -- para estornos aplicados: { original_id, status_anterior } antes de marcar ESTORNADO
  notificacao_id  UUID,        -- só para decisao='conflito': aponta pra notificação conciliacao_conflito
  revertido_em    TIMESTAMPTZ, -- preenchido quando o usuário reverte manualmente
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE import_validacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_import_validacoes" ON import_validacoes;
CREATE POLICY "allow_all_import_validacoes" ON import_validacoes
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_import_validacoes_log_id ON import_validacoes(log_id);
CREATE INDEX IF NOT EXISTS idx_import_validacoes_created ON import_validacoes(created_at);
