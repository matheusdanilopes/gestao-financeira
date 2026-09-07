-- Vínculo manual entre assinatura e lançamento da fatura.
--
-- Hoje a detecção "assinatura X caiu na fatura" é 100% automática: casa por
-- cartão + descrição contendo o nome da assinatura. Quando a compra errada é
-- capturada por esse casamento (ex.: "Google" pegando uma compra avulsa da
-- Google Play em vez do Google One), não havia como desfazer — só restava
-- esperar a cobrança certa cair para o valor voltar a bater.
--
-- Esta tabela guarda as correções manuais do usuário, por mês de fatura:
--   tipo = 'ignorado' → esta transação NÃO é essa assinatura (desvincular)
--   tipo = 'manual'   → esta transação É essa assinatura (vincular na mão,
--                       mesmo que a descrição não contenha o nome)
-- Sem nenhuma linha aqui, o comportamento continua sendo o automático.

CREATE TABLE IF NOT EXISTS assinaturas_vinculos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id  UUID NOT NULL REFERENCES assinaturas(id) ON DELETE CASCADE,
  transacao_id   UUID NOT NULL REFERENCES transacoes_nubank(id) ON DELETE CASCADE,
  projeto_fatura DATE NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('ignorado', 'manual')),
  criado_em      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (assinatura_id, transacao_id)
);

-- RLS no mesmo padrão de security_rls_fix.sql: só usuário autenticado.
ALTER TABLE assinaturas_vinculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_assinaturas_vinculos" ON assinaturas_vinculos;
CREATE POLICY "authenticated_assinaturas_vinculos" ON assinaturas_vinculos
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_assinaturas_vinculos_lookup
  ON assinaturas_vinculos(assinatura_id, projeto_fatura);

CREATE INDEX IF NOT EXISTS idx_assinaturas_vinculos_fatura
  ON assinaturas_vinculos(projeto_fatura);
