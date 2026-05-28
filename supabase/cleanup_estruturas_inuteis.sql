-- ============================================================
-- LIMPEZA DE ESTRUTURAS INÚTEIS — Gestão Financeira
-- Análise completa: tabelas, colunas, índices, constraints
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================
--
-- REVISÃO REALIZADA EM: 2026-05-28
-- METODOLOGIA:
--   1. Mapeamento de todas as referências no código (app/, lib/, components/)
--   2. Cruzamento com schema das migrações
--   3. Classificação por nível de segurança
--
-- ESTRUTURA DESTE ARQUIVO:
--   SEÇÃO A — Remoções seguras (confirmadas sem uso)
--   SEÇÃO B — Revisão manual necessária (ambiente-dependente)
--   SEÇÃO C — Reorganização de arquivos de migração
-- ============================================================


-- ============================================================
-- SEÇÃO A — REMOÇÕES SEGURAS (confirmar backup antes)
-- ============================================================
-- Critério: estrutura escrita mas NUNCA lida em qualquer query,
-- filter, join, exibição de UI ou lógica de negócio.
-- Validação: grep completo em app/, lib/, components/ sem hit de leitura.
-- ============================================================


-- ── A1: Coluna `categoria_confianca` em transacoes_nubank ─────────────────────
--
-- MOTIVO: A coluna é escrita por 3 caminhos:
--   • categorizarTransacoes.ts  → categoria_confianca: CONFIANCA_PADRAO_IA
--   • classificar/route.ts      → categoria_confianca: resultado.confianca / 100
--   • classificar/feedback/route.ts → categoria_confianca: 1.0
--   • compras/page.tsx (edição manual)
--
-- Mas NUNCA é lida: nenhuma query, filtro, join, cálculo ou exibição
-- referencia o valor armazenado. O sistema usa `categoria_origem` (IA/RAG/
-- MANUAL/USUARIO) como sinal de qualidade — não `categoria_confianca`.
--
-- IMPACTO: Zero. Nenhuma funcionalidade, regra de negócio ou histórico
-- válido é afetado. Apenas o dado bruto de confiança é descartado.
--
-- ROLLBACK: ALTER TABLE transacoes_nubank ADD COLUMN categoria_confianca NUMERIC(3,2);
--
ALTER TABLE transacoes_nubank DROP COLUMN IF EXISTS categoria_confianca;


-- ── A2: Índice `idx_transacoes_fatura_responsavel` ───────────────────────────
--
-- MOTIVO: Nenhuma query da aplicação filtra por (projeto_fatura, responsavel)
-- em conjunto no banco. Toda filtragem por responsavel é feita em JavaScript
-- após retorno dos dados — sem cláusula WHERE no banco.
--
-- Queries verificadas:
--   • financas/page.tsx, investimentos/page.tsx → .eq('projeto_fatura', ...) apenas
--   • prefetchers.ts → .eq('projeto_fatura', ...)  apenas
--   • dashboard/page.tsx → .eq('projeto_fatura', ...).eq('cartao', ...) — sem responsavel
--   • conciliacao.ts → .neq('status', ...) — sem responsavel
--   • contextBuilder.ts → .gte('projeto_fatura', limite) — sem responsavel
--
-- O índice `idx_transacoes_fatura` (projeto_fatura simples) e
-- `idx_transacoes_fatura_cartao` (projeto_fatura, cartao) cobrem todos
-- os padrões de acesso reais.
--
-- IMPACTO: Apenas redução de overhead de escrita nas inserções/atualizações.
-- Nenhuma query fica mais lenta (a coluna continua disponível para leitura).
--
-- ROLLBACK:
--   CREATE INDEX idx_transacoes_fatura_responsavel
--     ON transacoes_nubank(projeto_fatura, responsavel);
--
DROP INDEX IF EXISTS idx_transacoes_fatura_responsavel;


-- ── A3: Índice `idx_transacoes_responsavel` ──────────────────────────────────
--
-- MOTIVO: Nenhuma query filtra APENAS por `responsavel` no banco.
-- O campo aparece só em SELECT ou em filtros JavaScript pós-fetch.
--
-- Queries verificadas (grep completo):
--   • Nenhuma query usa .eq('responsavel', ...) como único filtro ou
--     filtro principal em transacoes_nubank.
--   • O campo é sempre combinado com projeto_fatura (coberto por outros índices)
--     ou filtrado em memória no cliente.
--
-- IMPACTO: Apenas redução de overhead de escrita. Nenhuma degradação de leitura.
--
-- ROLLBACK:
--   CREATE INDEX idx_transacoes_responsavel ON transacoes_nubank(responsavel);
--
DROP INDEX IF EXISTS idx_transacoes_responsavel;


