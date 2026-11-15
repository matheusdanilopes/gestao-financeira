-- ============================================================================
-- Leitura do banco por IA (e por qualquer consulta SQL direta)
--
-- As regras do app estavam só no TypeScript: o mês da fatura × o mês do
-- planejamento, os prefixos de cartão no `item`, o tratamento de estornos, a
-- parcela escrita na descrição. Uma IA consultando as tabelas cruas erra
-- nessas regras (o caso clássico: somar as compras E a linha da fatura no
-- planejamento, dobrando o gasto). Esta migração deixa as regras no banco:
--
--   vw_resumo_mensal      receita, faturas, contas e saldo por mês — a mesma
--                         conta do Dashboard (lib/faturaEfetiva.ts)
--   vw_compras            compras já tratadas: sem as linhas de estorno,
--                         parcela lida das colunas ou da descrição, compra
--                         nova × parcela antiga, valor cheio, mês em que pesa
--   vw_pendencias_dados   o que está inconsistente e como corrigir
--   COMMENT ON            significado de tabelas e colunas
--
-- Corrige também vw_analise_faturas_cobertura, que comparava o pagamento do
-- mês M com as compras da fatura M (o certo, como no Dashboard, é M+1).
--
-- Depende de migration_analise_fin_views.sql. Idempotente.
-- ============================================================================

-- ── Valor em reais, no formato brasileiro ('R$ 1.234,56') ──────────────────
CREATE OR REPLACE FUNCTION public.analise_brl(v numeric)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT 'R$ ' || translate(to_char(round(coalesce(v, 0), 2), 'FM999G999G990D00'), ',.', '.,')
$$;

