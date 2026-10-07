-- Feature: Reservas na fatura (NuBank principal)
-- Valores separados para compras que ainda vão cair na fatura — pontuais (só num mês),
-- parceladas (total dividido em N meses) ou recorrentes (todo mês, até serem
-- encerradas). O "Restante" de cada pessoa no Dashboard desconta a parte da reserva
-- que ainda não virou compra.
--
-- mes_inicio / mes_fim seguem o mês de referência do app (o mesmo de planejamento):
-- a reserva de outubro desconta da fatura exibida em outubro no Dashboard.
-- Pontual: mes_fim = mes_inicio. Parcelada: mes_fim = mês da última parcela.
-- Recorrente: mes_fim NULL até ser encerrada.

CREATE TABLE IF NOT EXISTS reservas_fatura (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao      TEXT        NOT NULL,
  valor          NUMERIC     NOT NULL CHECK (valor > 0),
  responsavel    TEXT        NOT NULL CHECK (responsavel IN ('Matheus', 'Jeniffer', 'Conjunto')),
  recorrente     BOOLEAN     NOT NULL DEFAULT FALSE,
  mes_inicio     DATE        NOT NULL,
  mes_fim        DATE,
  -- Termos separados por vírgula. Compras da fatura cuja descrição contém um deles
  -- abatem a reserva automaticamente (ex.: "posto, shell, ipiranga").
  palavras_chave TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (mes_fim IS NULL OR mes_fim >= mes_inicio)
);

CREATE INDEX IF NOT EXISTS reservas_fatura_periodo_idx ON reservas_fatura (mes_inicio, mes_fim);

-- Baixa manual ("já caiu na fatura") de uma reserva num mês específico.
CREATE TABLE IF NOT EXISTS reservas_fatura_baixas (
  reserva_id     UUID        NOT NULL REFERENCES reservas_fatura(id) ON DELETE CASCADE,
  mes_referencia DATE        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reserva_id, mes_referencia)
);

ALTER TABLE reservas_fatura ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservas_fatura_baixas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_reservas_fatura" ON reservas_fatura;
CREATE POLICY "authenticated_reservas_fatura" ON reservas_fatura
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_reservas_fatura_baixas" ON reservas_fatura_baixas;
CREATE POLICY "authenticated_reservas_fatura_baixas" ON reservas_fatura_baixas
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Compra prevista parcelada: `valor` é o total, dividido em `parcelas` meses
-- (mes_inicio até mes_fim). NULL = não parcelada. Pode rodar este arquivo de novo.
ALTER TABLE reservas_fatura ADD COLUMN IF NOT EXISTS parcelas INTEGER;
ALTER TABLE reservas_fatura DROP CONSTRAINT IF EXISTS reservas_fatura_parcelas_check;
ALTER TABLE reservas_fatura ADD CONSTRAINT reservas_fatura_parcelas_check
  CHECK (parcelas IS NULL OR parcelas BETWEEN 2 AND 48);
