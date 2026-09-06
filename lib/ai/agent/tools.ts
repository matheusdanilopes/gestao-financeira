/**
 * Catálogo de ferramentas do agente financeiro.
 *
 * Cada ferramenta é declarada para o Gemini (function calling) e mapeada para
 * uma função do queryEngine, que opera em memória sobre o dataset já buscado e
 * validado nesta requisição. O modelo nunca recebe SQL, conexão ou credencial:
 * ele descreve *o que quer*, e a validação de cada argumento acontece aqui.
 *
 * Princípio de projeto: é melhor dar ao modelo poucas ferramentas amplas e bem
 * descritas do que muitas estreitas. A versão anterior deste chat montava o
 * contexto por regex de intenção e só liberava busca em mensagens de follow-up
 * — qualquer pergunta fora dos padrões previstos virava "não tenho esse dado".
 * Aqui o modelo enxerga TODO o espaço de consulta desde a primeira mensagem.
 */

import type { EnrichedData } from '../types'
import {
  consultarTransacoes,
  consultarPlanejamento,
  consultarReceitas,
  consultarAssinaturas,
  consultarInvestimentos,
  consultarEstornos,
  resumoMensal,
  compararPeriodos,
  projecaoFutura,
  listarDimensoes,
  type Referencias,
} from './queryEngine'

// ─── Schema (subconjunto do OpenAPI aceito pelo Gemini) ──────────────────────

type SchemaTipo = 'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY'

interface Schema {
  type: SchemaTipo
  description?: string
  enum?: string[]
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters: Schema
}

const str = (description: string, values?: string[]): Schema =>
  values ? { type: 'STRING', description, enum: values } : { type: 'STRING', description }

const num = (description: string): Schema => ({ type: 'NUMBER', description })
const bool = (description: string): Schema => ({ type: 'BOOLEAN', description })

// Um único vocabulário de mês em todas as ferramentas: o mês do seletor do app
// (a fatura que FECHA nesse mês + contas fixas + receitas do mesmo mês).
const MES = 'Mês no formato YYYY-MM, no vocabulário do app (a fatura que fecha nesse mês).'
const UM_MES = 'Para um mês só, mande mesInicio e mesFim iguais; só mesInicio significa "desse mês em diante".'

// Sem enum de responsável: existem mais valores que as duas pessoas (despesas
// conjuntas têm responsável próprio) e um enum fixo fazia o filtro ser
// descartado em silêncio, devolvendo o total de todo mundo.
const RESPONSAVEL = 'Nome exato do responsável, como aparece em listar_dimensoes (ex.: uma das pessoas, ou o rótulo usado para gastos conjuntos).'
const AGRUPAR = ['mes', 'categoria', 'responsavel', 'cartao', 'descricao']

// ─── Declarações ─────────────────────────────────────────────────────────────

