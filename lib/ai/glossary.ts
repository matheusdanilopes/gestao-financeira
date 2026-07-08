// Financial domain glossary to prevent ambiguity in AI responses

export const FINANCIAL_GLOSSARY = `
GLOSSÁRIO FINANCEIRO DO SISTEMA
================================

COMPRA: Transação individual registrada em cartão de crédito → tabela transacoes_nubank
  → Inclui: supermercado, restaurante, apps como Uber/iFood, e-commerce, etc.
  → NÃO inclui: contas de água/luz (isso é DESPESA PLANEJADA)

PARCELA: Fração mensal de uma compra parcelada
  → Ex: iPhone R$ 6.000 em 12x = 12 parcelas de R$ 500 em meses consecutivos
  → Identificada por: parcela_atual e total_parcelas na tabela transacoes_nubank
  → NÃO confundir com assinatura (que é recorrente sem fim definido)

DESPESA PLANEJADA: Conta ou gasto previsto no orçamento → tabela planejamento
  → Exemplos: Aluguel, Energia elétrica, Internet, Condomínio, IPTU
  → Tem data de vencimento; pode ou não estar paga (data_pagamento)
  → NÃO é necessariamente paga via cartão (pode ser boleto, débito, etc.)

ASSINATURA: Serviço digital/físico com cobrança automática mensal → tabela assinaturas
  → Exemplos: Netflix, Spotify, Adobe CC, Plano de saúde, Academia
  → Diferente de DESPESA PLANEJADA: cadastrada uma vez, recorre automaticamente
  → Diferente de PARCELA: sem data de fim definida (recorre indefinidamente)

INVESTIMENTO: Capital aplicado com objetivo de crescimento patrimonial
  → Registrado em: investimentos (posição) + investimentos_aportes (depósitos)
  → Exemplos: Tesouro Direto, CDB, Ações, Fundos imobiliários

FATURA: Conjunto de compras de um cartão em determinado mês
  → Determinada pelo campo projeto_fatura (mês em que a compra é cobrada)
  → Pode diferir do mês da compra (devido à data de fechamento do cartão)
  → O valor de fatura já é líquido de estornos — nunca precisa subtrair estorno manualmente

RECEITA: Entrada de renda (salário, freelance, reembolso, etc.) → item "[RECEITA] *" em planejamento
  → Diferente de DESPESA PLANEJADA: não é um gasto, é dinheiro entrando
  → "pago"/"valor_real" indicam se e quanto já foi efetivamente recebido (não confundir com data_pagamento de despesas)
  → NUNCA some receitas ao total de gastos/despesas do mês

ESTORNO: Cancelamento/devolução de uma compra em cartão (status ESTORNO/ESTORNADO)
  → Já excluído do total da fatura — é informado apenas para explicar diferenças ao usuário
  → NÃO é uma nova despesa nem deve ser somado a nada

ORÇAMENTO: Total previsto para gastos do mês → SUM(planejamento.valor_previsto)
  → Comparado com o realizado (gastos em transacoes_nubank) para medir aderência

SALDO MENSAL: Receita do mês - Total de gastos do mês
TAXA DE POUPANÇA: (Receita - Gastos) / Receita × 100%
GASTO POR RESPONSÁVEL: Compras atribuídas a "Matheus" ou "Jeniffer"
FATURA COMPARTILHADA: Inclui gastos de ambos; individualmente é por responsavel
`
