-- ============================================================
-- Unificação de Categorias — Assinaturas ↔ Compras/Despesas/Receitas
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- SEGURANÇA:
--   • Não apaga dados existentes
--   • Não sobrescreve categorias com match ruim
--   • Operações idempotentes (seguro re-executar)
--
-- ORDEM DE EXECUÇÃO:
--   1. Passo 1 — Expande configuracoes.categorias_compras
--   2. Passo 2 — Migração por mapa legado (alta confiança)
--   3. Passo 3 — Migração por palavra-chave no nome (confiança ≥ 0.85)
--   4. Verificação final
-- ============================================================

-- ── PASSO 1: Expandir categorias_compras ─────────────────────────────────────
-- Adiciona as categorias específicas de assinaturas ao conjunto centralizado.
-- Idempotente: só adiciona categorias que ainda não existem na lista.

DO $$
DECLARE
  cats        JSONB;
  nova        TEXT;
  novas_cats  TEXT[] := ARRAY['Streaming', 'Música', 'Jogos', 'Segurança'];
BEGIN
  SELECT valor::jsonb INTO cats
  FROM configuracoes WHERE chave = 'categorias_compras';

  IF cats IS NULL THEN
    UPDATE configuracoes
    SET valor = '["Alimentação","Mercado","Transporte","Saúde","Lazer","Educação","Moradia","Vestuário","Tecnologia","Serviços","Viagem","Pet","Streaming","Música","Jogos","Segurança","Outros"]'
    WHERE chave = 'categorias_compras';
    RAISE NOTICE 'categorias_compras: recriada com conjunto unificado.';
    RETURN;
  END IF;

  FOREACH nova IN ARRAY novas_cats LOOP
    IF NOT cats @> to_jsonb(nova) THEN
      cats := cats || jsonb_build_array(nova);
      RAISE NOTICE 'categorias_compras: adicionada → %', nova;
    END IF;
  END LOOP;

  UPDATE configuracoes SET valor = cats::text WHERE chave = 'categorias_compras';
END;
$$;


-- ── PASSO 2: Migração por mapa legado ────────────────────────────────────────
-- 'Software' é a única categoria legada sem correspondência direta no conjunto
-- unificado. Mapeamento: Software → Tecnologia (confiança 0.90).
--
-- As demais (Streaming, Música, Jogos, Segurança, Saúde, Educação, Outros)
-- passam a existir no conjunto unificado após o Passo 1 — sem necessidade
-- de renomear registros existentes.

DO $$
DECLARE
  n_atualizadas INT;
BEGIN
  UPDATE assinaturas
  SET categoria = 'Tecnologia'
  WHERE categoria = 'Software';

  GET DIAGNOSTICS n_atualizadas = ROW_COUNT;
  RAISE NOTICE 'Software → Tecnologia: % assinatura(s) migrada(s).', n_atualizadas;
END;
$$;


-- ── PASSO 3: Migração por palavra-chave (opcional, revise antes) ─────────────
-- Atualiza assinaturas cujo nome contém termos conhecidos e categoria é 'Outros'.
-- Só executa quando categoria = 'Outros' para não sobrescrever categorizações
-- manuais existentes.

DO $$
DECLARE
  n INT;