export const FINANCIAL_TOOLS: FunctionDeclaration[] = [
  {
    name: 'listar_dimensoes',
    description:
      'Mostra o que existe no banco: período coberto, categorias realmente usadas, cartões, responsáveis e volumes. ' +
      'Use ANTES de concluir que um dado não existe, ou quando estiver em dúvida sobre qual valor exato usar em um filtro.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'consultar_transacoes',
    description:
      'Consulta compras no cartão de crédito (a principal fonte de gastos). Combina busca por texto na descrição do ' +
      'estabelecimento, categoria, responsável, cartão, faixa de valor e intervalo de meses. Retorna totais, ' +
      'agrupamentos (inclusive por cartão) e os maiores lançamentos — nunca a lista completa. ' +
      'Use para "quanto gastei com X", "compras no iFood", "maior compra do mês", "parcelamentos ativos". ' +
      'Quando houver mais de um cartão, cite de qual é o número que você usar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Texto procurado na descrição do estabelecimento (ex.: "ifood", "uber", "posto"). Ignora acentos e maiúsculas.'),
        categoria: str('Categoria financeira exata (ex.: Alimentação, Transporte). Use listar_dimensoes se não souber.'),
        responsavel: str(`Quem fez a compra. ${RESPONSAVEL}`),
        cartao: str('Cartão usado.', ['nubank', 'cartao1', 'cartao2']),
        mesInicio: str(`Primeiro mês do intervalo. ${MES} ${UM_MES}`),
        mesFim: str(`Último mês do intervalo. ${MES}`),
        valorMinimo: num('Considera apenas compras com valor maior ou igual a este.'),
        valorMaximo: num('Considera apenas compras com valor menor ou igual a este.'),
        apenasParceladas: bool('true = retorna somente compras parceladas.'),
        agruparPor: str('Dimensão extra de agrupamento no resultado.', AGRUPAR),
        limite: { type: 'INTEGER', description: 'Quantos lançamentos individuais listar (1 a 15).' },
      },
    },
  },
  {
    name: 'consultar_planejamento',
    description:
      'Consulta despesas fixas planejadas / contas do orçamento (aluguel, energia, internet, boletos). ' +
      'NÃO são compras de cartão. Permite filtrar por status de pagamento e vencimento. ' +
      'Use para "o que está em aberto", "tem conta vencida", "quanto orçei para o mês", "quanto pago de aluguel".',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Texto procurado no nome do item (ex.: "aluguel", "energia").'),
        categoria: str('Categoria financeira exata.'),
        responsavel: str(`Responsável pelo pagamento. ${RESPONSAVEL}`),
        mesInicio: str(`Primeiro mês do intervalo. ${MES} ${UM_MES}`),
        mesFim: str(`Último mês do intervalo. ${MES}`),
        status: str('Filtro de situação: pago, aberto (não pago), vencido (não pago e já passou do vencimento) ou todos.', ['todos', 'pago', 'aberto', 'vencido']),
        agruparPor: str('Dimensão extra de agrupamento.', AGRUPAR),
        limite: { type: 'INTEGER', description: 'Quantos itens individuais listar (1 a 15).' },
      },
    },
  },
  {
    name: 'consultar_receitas',
    description:
      'Consulta entradas de dinheiro (salário, freelance, bônus, reembolsos). ' +
      'Use para "quanto entrou este mês", "qual minha renda", "já recebi tudo".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês de referência. ${MES}`),
        mesFim: str(`Último mês de referência. ${MES}`),
        responsavel: str(`Quem recebe. ${RESPONSAVEL}`),
        status: str('Filtro de situação do recebimento.', ['todos', 'recebido', 'aberto']),
      },
    },
  },
  {
    name: 'consultar_assinaturas',
    description:
      'Consulta serviços de cobrança recorrente mensal (Netflix, Spotify, academia digital…). ' +
      'Use para "quanto pago de assinatura", "dá para cancelar alguma", "tem assinatura duplicada".',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Texto procurado no nome do serviço.'),
        status: str('Quais assinaturas incluir.', ['ativas', 'canceladas', 'todas']),
        categoria: str('Categoria da assinatura (ex.: Streaming, Música, Jogos, Tecnologia).'),
        responsavel: str(`Responsável pela assinatura. ${RESPONSAVEL}`),
        cartao: str('Cartão em que é cobrada.', ['nubank', 'cartao1', 'cartao2']),
      },
    },
  },
  {
    name: 'consultar_investimentos',
    description:
      'Consulta a carteira de investimentos e os aportes feitos. ' +
      'Use para "quanto já investi", "quando foi o último aporte", "qual ativo recebeu mais".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês dos aportes. ${MES}`),
        mesFim: str(`Último mês dos aportes. ${MES}`),
      },
    },
  },
  {
    name: 'resumo_mensal',
    description:
      'Fecha a conta de um ou mais meses do app: fatura de cartão (por cartão) + contas fixas + receitas + assinaturas, ' +
      'com sobra ou déficit — o mesmo recorte do Dashboard. É a ferramenta certa para "como fechou o mês", ' +
      '"quanto sobrou", "estou no azul".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês do recorte. ${MES} Se omitido, usa o mês corrente.`),
        mesFim: str(`Último mês do recorte. ${MES} Se omitido, usa o mesmo de mesInicio.`),
      },
    },
  },
  {
    name: 'comparar_periodos',
    description:
      'Compara gastos de cartão entre dois períodos e mostra o que mais variou, item a item da dimensão escolhida. ' +
      'Use para "gastei mais que mês passado?", "o que puxou a alta", "como está vs o trimestre anterior".',
    parameters: {
      type: 'OBJECT',
      properties: {
        periodoAInicio: str(`Início do período A (o mais recente). ${MES}`),
        periodoAFim: str(`Fim do período A. ${MES} Se omitido, igual ao início.`),
        periodoBInicio: str(`Início do período B (a base de comparação). ${MES} Se omitido, usa o mês anterior ao A.`),
        periodoBFim: str(`Fim do período B. ${MES} Se omitido, igual ao início.`),
        dimensao: str('Como quebrar a comparação.', ['categoria', 'responsavel', 'cartao', 'total']),
      },
    },
  },
  {
    name: 'projecao_futura',
    description:
      'Projeta os meses seguintes somando apenas compromissos já assumidos: parcelas em aberto, contas fixas ' +
      'recorrentes e assinaturas ativas. Use para "quanto vou pagar nos próximos meses", "consigo bancar X em dezembro", ' +
      '"quando as parcelas acabam".',
    parameters: {
      type: 'OBJECT',
      properties: {
        meses: { type: 'INTEGER', description: 'Quantos meses projetar à frente (1 a 12). Padrão: 6.' },
      },
    },
  },
  {
    name: 'consultar_estornos',
    description:
      'Lista compras estornadas/canceladas. Elas já saíram do total da fatura — use apenas para explicar por que uma ' +
      'compra sumiu ou por que a fatura ficou menor que o esperado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês de fatura. ${MES}`),
        mesFim: str(`Último mês de fatura. ${MES}`),
      },
    },
  },
]

