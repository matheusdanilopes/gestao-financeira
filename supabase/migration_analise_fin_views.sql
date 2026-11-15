-- ============================================================================
-- Análise do Fin — camada de leitura no banco
--
-- Views que entregam à Análise do Fin (app/api/analise-comportamento) o que o
-- motor de métricas não consegue enxergar só com as tabelas cruas:
--
--   vw_analise_planejamento          chave estável das contas (sem "3/8", sem
--                                    "Prestação"), recebimentos e receita
--                                    recorrente × extraordinária
--   vw_analise_estornos              estorno ↔ compra original, estornos sem
--                                    par e estornos lançados em dobro
--   vw_analise_recorrencias          cobranças mensais no cartão × assinaturas
--                                    cadastradas (não cadastrada, preço
--                                    diferente, inativa e ainda cobrada)
--   vw_analise_cobrancas_duplicadas  mesma cobrança lançada mais de uma vez,
--                                    descontando assinaturas que explicam a
--                                    repetição (ex.: duas linhas de internet)
--   vw_analise_categorizacao_mensal  compras com categoria duvidosa por fatura
--   vw_analise_faturas_cobertura     fatura paga × compras importadas por cartão
--
-- Todas são `security_invoker`: valem as políticas de RLS de quem consulta.
-- Idempotente — pode rodar de novo.
-- ============================================================================

-- ── Funções auxiliares ──────────────────────────────────────────────────────

-- Texto em minúsculas, sem acentos e só com [a-z0-9] separados por um espaço.
CREATE OR REPLACE FUNCTION public.analise_normalizar(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Chave de uma linha do planejamento: o mesmo compromisso com o mesmo nome em
-- todos os meses. Tira o prefixo de cartão/receita, o "NuBank " legado, a
-- parcela ("3/8", "Parcela 3/5") e um "Prestação"/"Parcela" no começo.
--   'Imposto de Renda 4/8'        → 'imposto de renda'
--   'Formatura MV - Parcela 3/5'  → 'formatura mv'
--   'Prestação Giardini'          → 'giardini'
CREATE OR REPLACE FUNCTION public.analise_chave_conta(item text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(
    public.analise_normalizar(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(item, ''), '^\s*\[(PRINCIPAL|CARTAO1|CARTAO2|RECEITA)\]\s*', '', 'i'),
          '^\s*nubank\s+', '', 'i'),
        '(parcela\s*)?\d+\s*/\s*\d+', ' ', 'gi')),
    '^(prestacao|parcela)\s+', ''))
$$;

