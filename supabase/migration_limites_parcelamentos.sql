-- Feature: Limite mensal de parcelamentos por pessoa (Matheus/Jeniffer/Conjunto)
-- Cada linha é o limite de UM mês + UMA pessoa — editar o mês atual não altera meses passados.

CREATE TABLE IF NOT EXISTS limites_parcelamentos (
  mes_referencia DATE        NOT NULL,
  responsavel    TEXT        NOT NULL CHECK (responsavel IN ('Matheus', 'Jeniffer', 'Conjunto')),
  valor          NUMERIC     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mes_referencia, responsavel)
);

ALTER TABLE limites_parcelamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_limites_parcelamentos" ON limites_parcelamentos;
CREATE POLICY "authenticated_limites_parcelamentos" ON limites_parcelamentos
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
