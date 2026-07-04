-- ============================================================
-- Integração Pluggy: conexão automática com o Nubank principal
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================

-- 1. Tabela de itens (conexões bancárias) da Pluggy.
-- Hoje só existe uma linha (Nubank), mas é modelada como tabela para
-- permitir outras conexões futuras sem precisar de nova migração.
CREATE TABLE IF NOT EXISTS pluggy_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pluggy_item_id           TEXT NOT NULL UNIQUE,
  connector_id             INTEGER,
  connector_name           TEXT,
  cartao                   TEXT NOT NULL DEFAULT 'nubank',
  status                   TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | UPDATING | UPDATED | LOGIN_ERROR | OUTDATED | WAITING_USER_INPUT | ERROR
  execution_status         TEXT,
  last_sync_at             TIMESTAMPTZ,
  last_successful_sync_at  TIMESTAMPTZ,
  last_error_code          TEXT,
  last_error_message       TEXT,
  consecutive_errors       INTEGER NOT NULL DEFAULT 0,
  needs_user_action        BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_last_event       TEXT,
  webhook_last_received_at TIMESTAMPTZ,
  raw_item                 JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pluggy_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_pluggy_items" ON pluggy_items;
CREATE POLICY "authenticated_pluggy_items" ON pluggy_items
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
-- Nota: esta tabela é escrita pelo cliente com service role (bypassa RLS) nos
-- caminhos de cron/webhook, e lida pelo cliente autenticado normal na rota de
-- status/UI — mesmo formato de política usado no resto do schema.

CREATE INDEX IF NOT EXISTS idx_pluggy_items_cartao ON pluggy_items(cartao);

CREATE OR REPLACE FUNCTION set_pluggy_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pluggy_items_updated_at ON pluggy_items;
CREATE TRIGGER trg_pluggy_items_updated_at
  BEFORE UPDATE ON pluggy_items
  FOR EACH ROW EXECUTE FUNCTION set_pluggy_items_updated_at();

-- 2. Idempotência por transação da Pluggy, complementar ao hash_linha
-- (que continua sendo o mecanismo de dedup usado pela importação via CSV).
ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS pluggy_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transacoes_pluggy_transaction_id
  ON transacoes_nubank(pluggy_transaction_id)
  WHERE pluggy_transaction_id IS NOT NULL;

-- 3. Origem do dado, para diagnóstico (CSV importado manualmente vs Pluggy).
ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS origem_dado TEXT NOT NULL DEFAULT 'csv';

-- 4. Configurações da sincronização automática (evita cravar no código
-- números de janela/limite ainda não confirmados no plano gratuito real).
INSERT INTO configuracoes (chave, valor)
  VALUES
    ('pluggy_sync_window_days', '90'),
    ('pluggy_cron_enabled', 'true')
  ON CONFLICT (chave) DO NOTHING;