BEGIN
  -- Streaming
  UPDATE assinaturas SET categoria = 'Streaming'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%netflix%' OR LOWER(nome) LIKE '%hbo%'
    OR LOWER(nome) LIKE '%disney%' OR LOWER(nome) LIKE '%prime video%'
    OR LOWER(nome) LIKE '%amazon prime%' OR LOWER(nome) LIKE '%apple tv%'
    OR LOWER(nome) LIKE '%youtube premium%' OR LOWER(nome) LIKE '%globoplay%'
    OR LOWER(nome) LIKE '%paramount%' OR LOWER(nome) LIKE '%star+%'
    OR LOWER(nome) LIKE '%crunchyroll%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Streaming (palavra-chave): % migrada(s).', n; END IF;

  -- Música
  UPDATE assinaturas SET categoria = 'Música'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%spotify%' OR LOWER(nome) LIKE '%deezer%'
    OR LOWER(nome) LIKE '%apple music%' OR LOWER(nome) LIKE '%youtube music%'
    OR LOWER(nome) LIKE '%tidal%' OR LOWER(nome) LIKE '%amazon music%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Música (palavra-chave): % migrada(s).', n; END IF;

  -- Transporte
  UPDATE assinaturas SET categoria = 'Transporte'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%uber%' OR LOWER(nome) LIKE '%cabify%' OR LOWER(nome) LIKE '%99%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Transporte (palavra-chave): % migrada(s).', n; END IF;

  -- Alimentação
  UPDATE assinaturas SET categoria = 'Alimentação'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%ifood%' OR LOWER(nome) LIKE '%rappi%'
    OR LOWER(nome) LIKE '%uber eats%' OR LOWER(nome) LIKE '%james%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Alimentação (palavra-chave): % migrada(s).', n; END IF;

  -- Educação
  UPDATE assinaturas SET categoria = 'Educação'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%duolingo%' OR LOWER(nome) LIKE '%coursera%'
    OR LOWER(nome) LIKE '%udemy%' OR LOWER(nome) LIKE '%alura%'
    OR LOWER(nome) LIKE '%rocketseat%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Educação (palavra-chave): % migrada(s).', n; END IF;

  -- Tecnologia
  UPDATE assinaturas SET categoria = 'Tecnologia'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%office%' OR LOWER(nome) LIKE '%microsoft%'
    OR LOWER(nome) LIKE '%adobe%' OR LOWER(nome) LIKE '%github%'
    OR LOWER(nome) LIKE '%notion%' OR LOWER(nome) LIKE '%figma%'
    OR LOWER(nome) LIKE '%dropbox%' OR LOWER(nome) LIKE '%google workspace%'
    OR LOWER(nome) LIKE '%slack%' OR LOWER(nome) LIKE '%zoom%'
    OR LOWER(nome) LIKE '%canva%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Tecnologia (palavra-chave): % migrada(s).', n; END IF;

  -- Segurança
  UPDATE assinaturas SET categoria = 'Segurança'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%vpn%' OR LOWER(nome) LIKE '%lastpass%'
    OR LOWER(nome) LIKE '%nordvpn%' OR LOWER(nome) LIKE '%expressvpn%'
    OR LOWER(nome) LIKE '%1password%' OR LOWER(nome) LIKE '%bitwarden%'
    OR LOWER(nome) LIKE '%norton%' OR LOWER(nome) LIKE '%avast%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Segurança (palavra-chave): % migrada(s).', n; END IF;

  -- Jogos
  UPDATE assinaturas SET categoria = 'Jogos'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%xbox%' OR LOWER(nome) LIKE '%playstation%'
    OR LOWER(nome) LIKE '%ps plus%' OR LOWER(nome) LIKE '%nintendo%'
    OR LOWER(nome) LIKE '%game pass%' OR LOWER(nome) LIKE '%ea play%'
    OR LOWER(nome) LIKE '%steam%' OR LOWER(nome) LIKE '%geforce%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Jogos (palavra-chave): % migrada(s).', n; END IF;

  -- Saúde
  UPDATE assinaturas SET categoria = 'Saúde'
  WHERE categoria = 'Outros' AND (
    LOWER(nome) LIKE '%academia%' OR LOWER(nome) LIKE '%gympass%'
    OR LOWER(nome) LIKE '%gym%' OR LOWER(nome) LIKE '%totalpass%'
    OR LOWER(nome) LIKE '%yoga%' OR LOWER(nome) LIKE '%headspace%'
    OR LOWER(nome) LIKE '%unimed%' OR LOWER(nome) LIKE '%hapvida%'
    OR LOWER(nome) LIKE '%amil%' OR LOWER(nome) LIKE '%plano saude%'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Saúde (palavra-chave): % migrada(s).', n; END IF;
END;
$$;


-- ── VERIFICAÇÃO FINAL ─────────────────────────────────────────────────────────
-- Mostra distribuição atual de categorias nas assinaturas.

SELECT
  categoria,
  COUNT(*) AS total,
  SUM(CASE WHEN ativa THEN 1 ELSE 0 END) AS ativas
FROM assinaturas
GROUP BY categoria
ORDER BY total DESC;

-- Mostra categorias disponíveis no conjunto centralizado.
SELECT valor FROM configuracoes WHERE chave = 'categorias_compras';
