-- ============================================================
-- Trilha de ferramentas de cada resposta da IA.
--
-- Guarda, junto da mensagem do assistente, quais consultas ele fez e com
-- quais filtros: [{ "nome": "consultar_transacoes", "rotulo": "...",
-- "args": { ... } }]. Serve para reabrir a conversa com a trilha visível e
-- para auditar depois por que um número saiu errado.
--
-- Nullable e opcional: o app grava sem ela se a coluna não existir.
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS ferramentas JSONB;