-- ============================================================
-- SEÇÃO B — REVISÃO MANUAL (verificar no Supabase antes de executar)
-- ============================================================


-- ── B1: Possível duplicidade `data` × `data_compra` em transacoes_nubank ─────
--
-- CONTEXTO:
--   O schema original usou a coluna `data` (referenciada em analytics_views.sql,
--   contextBuilder.ts, fix_duplicatas_v2.sql e v_analytics_mensal view).
--   O código de importação mais recente tenta inserir como `data_compra` e
--   faz fallback para `data` se a coluna não existir:
--
--     if (result.error?.message?.includes('data_compra')) {
--       insert({ ...resto, data: data_compra })
--     }
--
--   O índice `idx_transacoes_dedup_janela` foi criado em data_compra.
--
-- VERIFICAÇÃO NECESSÁRIA (no Supabase SQL Editor):
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'transacoes_nubank'
--     AND column_name IN ('data', 'data_compra')
--   ORDER BY column_name;
--
-- CENÁRIO 1 — apenas `data` existe:
--   O código de importação usa fallback corretamente.
--   `idx_transacoes_dedup_janela` NÃO existe (criação silenciosa falha).
--   → Nenhuma ação necessária.
--
-- CENÁRIO 2 — apenas `data_compra` existe:
--   A view v_analytics_mensal e contextBuilder.ts estão quebrando!
--   → Aplicar SEÇÃO B1-FIX abaixo após confirmar.
--
-- CENÁRIO 3 — ambas existem (mais provável se houve migração parcial):
--   `data` é a coluna principal (usada em mais lugares).
--   `data_compra` é redundante.
--   → Executar apenas após confirmar que `data_compra` contém os mesmos valores.
--
-- SQL DE VERIFICAÇÃO DE DUPLICIDADE (só no Cenário 3):
/*
SELECT COUNT(*) AS divergencias
FROM transacoes_nubank
WHERE data IS DISTINCT FROM data_compra;
*/
--
-- SE divergencias = 0, `data_compra` é idêntica a `data` e pode ser removida:
/*
-- B1-REMOCAO: Remove coluna redundante e índice dependente
DROP INDEX IF EXISTS idx_transacoes_dedup_janela;
ALTER TABLE transacoes_nubank DROP COLUMN IF EXISTS data_compra;
*/
--
-- SE divergencias > 0, as colunas diferem. Revisar dados antes de qualquer ação.


-- ── B2: Índice `idx_transacoes_dedup_janela` ─────────────────────────────────
--
-- MOTIVO: Criado para acelerar scripts manuais de deduplicação (fix_duplicatas_janela.sql).
-- A aplicação (app/, lib/) NÃO usa este índice em nenhuma query de runtime.
-- É overhead de escrita sem benefício operacional diário.
--
-- CONDIÇÃO: Só existe se `data_compra` existe (ver B1).
-- Se `data_compra` for removida (B1-REMOCAO), este índice é removido junto.
-- Se `data_compra` existir e for mantida, este índice pode ser removido separadamente:
--
/*
DROP INDEX IF EXISTS idx_transacoes_dedup_janela;
*/