-- ── Parcela de uma compra ───────────────────────────────────────────────────
-- Mesma regra de lib/parcelaDescricao.ts (extrairParcela): as colunas; senão
-- "Parcela N/M" na descrição; senão um "N/M" de até 2 dígitos com M >= 2.
-- Devolve {atual, total} ou NULL (compra à vista).
CREATE OR REPLACE FUNCTION public.analise_parcela(descricao text, p_atual int, p_total int)
RETURNS int[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_atual >= 1 AND p_total >= p_atual THEN ARRAY[p_atual, p_total]
    WHEN m1 IS NOT NULL AND m1[1]::int >= 1 AND m1[2]::int >= m1[1]::int THEN ARRAY[m1[1]::int, m1[2]::int]
    WHEN m2 IS NOT NULL AND m2[1]::int >= 1 AND m2[2]::int >= m2[1]::int AND m2[2]::int >= 2 THEN ARRAY[m2[1]::int, m2[2]::int]
  END
  FROM (SELECT
    regexp_match(coalesce(descricao, ''), 'parcela\s*(\d+)\s*/\s*(\d+)', 'i') AS m1,
    regexp_match(coalesce(descricao, ''), '\y(\d{1,2})/(\d{1,2})\y') AS m2
  ) x
$$;

-- ── vw_analise_faturas_cobertura (correção do mês) ──────────────────────────
-- A linha do cartão no planejamento de M paga a fatura com projeto_fatura M+1.
CREATE OR REPLACE VIEW public.vw_analise_faturas_cobertura
WITH (security_invoker = true) AS
WITH linhas AS (
  SELECT
    p.mes_referencia AS mes,
    CASE
      WHEN btrim(p.item) ~* '^\[CARTAO1\]' THEN 'cartao1'
      WHEN btrim(p.item) ~* '^\[CARTAO2\]' THEN 'cartao2'
      ELSE 'nubank'
    END AS cartao,
    bool_or(p.pago) AS paga,
    sum(CASE WHEN p.pago THEN coalesce(p.valor_real, p.valor_previsto) ELSE 0 END) AS valor_pago
  FROM public.planejamento p
  WHERE btrim(p.item) ~* '^\[(PRINCIPAL|CARTAO1|CARTAO2)\]' OR btrim(p.item) ~* '^nubank\M'
  GROUP BY 1, 2
),
importadas AS (
  SELECT
    (t.projeto_fatura - interval '1 month')::date AS mes,
    coalesce(t.cartao, 'nubank') AS cartao,
    count(*)::int AS compras,
    sum(t.valor) AS valor
  FROM public.transacoes_nubank t
  WHERE t.valor > 0 AND coalesce(t.status, '') NOT IN ('ESTORNO', 'ESTORNADO')
  GROUP BY 1, 2
)
SELECT
  l.mes,
  l.cartao,
  l.paga,
  l.valor_pago,
  coalesce(i.compras, 0) AS compras_importadas,
  coalesce(i.valor, 0) AS valor_importado,
  CASE
    WHEN l.paga AND l.valor_pago > 0
      THEN round(greatest(l.valor_pago - coalesce(i.valor, 0), 0) / l.valor_pago * 100, 1)
  END AS pct_sem_detalhe
FROM linhas l
LEFT JOIN importadas i ON i.mes = l.mes AND i.cartao = l.cartao;

-- ── vw_compras ──────────────────────────────────────────────────────────────
-- Uma linha por compra do cartão (as linhas de estorno ficam em
-- vw_analise_estornos). Para somar gasto, filtre conta_no_gasto.
CREATE OR REPLACE VIEW public.vw_compras
WITH (security_invoker = true) AS
WITH devolvidas AS (
  SELECT DISTINCT e.original_id FROM public.vw_analise_estornos e
  WHERE e.situacao = 'original_ativo' AND e.original_id IS NOT NULL
)
SELECT
  t.id,
  t.data AS data_compra,
  t.projeto_fatura AS fatura,
  (t.projeto_fatura - interval '1 month')::date AS mes_planejamento,
  coalesce(t.cartao, 'nubank') AS cartao,
  t.responsavel,
  coalesce(nullif(btrim(t.descricao_personalizada), ''), t.descricao) AS descricao,
  t.descricao AS descricao_original,
  public.analise_chave_estabelecimento(t.descricao) AS estabelecimento,
  t.categoria,
  t.categoria_origem,
  t.classificacao_status,
  t.valor,
  p.parcela[1] AS parcela_atual,
  p.parcela[2] AS total_parcelas,
  CASE WHEN coalesce(p.parcela[1], 1) <= 1 THEN 'compra_nova' ELSE 'parcela_antiga' END AS tipo,
  round(t.valor * coalesce(p.parcela[2], 1), 2) AS valor_total_compra,
  t.status,
  (t.status = 'ESTORNADO' OR d.original_id IS NOT NULL) AS estornada,
  (coalesce(t.status, '') <> 'ESTORNADO' AND d.original_id IS NULL AND t.valor > 0) AS conta_no_gasto,
  t.created_at
FROM public.transacoes_nubank t
CROSS JOIN LATERAL (SELECT public.analise_parcela(t.descricao, t.parcela_atual, t.total_parcelas) AS parcela) p
LEFT JOIN devolvidas d ON d.original_id = t.id
WHERE coalesce(t.status, '') <> 'ESTORNO';

-- ── vw_resumo_mensal ────────────────────────────────────────────────────────
-- Uma linha por mês do planejamento, com a conta de lib/faturaEfetiva.ts
-- (calcularResumoSaldo), a mesma do Dashboard:
--   receita         soma das receitas PREVISTAS (como o Dashboard)
--   contas          despesas que não são fatura: paga = valor real; aberta = previsto
--   fatura_*        por cartão (o principal, por responsável): com linha paga,
--                   o que foi pago; sem pagamento, as compras da fatura M+1
--                   (estorno sem par abate); sem compras, o previsto
--   saldo           receita − contas − faturas
-- tem_planejamento = false: mês só com compras (antes de o app ser usado
-- para o orçamento); ignore esses meses ao falar de saldo.
-- Diferença: no mês da fatura ainda aberta o Dashboard também desconta
-- assinaturas e compras previstas que ainda não caíram (pendentes); aqui não.
CREATE OR REPLACE VIEW public.vw_resumo_mensal
WITH (security_invoker = true) AS
WITH plan AS (
  SELECT
    p.mes_referencia AS mes,
    coalesce(p.responsavel, '') AS responsavel,
    coalesce(p.valor_previsto, 0) AS previsto,
    coalesce(p.valor_real, p.valor_previsto, 0) AS realizado,
    coalesce(p.pago, false) AS pago,
    CASE
      WHEN btrim(p.item) = 'Receita Total' OR btrim(p.item) LIKE '[RECEITA]%' THEN 'receita'
      WHEN btrim(p.item) LIKE '[PRINCIPAL]%' OR btrim(p.item) ~* '^nubank\M' THEN 'principal'
      WHEN btrim(p.item) LIKE '[CARTAO1]%' THEN 'cartao1'
      WHEN btrim(p.item) LIKE '[CARTAO2]%' THEN 'cartao2'
      ELSE 'conta'
    END AS tipo
  FROM public.planejamento p
),
compras AS (
  SELECT
    (t.projeto_fatura - interval '1 month')::date AS mes,
    CASE
      WHEN t.cartao IS NULL OR t.cartao = 'nubank' THEN 'principal'
      WHEN t.cartao IN ('cartao1', 'cartao2') THEN t.cartao
    END AS tipo,
    coalesce(t.responsavel, '') AS responsavel,
    sum(CASE
      WHEN t.status = 'ESTORNADO' THEN 0
      WHEN t.status = 'ESTORNO' THEN CASE WHEN t.conciliacao_ref IS NULL THEN -t.valor ELSE 0 END
      ELSE t.valor
    END) AS lancado
  FROM public.transacoes_nubank t
  GROUP BY 1, 2, 3
),
-- Cartões extras somam tudo; o principal é calculado por responsável.
chaves AS (
  SELECT mes, tipo, CASE WHEN tipo = 'principal' THEN responsavel ELSE '' END AS responsavel
  FROM plan WHERE tipo IN ('principal', 'cartao1', 'cartao2')
  UNION
  SELECT mes, tipo, CASE WHEN tipo = 'principal' THEN responsavel ELSE '' END
  FROM compras WHERE tipo IS NOT NULL AND (tipo <> 'principal' OR responsavel <> '')
),
cartoes AS (
  SELECT
    k.mes, k.tipo, k.responsavel,
    coalesce(pl.previsto, 0) AS previsto,
    coalesce(pl.pagas, 0) AS pagas,
    coalesce(pl.realizado_pagas, 0) AS realizado_pagas,
    coalesce(cp.lancado, 0) AS lancado
  FROM chaves k
  LEFT JOIN LATERAL (
    SELECT sum(p.previsto) AS previsto,
           count(*) FILTER (WHERE p.pago) AS pagas,
           sum(p.realizado) FILTER (WHERE p.pago) AS realizado_pagas
    FROM plan p
    WHERE p.mes = k.mes AND p.tipo = k.tipo AND (k.tipo <> 'principal' OR p.responsavel = k.responsavel)
  ) pl ON true
  LEFT JOIN LATERAL (
    SELECT sum(c.lancado) AS lancado
    FROM compras c
    WHERE c.mes = k.mes AND c.tipo = k.tipo AND (k.tipo <> 'principal' OR c.responsavel = k.responsavel)
  ) cp ON true
),
efetivo AS (
  SELECT c.*,
    CASE
      WHEN c.pagas > 0 THEN c.realizado_pagas
      WHEN c.lancado > 0 THEN c.lancado
      ELSE c.previsto
    END AS efetivo
  FROM cartoes c
),
meses AS (
  SELECT mes FROM plan UNION SELECT mes FROM efetivo
),
por_mes AS (
  SELECT
    m.mes,
    coalesce((SELECT sum(previsto) FROM plan p WHERE p.mes = m.mes AND p.tipo = 'receita'), 0) AS receita,
    coalesce((SELECT sum(CASE WHEN pago THEN realizado ELSE 0 END) FROM plan p WHERE p.mes = m.mes AND p.tipo = 'receita'), 0) AS receita_recebida_marcada,
    coalesce((SELECT sum(CASE WHEN pago THEN realizado ELSE previsto END) FROM plan p WHERE p.mes = m.mes AND p.tipo = 'conta'), 0) AS contas,
    coalesce((SELECT sum(previsto) FROM plan p WHERE p.mes = m.mes AND p.tipo = 'conta'), 0) AS contas_previstas,
    coalesce((SELECT sum(previsto) FROM plan p WHERE p.mes = m.mes AND p.tipo <> 'receita'), 0) AS total_planejado,
    coalesce((SELECT sum(efetivo) FROM efetivo e WHERE e.mes = m.mes AND e.tipo = 'principal'), 0) AS fatura_principal,
    coalesce((SELECT sum(efetivo) FROM efetivo e WHERE e.mes = m.mes AND e.tipo = 'cartao1'), 0) AS fatura_cartao1,
    coalesce((SELECT sum(efetivo) FROM efetivo e WHERE e.mes = m.mes AND e.tipo = 'cartao2'), 0) AS fatura_cartao2,
    coalesce((SELECT sum(lancado) FROM efetivo e WHERE e.mes = m.mes), 0) AS compras_lancadas,
    coalesce((SELECT bool_and(pagas > 0) FROM efetivo e WHERE e.mes = m.mes AND (e.previsto > 0 OR e.lancado > 0)), false) AS faturas_pagas,
    EXISTS (SELECT 1 FROM plan p WHERE p.mes = m.mes) AS tem_planejamento
  FROM meses m
)
SELECT
  mes,
  (mes + interval '1 month')::date AS fatura,
  round(receita, 2) AS receita,
  round(receita_recebida_marcada, 2) AS receita_recebida_marcada,
  round(contas, 2) AS contas,
  round(contas_previstas, 2) AS contas_previstas,
  round(fatura_principal, 2) AS fatura_principal,
  round(fatura_cartao1, 2) AS fatura_cartao1,
  round(fatura_cartao2, 2) AS fatura_cartao2,
  round(fatura_principal + fatura_cartao1 + fatura_cartao2, 2) AS faturas,
  round(compras_lancadas, 2) AS compras_lancadas,
  faturas_pagas,
  round(contas + fatura_principal + fatura_cartao1 + fatura_cartao2, 2) AS total_gastos,
  round(receita - (contas + fatura_principal + fatura_cartao1 + fatura_cartao2), 2) AS saldo,
  round(receita - total_planejado, 2) AS saldo_previsto,
  (mes < date_trunc('month', current_date)::date) AS mes_fechado,
  tem_planejamento
FROM por_mes;

-- ── vw_pendencias_dados ─────────────────────────────────────────────────────
-- O que está inconsistente nos dados, do mais grave para o menos grave.
-- Uma IA deve avisar sobre estas linhas antes de afirmar algo que dependa
-- delas; a pessoa corrige pelo app.
CREATE OR REPLACE VIEW public.vw_pendencias_dados
WITH (security_invoker = true) AS
WITH base AS (
  -- Recebimento de receita lançado duas vezes (mesma linha, valor e data).
  SELECT
    'recebimento_duplicado'::text AS tipo, 'alta'::text AS gravidade,
    p.mes_referencia AS mes, 'receitas_recebimentos'::text AS tabela, min(r.id::text)::uuid AS registro_id,
    p.item || ': ' || count(*) || ' recebimentos de ' || public.analise_brl(r.valor) || ' em ' || to_char(r.data_recebimento, 'DD/MM/YYYY') AS descricao,
    r.valor * (count(*) - 1) AS valor,
    'Apague o recebimento repetido na tela de Receitas.'::text AS como_corrigir
  FROM public.receitas_recebimentos r
  JOIN public.planejamento p ON p.id = r.planejamento_id
  GROUP BY p.mes_referencia, p.item, r.planejamento_id, r.valor, r.data_recebimento
  HAVING count(*) > 1

  UNION ALL
  -- A mesma parcela ("6/8") lançada em mais de um mês.
  SELECT
    'parcela_repetida', 'alta', max(v.mes_referencia), 'planejamento', (array_agg(v.id ORDER BY v.mes_referencia DESC))[1],
    min(v.item) || ' aparece em ' || count(*) || ' meses (' || string_agg(to_char(v.mes_referencia, 'MM/YYYY'), ', ' ORDER BY v.mes_referencia) || ')',
    max(v.item_valor),
    'Corrija o número da parcela no mês mais recente (provavelmente é a seguinte).'
  FROM (
    SELECT a.*, pl.valor_previsto AS item_valor
    FROM public.vw_analise_planejamento a JOIN public.planejamento pl ON pl.id = a.id
    WHERE a.tipo = 'conta' AND a.parcela_atual IS NOT NULL AND a.total_parcelas > 1
  ) v
  GROUP BY v.chave, v.parcela_atual, v.total_parcelas
  HAVING count(DISTINCT v.mes_referencia) > 1

  UNION ALL
  -- Estorno lançado em dobro.
  SELECT
    'estorno_duplicado', 'alta', e.projeto_fatura, 'transacoes_nubank', e.id,
    e.descricao || ' (' || to_char(e.data, 'DD/MM/YYYY') || ') lançado mais de uma vez',
    e.valor,
    'Apague o estorno repetido na tela de Compras.'
  FROM public.vw_analise_estornos e WHERE e.situacao = 'duplicado'

  UNION ALL
  -- Mesma cobrança lançada mais de uma vez no mesmo dia.
  SELECT
    'cobranca_duplicada', 'media', d.projeto_fatura, 'transacoes_nubank', d.ids[array_length(d.ids, 1)],
    d.descricao || ': ' || d.vezes || '× ' || public.analise_brl(d.valor) || ' em ' || to_char(d.data, 'DD/MM/YYYY'),
    d.valor_a_mais,
    'Confira na fatura do cartão: se foi cobrada uma vez só, apague a linha repetida; se foi cobrada em dobro, peça o estorno.'
  FROM public.vw_analise_cobrancas_duplicadas d

  UNION ALL
  -- Assinatura pausada/inativa no app e cobrada.
  SELECT
    'assinatura_pausada_cobrada', 'media', date_trunc('month', r.ultima_data)::date, 'assinaturas', r.assinatura_id,
    r.assinatura_nome || ' está pausada/inativa no app, mas foi cobrada ' || public.analise_brl(r.valor_ultimo) || ' em ' || to_char(r.ultima_data, 'DD/MM/YYYY'),
    r.valor_ultimo,
    'Confirme o cancelamento com o serviço ou reative a assinatura no app.'
  FROM public.vw_analise_recorrencias r WHERE r.situacao = 'inativa_cobrada'

  UNION ALL
  -- Compra estornada por inteiro que continua como gasto.
  SELECT
    'estorno_sem_marcacao', 'media', e.original_fatura, 'transacoes_nubank', e.original_id,
    coalesce(e.original_descricao, e.descricao) || ' foi estornada (' || public.analise_brl(e.valor) || ') mas segue contando como compra',
    e.valor,
    'Vincule o estorno à compra na tela de Compras.'
  FROM public.vw_analise_estornos e WHERE e.situacao = 'original_ativo'

  UNION ALL
  -- Receita de mês já encerrado sem a marcação de recebida.
  SELECT
    'receita_nao_marcada', 'baixa', a.mes_referencia, 'planejamento', a.id,
    btrim(a.item) || ' de ' || to_char(a.mes_referencia, 'MM/YYYY') ||
      CASE WHEN a.valor_recebido > 0 THEN ' tem ' || public.analise_brl(a.valor_recebido) || ' recebido registrado, mas não está marcada como recebida'
           ELSE ' não está marcada como recebida' END,
    pl.valor_previsto,
    'Marque como recebida (com o valor real) ou apague, se não entrou.'
  FROM public.vw_analise_planejamento a JOIN public.planejamento pl ON pl.id = a.id
  WHERE a.tipo = 'receita' AND NOT coalesce(a.pago, false)
    AND a.mes_referencia < date_trunc('month', current_date)::date

  UNION ALL
  -- Conta de mês já encerrado ainda em aberto.
  SELECT
    'conta_em_aberto', 'baixa', a.mes_referencia, 'planejamento', a.id,
    btrim(a.item) || ' de ' || to_char(a.mes_referencia, 'MM/YYYY') || ' ainda está em aberto',
    pl.valor_previsto,
    'Marque como paga (com o valor real) ou apague, se não houve a conta.'
  FROM public.vw_analise_planejamento a JOIN public.planejamento pl ON pl.id = a.id
  WHERE a.tipo IN ('conta', 'cartao') AND NOT coalesce(a.pago, false)
    AND a.mes_referencia < date_trunc('month', current_date)::date

  UNION ALL
  -- Contas pagas sem data de pagamento: a pontualidade não pode ser medida.
  SELECT
    'conta_paga_sem_data', 'baixa', p.mes_referencia, 'planejamento', min(p.id::text)::uuid,
    count(*) || ' contas pagas de ' || to_char(p.mes_referencia, 'MM/YYYY') || ' sem data de pagamento',
    sum(coalesce(p.valor_real, p.valor_previsto)),
    'Informe a data de pagamento ao marcar a conta como paga.'
  FROM public.planejamento p
  WHERE p.pago AND p.data_pagamento IS NULL
    AND btrim(p.item) NOT LIKE '[RECEITA]%' AND btrim(p.item) <> 'Receita Total'
  GROUP BY p.mes_referencia

  UNION ALL
  -- Compras com categoria a revisar ou vazia, por fatura.
  SELECT
    'categoria_a_revisar', 'baixa', c.mes, 'transacoes_nubank', NULL::uuid,
    sum(c.revisao_pendente + c.sem_categoria) || ' compras da fatura de ' || to_char(c.mes, 'MM/YYYY') || ' com categoria a revisar ou vazia',
    sum(c.revisao_pendente_valor + c.sem_categoria_valor),
    'Revise as categorias na tela de Compras.'
  FROM public.vw_analise_categorizacao_mensal c
  GROUP BY c.mes
  HAVING sum(c.revisao_pendente + c.sem_categoria) > 0
)
SELECT * FROM base
ORDER BY CASE gravidade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, mes DESC, tipo;

-- ── Acesso ──────────────────────────────────────────────────────────────────
REVOKE ALL ON public.vw_compras, public.vw_resumo_mensal, public.vw_pendencias_dados FROM anon;
GRANT SELECT ON public.vw_compras, public.vw_resumo_mensal, public.vw_pendencias_dados
  TO authenticated, service_role;

-- ── Dicionário de dados ─────────────────────────────────────────────────────

COMMENT ON TABLE public.transacoes_nubank IS
  'Lançamentos dos cartões de crédito (todos, não só NuBank), importados do CSV/API ou manuais. Para consultar gasto, prefira a view vw_compras (já trata estornos e parcelas) e, para totais do mês, vw_resumo_mensal. NÃO some estas compras com as linhas de cartão do planejamento: são o mesmo dinheiro.';
COMMENT ON COLUMN public.transacoes_nubank.data IS 'Data da compra.';
COMMENT ON COLUMN public.transacoes_nubank.descricao IS 'Descrição como veio do extrato. Pode conter a parcela ("Loja - Parcela 3/5" ou "Loja 3/5").';
COMMENT ON COLUMN public.transacoes_nubank.descricao_personalizada IS 'Nome dado pelo usuário na tela de Compras; quando preenchido, é o que ele vê e procura.';
COMMENT ON COLUMN public.transacoes_nubank.valor IS 'Valor da linha em R$, sempre positivo (inclusive nos estornos — veja status). Em compra parcelada, é o valor DA PARCELA.';
COMMENT ON COLUMN public.transacoes_nubank.valor_final IS 'Valor confirmado pela última conciliação com o extrato (CSV ou API). NULL = nunca conciliado.';
COMMENT ON COLUMN public.transacoes_nubank.responsavel IS 'Quem fez a compra: Matheus, Jeniffer ou Conjunto (gasto do casal).';
COMMENT ON COLUMN public.transacoes_nubank.projeto_fatura IS 'Fatura em que a compra cai: dia 1 do mês de VENCIMENTO da fatura. A fatura com projeto_fatura = M+1 é paga com o dinheiro do mês M do planejamento (é assim que o Dashboard soma).';
COMMENT ON COLUMN public.transacoes_nubank.hash_linha IS 'Hash da linha do extrato (data, descrição, valor, cartão) para não importar a mesma compra duas vezes.';
COMMENT ON COLUMN public.transacoes_nubank.parcela_atual IS 'Número da parcela (1 = compra nova). NULL em compra à vista ou quando a parcela só está na descrição.';
COMMENT ON COLUMN public.transacoes_nubank.total_parcelas IS 'Total de parcelas da compra. NULL em compra à vista ou quando só está na descrição.';
COMMENT ON COLUMN public.transacoes_nubank.categoria IS 'Categoria da compra (lista em configuracoes.categorias_compras). NULL = sem categoria.';
COMMENT ON COLUMN public.transacoes_nubank.categoria_origem IS 'Quem definiu a categoria: MANUAL (usuário), HISTORICO (aprendida de compras anteriores), IA, PARCELA (copiada da parcela anterior), REGRA.';
COMMENT ON COLUMN public.transacoes_nubank.classificacao_status IS 'automatico = categorizada sem revisão; revisao_pendente = palpite fraco, vale conferir; validado = conferida pelo usuário; NULL = anterior a esse controle.';
COMMENT ON COLUMN public.transacoes_nubank.categoria_confianca IS 'Confiança da categorização automática, de 0 a 1.';
COMMENT ON COLUMN public.transacoes_nubank.cartao IS 'nubank = cartão principal; cartao1 e cartao2 = cartões extras (o nome de cada um está nas linhas [CARTAO1]/[CARTAO2] do planejamento). NULL = principal.';
COMMENT ON COLUMN public.transacoes_nubank.status IS 'PENDENTE = importada; CONCILIADO = confirmada pelo extrato; ESTORNO = a linha é um crédito/devolução (valor positivo, abate o gasto); ESTORNADO = compra devolvida por um estorno (não conta como gasto).';
COMMENT ON COLUMN public.transacoes_nubank.is_estorno IS 'A linha veio do extrato como estorno. Use status para decidir se conta como gasto.';
COMMENT ON COLUMN public.transacoes_nubank.conciliacao_ref IS 'Num estorno: id da compra original que ele devolve. Estorno sem esta referência abate o gasto da fatura (a compra original continua contando).';

COMMENT ON TABLE public.planejamento IS
  'Orçamento mensal do casal: receitas, contas e o pagamento de cada fatura de cartão. O tipo da linha está no prefixo de item: [RECEITA] receita; [PRINCIPAL], [CARTAO1], [CARTAO2] (ou o legado "NuBank ...") = pagamento de fatura; sem prefixo = conta. Para totais do mês use vw_resumo_mensal; para a linha já classificada, vw_analise_planejamento.';
COMMENT ON COLUMN public.planejamento.mes_referencia IS 'Mês do orçamento (dia 1). A linha de cartão deste mês paga a fatura com projeto_fatura = mês seguinte.';
COMMENT ON COLUMN public.planejamento.item IS 'Nome da linha, com o prefixo que diz o tipo (veja o comentário da tabela). A parcela pode estar no nome ("Imposto de Renda 4/8").';
COMMENT ON COLUMN public.planejamento.categoria IS 'Grupo do orçamento (Moradia, Saúde, Lazer, Fixa, Extra, Cartão, Outros) — vocabulário diferente das categorias de compras.';
COMMENT ON COLUMN public.planejamento.responsavel IS 'Matheus, Jeniffer ou Conjunto.';
COMMENT ON COLUMN public.planejamento.valor_previsto IS 'Valor planejado.';
COMMENT ON COLUMN public.planejamento.valor_real IS 'Valor efetivamente pago (conta/fatura) ou recebido (receita). Vale quando pago = true.';
COMMENT ON COLUMN public.planejamento.pago IS 'Conta/fatura paga, ou receita recebida.';
COMMENT ON COLUMN public.planejamento.data_vencimento IS 'Vencimento da conta (opcional).';
COMMENT ON COLUMN public.planejamento.data_pagamento IS 'Quando foi paga/recebida (opcional; sem ela a pontualidade não é medida).';

COMMENT ON TABLE public.receitas_recebimentos IS 'Entradas de uma receita do planejamento (uma receita pode entrar em partes). Soma por planejamento_id = quanto entrou.';
COMMENT ON TABLE public.assinaturas IS 'Assinaturas cadastradas, cobradas no cartão indicado. valor = valor atual em R$ (histórico em assinaturas_historico).';
COMMENT ON COLUMN public.assinaturas.ativa IS 'Estado atual. O estado numa data passada está em assinaturas_status_historico (use analise_assinatura_ativa_em).';
COMMENT ON COLUMN public.assinaturas.pausada_ate IS 'Pausa temporária: volta a valer nesta data.';
COMMENT ON COLUMN public.assinaturas.valor_origem IS 'Valor na moeda de origem (moeda), para assinaturas cobradas em moeda estrangeira.';
COMMENT ON COLUMN public.assinaturas.dia_cobranca IS 'Dia do mês em que costuma ser cobrada.';
COMMENT ON TABLE public.assinaturas_historico IS 'Valores de cada assinatura ao longo do tempo (vigente_desde).';
COMMENT ON TABLE public.assinaturas_status_historico IS 'Ativações e pausas de cada assinatura (vigente_desde). Estado numa data = última linha com vigente_desde <= data; empate pelo criado_em mais recente.';
COMMENT ON TABLE public.investimentos IS 'Planejamento da carteira por mês. percentual = fatia da SOBRA do mês destinada ao investimento (não é rendimento).';
COMMENT ON TABLE public.investimentos_aportes IS 'Aportes feitos. saldo_atual = saldo do investimento informado pelo usuário no aporte (a única fonte de "quanto tenho investido").';
COMMENT ON TABLE public.faturas IS 'Data de fechamento informada de uma fatura (mes_referencia = mês de vencimento, como projeto_fatura). Sem linha, o app calcula pelo dia de vencimento em configuracoes.';
COMMENT ON TABLE public.configuracoes IS 'Chave/valor do app: dia_vencimento[_cartaoN] e ajuste_fechamento[_cartaoN] (ciclo das faturas), limite_cat_<Categoria> (teto mensal da categoria em R$), categorias_compras (JSON com a lista de categorias).';
COMMENT ON TABLE public.limites_parcelamentos IS 'Teto mensal de parcelas que cada responsável aceita comprometer.';
COMMENT ON TABLE public.reservas_fatura IS 'Compras previstas que ainda vão cair na fatura do cartão principal. valor = total; parcelas > 1 = parcelada; recorrente = todo mês até mes_fim. Uma compra da fatura com uma das palavras_chave abate a reserva.';
COMMENT ON TABLE public.reservas_fatura_baixas IS 'Baixa manual de uma reserva num mês ("já caiu na fatura").';

COMMENT ON VIEW public.vw_compras IS 'Compras do cartão já tratadas (sem as linhas de estorno). Some valor onde conta_no_gasto para o gasto; agrupe por fatura (mês de vencimento) ou mes_planejamento (mês do orçamento que paga). tipo: compra_nova (à vista ou 1ª parcela — a decisão de gastar) ou parcela_antiga (compra de meses anteriores). valor_total_compra = valor cheio da compra parcelada.';
COMMENT ON VIEW public.vw_resumo_mensal IS 'Receita, contas, faturas e saldo de cada mês do planejamento — a mesma conta do Dashboard. receita = prevista; faturas = pago na linha do cartão, ou compras lançadas da fatura do mês seguinte, ou previsto. Fonte certa para "quanto gastamos/sobrou no mês". Ignore os meses com tem_planejamento = false (só compras, sem orçamento).';
COMMENT ON VIEW public.vw_pendencias_dados IS 'Inconsistências nos dados e como corrigir, da gravidade alta para a baixa. Consulte antes de afirmar algo que dependa delas.';
COMMENT ON VIEW public.vw_analise_planejamento IS 'Planejamento classificado: tipo (receita/cartao/conta), chave estável da conta (sem parcela nem "Prestação"), parcela, valor recebido e receita recorrente × extraordinária.';
COMMENT ON VIEW public.vw_analise_estornos IS 'Cada estorno com a compra que devolve. situacao: pareado, original_ativo (a compra ainda conta como gasto), sem_par (parcial), duplicado.';
COMMENT ON VIEW public.vw_analise_recorrencias IS 'Cobranças mensais no cartão (últimos 6 meses) × assinaturas: cadastrada, preco_diferente, inativa_cobrada, nao_cadastrada. tipo iof = IOF de compra internacional.';
COMMENT ON VIEW public.vw_analise_cobrancas_duplicadas IS 'Mesma cobrança lançada mais de uma vez no mesmo dia, sem assinatura que explique a repetição.';
COMMENT ON VIEW public.vw_analise_categorizacao_mensal IS 'Por fatura e responsável: compras com categoria a revisar, sem categoria ou de baixa confiança.';
COMMENT ON VIEW public.vw_analise_faturas_cobertura IS 'Por mês do planejamento e cartão: valor pago na linha da fatura × compras importadas da fatura seguinte. pct_sem_detalhe alto = fatura paga sem as compras no app.';
