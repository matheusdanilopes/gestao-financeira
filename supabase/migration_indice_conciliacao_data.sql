-- Índice composto (cartao, data_compra) em transacoes_nubank.
--
-- A conciliação de importação (lib/conciliacao.ts) busca candidatos de match
-- filtrando por cartao + data_compra dentro de uma janela (±3 dias em compras
-- normais, ±30 dias em estornos). Só existia índice em `cartao` isoladamente
-- (idx_transacoes_cartao) — a filtragem por data era feita depois, sem índice,
-- ficando mais lenta conforme a tabela cresce. Este índice composto cobre as
-- duas janelas de uma vez, sem alterar nenhum dado nem comportamento.
--
-- Seguro para rodar em produção: CREATE INDEX (sem CONCURRENTLY) tranca a
-- tabela para escrita só durante a criação, que é rápida no volume atual desta
-- tabela; use CREATE INDEX CONCURRENTLY (fora de uma transação) se a tabela já
-- estiver grande o suficiente para tornar isso um problema.

CREATE INDEX IF NOT EXISTS idx_transacoes_cartao_data_compra
  ON transacoes_nubank(cartao, data_compra);
