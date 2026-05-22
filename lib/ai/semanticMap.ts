// Semantic description of the database structure for the AI to understand

export const SEMANTIC_DATABASE_MAP = `
ESTRUTURA DO BANCO DE DADOS — GESTÃO FINANCEIRA
================================================

TABELA: transacoes_nubank (Compras em Cartão de Crédito)
Descrição: Cada linha representa uma compra individual feita com cartão de crédito.
           É a principal fonte de gastos do sistema. As compras entram em faturas mensais.
Campos:
  - descricao: nome do estabelecimento/serviço (ex: "UBER*TRIP", "IFOOD*RESTAURANTE")
  - valor: valor em reais (sempre positivo)
  - data: data da compra
  - projeto_fatura: mês em que a compra aparece na fatura (formato YYYY-MM-01)
    ATENÇÃO: não é o mês da compra, mas o mês em que será cobrada
  - categoria: classificação financeira (Alimentação, Transporte, Saúde, etc.)
  - responsavel: "Matheus" ou "Jeniffer" — quem fez a compra
  - cartao: "nubank" | "cartao1" | "cartao2" — qual cartão foi usado
  - parcela_atual / total_parcelas: para compras parceladas
    Ex: parcela_atual=2, total_parcelas=6 = 2ª parcela de 6
Métrica principal: SUM(valor) GROUP BY projeto_fatura = gasto total da fatura do mês

TABELA: planejamento (Despesas Planejadas / Orçamento Mensal)
Descrição: Registro de contas e despesas previstas por mês. Serve como orçamento.
           Cada item representa uma conta ou gasto planejado.
Campos:
  - item: descrição (ex: "Aluguel", "Energia elétrica", "Parcela carro")
  - valor_previsto: valor estimado/previsto
  - mes_referencia: mês de referência (YYYY-MM-01)
  - responsavel: quem deve pagar (pode ser null = compartilhado)
  - data_vencimento: data de vencimento
  - data_pagamento: quando foi pago (NULL = ainda não pago / em aberto)
  - parcela_atual / total_parcelas: se for despesa parcelada
Métrica principal: SUM(valor_previsto) = total orçado
                   data_pagamento IS NULL = despesas ainda não pagas (em aberto)

TABELA: assinaturas (Serviços Recorrentes Mensais)
Descrição: Catálogo de serviços com cobrança mensal automática no cartão.
           Representa comprometimento financeiro fixo mensal. Ex: Netflix, Spotify.
Campos:
  - nome: nome do serviço
  - valor: mensalidade atual em reais
  - cartao: onde é cobrado
  - responsavel: "Matheus" | "Jeniffer" | "Compartilhado"
  - categoria: Streaming | Música | Software | Saúde | Educação | Jogos | Segurança | Outros
  - ativa: true = ativo (false = cancelado/suspenso)
  - dia_cobranca: dia do mês em que é cobrada
Métrica principal: SUM(valor) WHERE ativa = comprometimento fixo mensal total

TABELA: investimentos (Carteira de Investimentos)
Descrição: Posições de investimento registradas com rendimento percentual mensal.
Campos:
  - descricao: nome do investimento (ex: "Tesouro Direto IPCA+", "CDB 110% CDI")
  - percentual: rendimento percentual no mês de referência
  - mes_referencia: mês de referência

TABELA: investimentos_aportes (Aportes / Depósitos em Investimentos)
Descrição: Cada depósito/contribuição realizado em um investimento específico.
Campos:
  - investimento_id: FK para investimentos
  - valor: valor aportado em reais
  - data_aporte: data do aporte
  - observacao: nota opcional
Métrica principal: SUM(valor) = total histórico investido

TABELA: configuracoes (Configurações do Sistema)
Descrição: Parâmetros financeiros do usuário.
Campos relevantes:
  - dia_vencimento: dia do mês em que a fatura vence (padrão: 10)
  - ajuste_fechamento: dias de ajuste antes do fechamento
  - dia_vencimento_cartao1/cartao2: vencimento específico por cartão

TABELA: faturas (Datas de Fechamento de Faturas)
Descrição: Registra a data real de fechamento de cada fatura por cartão e mês.

RELAÇÕES ENTRE ENTIDADES:
- Uma fatura mensal (projeto_fatura) agrega múltiplas transacoes_nubank
- Um investimento pode ter múltiplos aportes (investimentos_aportes)
- Assinaturas aparecem como transações recorrentes em transacoes_nubank
- O planejamento é o orçamento que contrasta com os gastos reais (transacoes_nubank)
`
