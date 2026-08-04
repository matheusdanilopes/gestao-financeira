-- Cache persistido dos insights de IA da tela de Parcelamentos
-- Linha única (dados são compartilhados entre Matheus e Jeniffer, então um
-- cálculo serve para os dois) para evitar chamar a API do Gemini a cada
-- acesso à tela ou a cada nova parcela — a regra de recálculo (valor
-- comprometido em parcelamentos desde o último cálculo) é aplicada em
-- app/api/parcelamentos-insights/route.ts. Mesmo formato de insights_cache
-- (supabase/migrations.sql), tabela própria porque o domínio é diferente.

CREATE TABLE IF NOT EXISTS parcelamentos_insights_cache (
  id                    INT PRIMARY KEY DEFAULT 1,
  insights              JSONB NOT NULL,
  source                TEXT NOT NULL DEFAULT 'ai',
  fallback_reason       TEXT,
  comprometido_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parcelamentos_insights_cache_singleton CHECK (id = 1)
);

ALTER TABLE parcelamentos_insights_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_parcelamentos_insights_cache" ON parcelamentos_insights_cache;
CREATE POLICY "allow_all_parcelamentos_insights_cache" ON parcelamentos_insights_cache
  FOR ALL USING (true) WITH CHECK (true);