-- Chave de estabelecimento de uma compra: normalizada e sem números (códigos
-- de pedido, parcelas e filiais mudam a cada cobrança).
CREATE OR REPLACE FUNCTION public.analise_chave_estabelecimento(descricao text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(public.analise_normalizar(descricao), '\d+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Regex que casa o nome de uma assinatura dentro de uma chave de
-- estabelecimento: cada palavra do nome, na ordem, no começo de uma palavra
-- ('apple com bill' → '\mapple.*\mcom.*\mbill').
CREATE OR REPLACE FUNCTION public.analise_regex_assinatura(nome text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.analise_chave_estabelecimento(nome) = '' THEN NULL
    ELSE '\m' || replace(public.analise_chave_estabelecimento(nome), ' ', '.*\m')
  END
$$;

-- A assinatura estava ativa nesta data? Mesma regra de lib/assinaturaStatus.ts:
-- a última entrada do histórico vigente até a data; sem histórico, o estado atual.
CREATE OR REPLACE FUNCTION public.analise_assinatura_ativa_em(p_assinatura uuid, p_data date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT h.ativa
       FROM public.assinaturas_status_historico h
      WHERE h.assinatura_id = p_assinatura AND h.vigente_desde <= p_data
      ORDER BY h.vigente_desde DESC, h.criado_em DESC
      LIMIT 1),
    (SELECT a.ativa FROM public.assinaturas a WHERE a.id = p_assinatura))
$$;

-- ── vw_analise_planejamento ─────────────────────────────────────────────────
-- Uma linha por linha do planejamento.
--   tipo               receita | cartao (pagamento de fatura) | conta
--   chave              analise_chave_conta(item)
--   valor_recebido     soma de receitas_recebimentos da linha
--   receita_recorrente a "família" da receita (1ª palavra da chave: salario,
--                      ferias, dentista…) aparece em pelo menos 3 meses e em
--                      metade ou mais dos meses com receita lançada.
CREATE OR REPLACE VIEW public.vw_analise_planejamento
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    p.id,
    p.mes_referencia,
    p.item,
    p.responsavel,
    p.categoria,
    p.pago,
    CASE
      WHEN btrim(p.item) = 'Receita Total' OR btrim(p.item) LIKE '[RECEITA]%' THEN 'receita'
      WHEN btrim(p.item) ~* '^\[(PRINCIPAL|CARTAO1|CARTAO2)\]' OR btrim(p.item) ~* '^nubank\M' THEN 'cartao'
      ELSE 'conta'
    END AS tipo,
    public.analise_chave_conta(p.item) AS chave,
    coalesce(p.parcela_atual, (regexp_match(p.item, '(\d+)\s*/\s*(\d+)'))[1]::int) AS parcela_atual,
    coalesce(p.total_parcelas, (regexp_match(p.item, '(\d+)\s*/\s*(\d+)'))[2]::int) AS total_parcelas
  FROM public.planejamento p
),
recebimentos AS (
  SELECT
    r.planejamento_id,
    sum(r.valor) AS valor_recebido,
    count(*)::int AS recebimentos,
    max(r.data_recebimento) AS ultimo_recebimento
  FROM public.receitas_recebimentos r
  GROUP BY r.planejamento_id
),
receitas AS (
  SELECT split_part(b.chave, ' ', 1) AS familia, date_trunc('month', b.mes_referencia) AS mes
  FROM base b
  WHERE b.tipo = 'receita'
),
frequencia AS (
  SELECT
    familia,
    count(DISTINCT mes) AS meses,
    (SELECT count(DISTINCT mes) FROM receitas) AS meses_com_receita
  FROM receitas
  GROUP BY familia
)
SELECT
  b.id,
  b.mes_referencia,
  b.item,
  b.responsavel,
  b.categoria,
  b.pago,
  b.tipo,
  b.chave,
  b.parcela_atual,
  b.total_parcelas,
  coalesce(r.valor_recebido, 0) AS valor_recebido,
  coalesce(r.recebimentos, 0) AS recebimentos,
  r.ultimo_recebimento,
  CASE WHEN b.tipo = 'receita' THEN split_part(b.chave, ' ', 1) END AS familia_receita,
  CASE WHEN b.tipo = 'receita' THEN (f.meses >= 3 AND f.meses * 2 >= f.meses_com_receita) END AS receita_recorrente
FROM base b
LEFT JOIN recebimentos r ON r.planejamento_id = b.id
LEFT JOIN frequencia f ON b.tipo = 'receita' AND f.familia = split_part(b.chave, ' ', 1);

-- ── vw_analise_estornos ─────────────────────────────────────────────────────
-- Uma linha por estorno (status ESTORNO), com a compra que ele devolve: mesmo
-- valor, até 120 dias antes, com o nome do estorno na descrição.
--   situacao  pareado         compra original marcada como ESTORNADO
--             original_ativo  a compra devolvida ainda conta como gasto
--             sem_par         estorno parcial ou compra fora do banco
--             duplicado       o mesmo estorno lançado de novo
CREATE OR REPLACE VIEW public.vw_analise_estornos
WITH (security_invoker = true) AS
WITH e AS (
  SELECT
    t.id, t.descricao, t.valor, t.data, t.projeto_fatura, t.cartao, t.responsavel,
    public.analise_normalizar(coalesce(
      substring(t.descricao FROM '\(([^()]*)\)\s*$'),
      regexp_replace(t.descricao, '^\s*estorno( de compra)?\s*', '', 'i'))) AS alvo,
    row_number() OVER (
      PARTITION BY t.valor, t.data, coalesce(t.cartao, ''),
        public.analise_normalizar(coalesce(substring(t.descricao FROM '\(([^()]*)\)\s*$'), t.descricao))
      ORDER BY t.created_at, t.id) AS ordem
  FROM public.transacoes_nubank t
  WHERE t.status = 'ESTORNO'
)
SELECT
  e.id,
  e.descricao,
  e.valor,
  e.data,
  e.projeto_fatura,
  e.cartao,
  e.responsavel,
  o.id AS original_id,
  o.status AS original_status,
  o.projeto_fatura AS original_fatura,
  o.categoria AS original_categoria,
  o.descricao AS original_descricao,
  CASE
    WHEN e.ordem > 1 THEN 'duplicado'
    WHEN o.id IS NULL THEN 'sem_par'
    WHEN o.status = 'ESTORNADO' THEN 'pareado'
    ELSE 'original_ativo'
  END AS situacao
FROM e
LEFT JOIN LATERAL (
  SELECT t.id, t.status, t.projeto_fatura, t.categoria, t.descricao
  FROM public.transacoes_nubank t
  WHERE e.ordem = 1
    AND e.alvo <> ''
    AND coalesce(t.status, '') <> 'ESTORNO'
    AND abs(t.valor - e.valor) <= 0.01
    AND t.data BETWEEN e.data - 120 AND e.data
    AND public.analise_normalizar(t.descricao) LIKE '%' || replace(e.alvo, ' ', '%') || '%'
  ORDER BY (t.status = 'ESTORNADO') DESC, e.data - t.data, t.id
  LIMIT 1
) o ON true;

-- ── vw_analise_recorrencias ─────────────────────────────────────────────────
-- Cobranças à vista que se repetem todo mês nas faturas dos últimos 6 meses
-- (até a fatura aberta). Agrupa por estabelecimento e por faixa de valor de
-- ~10% (duas cobranças diferentes do mesmo lugar ficam separadas) e, dentro
-- dela, fica só com as cobranças a até 5% do valor mais recente (um reajuste
-- de 200 → 210 fica junto).
-- Critério de assinatura (e não de hábito, como Uber ou café): 3+ faturas, no
-- máximo 1,5 cobrança por fatura, sempre perto do mesmo dia do mês (desvio de
-- até 3,5 dias) e cobrada na fatura do mês passado ou depois.
--   situacao  cadastrada | preco_diferente | inativa_cobrada | nao_cadastrada
--   tipo      iof (imposto de compra internacional) | cobranca
CREATE OR REPLACE VIEW public.vw_analise_recorrencias
WITH (security_invoker = true) AS
WITH compras AS (
  SELECT
    t.id, t.descricao, t.valor, t.data, t.projeto_fatura, t.categoria, t.responsavel,
    coalesce(t.cartao, 'nubank') AS cartao,
    public.analise_chave_estabelecimento(t.descricao) AS chave,
    round(ln(t.valor::float8) / ln(1.1))::int AS faixa
  FROM public.transacoes_nubank t
  WHERE t.projeto_fatura >= (date_trunc('month', current_date) - interval '5 months')::date
    AND t.projeto_fatura <= (date_trunc('month', current_date) + interval '1 month')::date
    AND t.valor > 0
    AND coalesce(t.status, '') NOT IN ('ESTORNO', 'ESTORNADO')
    AND coalesce(t.total_parcelas, 1) <= 1
    AND t.descricao !~ '\d+\s*/\s*\d+'
),
com_ultimo AS (
  SELECT
    c.*,
    first_value(c.valor) OVER (PARTITION BY c.chave, c.faixa ORDER BY c.data DESC, c.id) AS ultimo
  FROM compras c
),
perto_do_ultimo AS (
  SELECT * FROM com_ultimo u
  WHERE abs(u.valor - u.ultimo) <= greatest(0.05, u.ultimo * 0.05)
),
grupos AS (
  SELECT
    c.chave,
    c.faixa,
    count(*)::int AS cobrancas,
    count(DISTINCT c.projeto_fatura)::int AS faturas,
    round(avg(c.valor), 2) AS valor_medio,
    (array_agg(c.valor ORDER BY c.data DESC, c.id))[1] AS valor_ultimo,
    (array_agg(c.descricao ORDER BY c.data DESC, c.id))[1] AS descricao,
    max(c.data) AS ultima_data,
    min(c.projeto_fatura) AS primeira_fatura,
    max(c.projeto_fatura) AS ultima_fatura,
    mode() WITHIN GROUP (ORDER BY c.categoria) AS categoria,
    count(DISTINCT c.categoria)::int AS categorias_usadas,
    string_agg(DISTINCT c.categoria, ', ' ORDER BY c.categoria) AS lista_categorias,
    mode() WITHIN GROUP (ORDER BY c.responsavel) AS responsavel,
    mode() WITHIN GROUP (ORDER BY c.cartao) AS cartao,
    round(stddev_pop(extract(day FROM c.data))::numeric, 1) AS desvio_dia
  FROM perto_do_ultimo c
  WHERE c.chave <> ''
  GROUP BY c.chave, c.faixa
)
SELECT
  g.chave,
  g.descricao,
  CASE WHEN g.chave ~ '^iof\M' THEN 'iof' ELSE 'cobranca' END AS tipo,
  g.cobrancas,
  g.faturas,
  g.valor_medio,
  g.valor_ultimo,
  g.ultima_data,
  g.primeira_fatura,
  g.ultima_fatura,
  g.categoria,
  g.categorias_usadas,
  g.lista_categorias,
  g.responsavel,
  g.cartao,
  a.id AS assinatura_id,
  a.nome AS assinatura_nome,
  a.valor AS assinatura_valor,
  CASE
    WHEN a.id IS NULL THEN 'nao_cadastrada'
    WHEN NOT public.analise_assinatura_ativa_em(a.id, g.ultima_data) THEN 'inativa_cobrada'
    WHEN abs(g.valor_ultimo - a.valor) > greatest(0.05, a.valor * 0.02) THEN 'preco_diferente'
    ELSE 'cadastrada'
  END AS situacao,
  g.desvio_dia
FROM grupos g
LEFT JOIN LATERAL (
  SELECT a.id, a.nome, a.valor, a.ativa
  FROM public.assinaturas a
  WHERE g.chave !~ '^iof\M'
    AND public.analise_regex_assinatura(a.nome) IS NOT NULL
    AND g.chave ~ public.analise_regex_assinatura(a.nome)
    AND abs(g.valor_ultimo - a.valor) <= a.valor * 0.2
  ORDER BY a.ativa DESC, abs(g.valor_ultimo - a.valor), a.id
  LIMIT 1
) a ON true
WHERE g.faturas >= 3
  AND g.cobrancas <= g.faturas * 1.5
  AND g.desvio_dia <= 3.5
  AND g.ultima_fatura >= (date_trunc('month', current_date) - interval '1 month')::date;

-- ── vw_analise_cobrancas_duplicadas ─────────────────────────────────────────
-- Mesma descrição, valor, data, fatura, cartão e parcela lançados mais de uma
-- vez (R$ 20 ou mais, últimos 6 meses). Assinaturas ativas que casam com a
-- cobrança explicam repetições legítimas e são descontadas.
CREATE OR REPLACE VIEW public.vw_analise_cobrancas_duplicadas
WITH (security_invoker = true) AS
WITH repetidas AS (
  SELECT
    t.descricao,
    t.valor,
    t.data,
    t.projeto_fatura,
    coalesce(t.cartao, 'nubank') AS cartao,
    t.parcela_atual,
    count(*)::int AS vezes,
    array_agg(t.id ORDER BY t.id) AS ids,
    mode() WITHIN GROUP (ORDER BY t.categoria) AS categoria,
    mode() WITHIN GROUP (ORDER BY t.responsavel) AS responsavel
  FROM public.transacoes_nubank t
  WHERE t.projeto_fatura >= (date_trunc('month', current_date) - interval '5 months')::date
    AND t.valor >= 20
    AND coalesce(t.status, '') NOT IN ('ESTORNO', 'ESTORNADO')
  GROUP BY t.descricao, t.valor, t.data, t.projeto_fatura, coalesce(t.cartao, 'nubank'), t.parcela_atual
  HAVING count(*) > 1
)
SELECT
  r.descricao,
  r.valor,
  r.data,
  r.projeto_fatura,
  r.cartao,
  r.parcela_atual,
  r.vezes,
  r.ids,
  r.categoria,
  r.responsavel,
  coalesce(s.assinaturas, 0) AS assinaturas_correspondentes,
  r.vezes - greatest(coalesce(s.assinaturas, 0), 1) AS cobrancas_a_mais,
  (r.vezes - greatest(coalesce(s.assinaturas, 0), 1)) * r.valor AS valor_a_mais
FROM repetidas r
LEFT JOIN LATERAL (
  SELECT count(*)::int AS assinaturas
  FROM public.assinaturas a
  WHERE public.analise_regex_assinatura(a.nome) IS NOT NULL
    AND public.analise_chave_estabelecimento(r.descricao) ~ public.analise_regex_assinatura(a.nome)
    AND abs(r.valor - a.valor) <= a.valor * 0.2
    AND public.analise_assinatura_ativa_em(a.id, r.data)
) s ON true
WHERE r.vezes > greatest(coalesce(s.assinaturas, 0), 1);

-- ── vw_analise_categorizacao_mensal ─────────────────────────────────────────
-- Por fatura e responsável: quantas compras têm categoria duvidosa.
CREATE OR REPLACE VIEW public.vw_analise_categorizacao_mensal
WITH (security_invoker = true) AS
SELECT
  t.projeto_fatura AS mes,
  coalesce(t.responsavel, '') AS responsavel,
  count(*)::int AS compras,
  sum(t.valor) AS valor,
  count(*) FILTER (WHERE t.classificacao_status = 'revisao_pendente')::int AS revisao_pendente,
  coalesce(sum(t.valor) FILTER (WHERE t.classificacao_status = 'revisao_pendente'), 0) AS revisao_pendente_valor,
  count(*) FILTER (WHERE nullif(btrim(t.categoria), '') IS NULL)::int AS sem_categoria,
  coalesce(sum(t.valor) FILTER (WHERE nullif(btrim(t.categoria), '') IS NULL), 0) AS sem_categoria_valor,
  count(*) FILTER (WHERE t.categoria_confianca < 0.7)::int AS baixa_confianca,
  coalesce(sum(t.valor) FILTER (WHERE t.categoria_confianca < 0.7), 0) AS baixa_confianca_valor
FROM public.transacoes_nubank t
WHERE t.valor > 0
  AND coalesce(t.status, '') NOT IN ('ESTORNO', 'ESTORNADO')
GROUP BY t.projeto_fatura, coalesce(t.responsavel, '');

-- ── vw_analise_faturas_cobertura ────────────────────────────────────────────
-- Por mês e cartão: o que foi pago na linha da fatura (planejamento) × o que
-- foi importado em compras. pct_sem_detalhe = parte do pago sem compras
-- importadas (sem categoria, lugar ou data para a análise).
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
    t.projeto_fatura AS mes,
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

-- ── Acesso ──────────────────────────────────────────────────────────────────
REVOKE ALL ON public.vw_analise_planejamento,
              public.vw_analise_estornos,
              public.vw_analise_recorrencias,
              public.vw_analise_cobrancas_duplicadas,
              public.vw_analise_categorizacao_mensal,
              public.vw_analise_faturas_cobertura
  FROM anon;
GRANT SELECT ON public.vw_analise_planejamento,
                public.vw_analise_estornos,
                public.vw_analise_recorrencias,
                public.vw_analise_cobrancas_duplicadas,
                public.vw_analise_categorizacao_mensal,
                public.vw_analise_faturas_cobertura
  TO authenticated, service_role;
