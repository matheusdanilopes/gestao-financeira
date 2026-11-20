-- Feature: comparação "previsão × importado" na primeira importação de cada fatura.
--
-- Guarda, no log da importação, o resumo gerado por lib/comparacaoPrevisao.ts:
-- parcelas projetadas antes da importação × fatura gravada, totais por responsável,
-- parcelas que mudaram de responsável/valor, parcelas que não vieram e compras fora
-- da previsão. Exibido no detalhe da importação em /importar.

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS comparacao_previsao JSONB;