-- ============================================================
-- SEÇÃO C — CLASSIFICAÇÃO COMPLETA (não executável — documentação)
-- ============================================================
--
-- ESTRUTURAS ANALISADAS E RESULTADO:
--
-- TABELAS (19 total) — NENHUMA a remover:
--   transacoes_nubank       MANTER  core da aplicação
--   planejamento            MANTER  orçamento mensal
--   receitas_recebimentos   MANTER  controle de receitas (ReceitasMensal.tsx)
--   investimentos           MANTER  carteira de investimentos
--   investimentos_aportes   MANTER  aportes por investimento
--   notificacoes            MANTER  notificações entre usuários + conciliação
--   push_subscriptions      MANTER  notificações PWA
--   configuracoes           MANTER  configurações da aplicação
--   activity_logs           MANTER  log de atividades (exibido em configurações)
--   categorization_jobs     MANTER  rastreamento de jobs de categorização
--   conversations           MANTER  histórico de chat com IA
--   messages                MANTER  mensagens do chat
--   assinaturas             MANTER  assinaturas recorrentes
--   assinaturas_historico   MANTER  histórico de valores de assinaturas
--   faturas                 MANTER  datas de fechamento de faturas
--   wishlist_items          MANTER  lista de desejos + compartilhamento
--   lista_mercado_itens     MANTER  lista de mercado
--   historico_compras       MANTER  histórico de compras do mercado
--   classificacoes_aprendidas MANTER  memória RAG de classificações
--
-- COLUNAS CRÍTICAS (não remover):
--   transacoes_nubank.status            MANTER  conciliação (PENDENTE/CONFLITO_VALOR/CONCILIADO)
--   transacoes_nubank.valor_final       MANTER  conciliação (valor reconciliado)
--   transacoes_nubank.conciliacao_ref   MANTER  referência ao par de conciliação
--   transacoes_nubank.classificacao_status MANTER  RAG (validado/revisao_pendente)
--   transacoes_nubank.categoria_origem  MANTER  sinal de qualidade (IA/RAG/MANUAL/USUARIO)
--   transacoes_nubank.hash_linha        MANTER  deduplicação (UNIQUE constraint)
--
-- ÍNDICES ÚTEIS (não remover):
--   idx_transacoes_fatura            projeto_fatura           — query mais comum
--   idx_transacoes_fatura_cartao     projeto_fatura, cartao   — dashboard e compras
--   idx_transacoes_cartao            cartao                   — filtros por cartão
--   idx_transacoes_data              data                     — analytics view
--   idx_transacoes_data_cat_resp     data, categoria, resp.   — analytics view
--   idx_transacoes_status            status                   — conciliação
--   idx_transacoes_classificacao_status  classificacao_status — RAG
--   idx_planejamento_mes             mes_referencia           — queries mensais
--   idx_planejamento_vencimento      data_vencimento          — notificações
--   idx_investimentos_mes            mes_referencia           — queries mensais
--   idx_aportes_investimento         investimento_id          — join comum
--   idx_activity_logs_created        created_at               — ordenação
--   idx_receitas_recebimentos_planejamento  planejamento_id  — join
--   idx_notificacoes_created         created_at               — ordenação
--   idx_notificacoes_de_usuario      de_usuario               — filtros
--   idx_assinaturas_cartao           cartao                   — filtros
--   idx_assinaturas_ativa            ativa                    — filtros
--   idx_assinaturas_hist_lookup      assinatura_id, vigente   — join + ordem
--   idx_faturas_cartao_mes           cartao, mes_referencia   — lookup de faturas
--   idx_conversations_user           user_id, created_at      — chat
--   idx_messages_conversation        conversation_id, created_at — chat
--   idx_categorization_jobs_started  started_at               — status
--   idx_classif_aprendidas_user_desc user_id, descricao_limpa — RAG (principal)
--   idx_classif_aprendidas_user_freq user_id, frequencia      — RAG
--   idx_classif_aprendidas_categoria user_id, categoria       — RAG
--   idx_wishlist_*                   (7 índices)              — wishlist
--   idx_lista_mercado_*              (2 índices)              — lista
--   idx_historico_compras_*          (2 índices)              — histórico
--
-- SCRIPTS DE MANUTENÇÃO (não são migrações ativas):
--   fix_duplicatas.sql          script manual de limpeza (já aplicado)
--   fix_duplicatas_v2.sql       script manual de limpeza (já aplicado)
--   fix_duplicatas_janela.sql   script manual de limpeza (já aplicado)
--   unificar_categorias.sql     migração de dados (já aplicada)
--   fix_categorias_rls.sql      correção de RLS (já aplicada)
--   security_rls_fix.sql        endurecimento de segurança (já aplicado)
-- ============================================================


-- ============================================================
-- VERIFICAÇÃO PÓS-EXECUÇÃO
-- Execute após as remoções para confirmar estado final
-- ============================================================

-- Confirma que coluna foi removida:
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'transacoes_nubank'
  AND column_name = 'categoria_confianca';
-- Resultado esperado: 0 linhas

-- Confirma que índices foram removidos:
SELECT indexname
FROM pg_indexes
WHERE tablename = 'transacoes_nubank'
  AND indexname IN (
    'idx_transacoes_fatura_responsavel',
    'idx_transacoes_responsavel'
  );
-- Resultado esperado: 0 linhas

-- Lista todos os índices restantes em transacoes_nubank (conferência geral):
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'transacoes_nubank'
ORDER BY indexname;