export const NOMES_FERRAMENTAS = new Set(FINANCIAL_TOOLS.map(t => t.name))

// ─── Rótulos amigáveis (exibidos ao usuário durante a execução) ──────────────

const ROTULOS: Record<string, string> = {
  listar_dimensoes: 'Mapeando os dados disponíveis',
  consultar_transacoes: 'Consultando compras no cartão',
  consultar_planejamento: 'Consultando contas e orçamento',
  consultar_receitas: 'Consultando receitas',
  consultar_assinaturas: 'Consultando assinaturas',
  consultar_investimentos: 'Consultando investimentos',
  resumo_mensal: 'Fechando a conta do mês',
  comparar_periodos: 'Comparando períodos',
  projecao_futura: 'Projetando os próximos meses',
  consultar_estornos: 'Verificando estornos',
}

export function rotuloFerramenta(nome: string, args: Record<string, unknown> = {}): string {
  const base = ROTULOS[nome] ?? 'Consultando dados financeiros'
  const detalhes: string[] = []
  if (typeof args.busca === 'string' && args.busca.trim()) detalhes.push(`"${args.busca.trim().slice(0, 24)}"`)
  if (typeof args.categoria === 'string' && args.categoria.trim()) detalhes.push(args.categoria.trim().slice(0, 24))
  if (typeof args.responsavel === 'string' && args.responsavel.trim()) detalhes.push(args.responsavel.trim().slice(0, 16))
  return detalhes.length > 0 ? `${base} · ${detalhes.join(' · ')}` : base
}

// ─── Execução ────────────────────────────────────────────────────────────────

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/**
 * Despacha uma chamada de ferramenta. Devolve sempre uma string legível —
 * inclusive para nome desconhecido (alucinação) ou erro interno, para que o
 * loop do agente possa continuar em vez de abortar o turno.
 */
export function executarFerramenta(
  nome: string,
  args: Record<string, unknown>,
  data: EnrichedData,
  refs: Referencias
): string {
  try {
    switch (nome) {
      case 'listar_dimensoes':
        return listarDimensoes(data, refs)

      case 'consultar_transacoes':
        return consultarTransacoes(data, {
          busca: asString(args.busca),
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          valorMinimo: asNumber(args.valorMinimo),
          valorMaximo: asNumber(args.valorMaximo),
          apenasParceladas: asBool(args.apenasParceladas),
          agruparPor: asString(args.agruparPor) as never,
          limite: asNumber(args.limite),
        }, refs)

      case 'consultar_planejamento':
        return consultarPlanejamento(data, {
          busca: asString(args.busca),
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          status: asString(args.status) as never,
          agruparPor: asString(args.agruparPor) as never,
          limite: asNumber(args.limite),
        }, refs)

      case 'consultar_receitas':
        return consultarReceitas(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          responsavel: asString(args.responsavel),
          status: asString(args.status) as never,
        }, refs)

      case 'consultar_assinaturas':
        return consultarAssinaturas(data, {
          busca: asString(args.busca),
          status: asString(args.status) as never,
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
        })

      case 'consultar_investimentos':
        return consultarInvestimentos(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        }, refs)

      case 'resumo_mensal':
        return resumoMensal(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        }, refs)

      case 'comparar_periodos':
        return compararPeriodos(data, {
          periodoAInicio: asString(args.periodoAInicio),
          periodoAFim: asString(args.periodoAFim),
          periodoBInicio: asString(args.periodoBInicio),
          periodoBFim: asString(args.periodoBFim),
          dimensao: asString(args.dimensao) as never,
        }, refs)

      case 'projecao_futura':
        return projecaoFutura(data, { meses: asNumber(args.meses) }, refs)

      case 'consultar_estornos':
        return consultarEstornos(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        })

      default:
        return `Ferramenta "${nome}" não existe. Ferramentas disponíveis: ${[...NOMES_FERRAMENTAS].join(', ')}. Escolha uma delas.`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return `Falha ao executar "${nome}": ${msg}. Tente outra ferramenta ou outros filtros.`
  }
}
