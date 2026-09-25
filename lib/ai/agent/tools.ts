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
  projetarParcelamentos,
  simularCompra,
  consultarListas,
  calcular,
  listarDimensoes,
  FiltroInvalido,
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
      'Use para "quanto gastei com X", "compras no iFood", "maior compra do mês", "parcelamentos na fatura de agosto". ' +
      'Só enxerga faturas já importadas: para meses futuros ou evolução de parcelas, use projetar_parcelamentos. ' +
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
        agruparPor: str('Dimensão extra de agrupamento no resultado ("descricao" agrupa por loja, juntando variações do nome).', AGRUPAR),
        limite: { type: 'INTEGER', description: 'Quantos lançamentos individuais listar por página (1 a 15).' },
        ordenarPor: str('Ordem da lista de lançamentos: maiores valores (padrão) ou mais recentes.', ['valor', 'data']),
        pagina: { type: 'INTEGER', description: 'Página da lista de lançamentos (1, 2, 3…), quando o resultado disser LISTA PARCIAL.' },
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
        status: str('Situação: recebido (inteiro), parcial (recebido em parte), aberto (falta receber algo, inclui parciais) ou todos.', ['todos', 'recebido', 'parcial', 'aberto']),
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
        status: str('Quais assinaturas incluir. "pausadas" = desativadas temporariamente, voltam a cobrar numa data.', ['ativas', 'pausadas', 'canceladas', 'todas']),
        categoria: str('Categoria da assinatura (ex.: Streaming, Música, Jogos, Tecnologia).'),
        responsavel: str(`Responsável pela assinatura. ${RESPONSAVEL}`),
        cartao: str('Cartão em que é cobrada.', ['nubank', 'cartao1', 'cartao2']),
      },
    },
  },
  {
    name: 'consultar_investimentos',
    description:
      'Consulta a carteira de investimentos: aportes feitos e o último saldo informado pelo usuário em cada investimento. ' +
      'Use para "quanto já investi", "quanto tenho investido", "quando foi o último aporte", "qual ativo recebeu mais".',
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
      'Compara gastos entre dois períodos e mostra o que mais variou, item a item da dimensão escolhida. Aceita filtro por ' +
      'pessoa, categoria, cartão e loja. Por padrão só cartão; incluirContasFixas=true soma as contas fixas (a base do ' +
      '"total do mês"). Com o mês corrente em formação, use mesmoPonto=true para comparar até o mesmo dia do mês anterior. ' +
      'Use para "gastei mais que mês passado?", "o que puxou a alta", "a Jeniffer gastou mais com mercado?".',
    parameters: {
      type: 'OBJECT',
      properties: {
        periodoAInicio: str(`Início do período A (o mais recente). ${MES}`),
        periodoAFim: str(`Fim do período A. ${MES} Se omitido, igual ao início.`),
        periodoBInicio: str(`Início do período B (a base de comparação). ${MES} Se omitido, usa o mês anterior ao A.`),
        periodoBFim: str(`Fim do período B. ${MES} Se omitido, igual ao início.`),
        dimensao: str('Como quebrar a comparação.', ['categoria', 'responsavel', 'cartao', 'descricao', 'total']),
        responsavel: str(`Só compras desta pessoa. ${RESPONSAVEL}`),
        categoria: str('Só esta categoria.'),
        cartao: str('Só este cartão.', ['nubank', 'cartao1', 'cartao2']),
        busca: str('Só compras cuja descrição contém este texto (ex.: "ifood").'),
        incluirContasFixas: bool('true = soma também as contas fixas do planejamento nos dois períodos.'),
        mesmoPonto: bool('true = no período de comparação, só entram compras feitas até o dia equivalente a hoje (comparação justa com o mês em formação).'),
      },
    },
  },
  {
    name: 'projecao_futura',
    description:
      'Projeta os próximos meses: fatura real onde já foi importada; depois, parcelas em aberto + contas fixas (as já ' +
      'cadastradas, ou a média recente) + assinaturas. Traz também um "cenário provável" com o gasto à vista típico, e ' +
      'os limites de parcelamento. Use para "quanto vou pagar nos próximos meses", "como fica dezembro", "sobra dinheiro em janeiro".',
    parameters: {
      type: 'OBJECT',
      properties: {
        meses: { type: 'INTEGER', description: 'Quantos meses projetar à frente (1 a 12). Padrão: 6.' },
      },
    },
  },
  {
    name: 'projetar_parcelamentos',
    description:
      'Evolução das compras parceladas mês a mês — por pessoa, por cartão ou por estabelecimento. Nos meses com fatura ' +
      'já importada usa o valor lançado; depois da última fatura importada, PROJETA avançando cada parcela (3/10 → 4/10…). ' +
      'Mostra o total de cada mês, quanto reduz de um mês para o outro, quais compras pagam a última parcela em cada mês ' +
      'e a lista compra a compra com o mês de término. É a ferramenta certa para "quanto reduz mês a mês", ' +
      '"quando acabam as parcelas do X", "quanto vou pagar de parcela em dezembro", "quanto ainda devo de parcelamento". ' +
      'consultar_transacoes NÃO serve para meses futuros: ele só vê faturas já importadas e devolveria zero.',
    parameters: {
      type: 'OBJECT',
      properties: {
        responsavel: str(`Dono das compras parceladas. ${RESPONSAVEL}`),
        cartao: str('Cartão.', ['nubank', 'cartao1', 'cartao2']),
        busca: str('Texto na descrição da compra, para acompanhar um parcelamento específico.'),
        mesInicio: str(`Primeiro mês da série. ${MES} Padrão: mês corrente.`),
        meses: { type: 'INTEGER', description: 'Quantos meses mostrar a partir de mesInicio (1 a 24). Padrão: 6.' },
        incluirContas: bool('Inclui as contas parceladas do planejamento (padrão: true, como a tela de Parcelamentos). false = só cartões. Ignorado quando há filtro de cartão.'),
      },
    },
  },
  {
    name: 'simular_compra',
    description:
      'Simula uma compra nova ("e se eu comprar X em N vezes?"): soma a parcela aos parcelamentos da pessoa e aos ' +
      'compromissos do casal em cada mês e compara com o limite de parcelamento. Use para "cabe um celular de 3 mil em 10x?", ' +
      '"se eu parcelar a viagem em 6x, como fica?", "estouro o limite se comprar isso?".',
    parameters: {
      type: 'OBJECT',
      properties: {
        valorTotal: num('Valor total da compra.'),
        valorParcela: num('Valor de cada parcela (alternativa ao valorTotal).'),
        parcelas: { type: 'INTEGER', description: 'Número de parcelas (1 = à vista).' },
        responsavel: str(`Quem faria a compra. ${RESPONSAVEL}`),
        cartao: str('Cartão em que seria feita.', ['nubank', 'cartao1', 'cartao2']),
        mesPrimeiraParcela: str(`Mês da 1ª parcela. ${MES} Padrão: mês corrente (compra feita hoje).`),
        descricao: str('Nome da compra, só para o texto.'),
      },
    },
  },
  {
    name: 'consultar_listas',
    description:
      'Consulta a lista de desejos (itens que o casal quer comprar, com valor estimado e prioridade), a lista de mercado ' +
      'e as listas de compras. Use para "quanto custa a lista de desejos", "o que falta comprar no mercado", ' +
      '"dá para comprar o item X da lista de desejos este mês".',
    parameters: {
      type: 'OBJECT',
      properties: {
        tipo: str('Qual lista.', ['desejos', 'mercado', 'compras', 'todas']),
        busca: str('Texto no nome do item.'),
      },
    },
  },
  {
    name: 'calcular',
    description:
      'Calculadora exata. Use SEMPRE que precisar somar, subtrair, dividir, tirar média ou percentual de valores que não ' +
      'vieram prontos de uma consulta — nunca faça conta de cabeça. Aceita + - * / ^, parênteses e %.',
    parameters: {
      type: 'OBJECT',
      properties: {
        expressoes: {
          type: 'ARRAY',
          description: 'Expressões no formato "rótulo: expressão", ex.: "redução: 2261.60 - 2180.17", "variação %: (2180.17 - 2261.60) / 2261.60 * 100". Use ponto como separador decimal.',
          items: { type: 'STRING' },
        },
      },
      required: ['expressoes'],
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
  projetar_parcelamentos: 'Projetando parcelamentos',
  simular_compra: 'Simulando a compra',
  consultar_listas: 'Consultando as listas',
  calcular: 'Calculando',
  consultar_estornos: 'Verificando estornos',
}

export function rotuloFerramenta(nome: string, args: Record<string, unknown> = {}): string {
  const base = ROTULOS[nome] ?? 'Consultando dados financeiros'
  const detalhes: string[] = []
  if (typeof args.busca === 'string' && args.busca.trim()) detalhes.push(`"${args.busca.trim().slice(0, 24)}"`)
  if (typeof args.categoria === 'string' && args.categoria.trim()) detalhes.push(args.categoria.trim().slice(0, 24))
  if (typeof args.responsavel === 'string' && args.responsavel.trim()) detalhes.push(args.responsavel.trim().slice(0, 16))
  if (typeof args.cartao === 'string' && args.cartao.trim()) detalhes.push(args.cartao.trim().slice(0, 16))
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
          ordenarPor: asString(args.ordenarPor) as never,
          pagina: asNumber(args.pagina),
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
          responsavel: asString(args.responsavel),
          categoria: asString(args.categoria),
          cartao: asString(args.cartao),
          busca: asString(args.busca),
          incluirContasFixas: asBool(args.incluirContasFixas),
          mesmoPonto: asBool(args.mesmoPonto),
        }, refs)

      case 'projecao_futura':
        return projecaoFutura(data, { meses: asNumber(args.meses) }, refs)

      case 'projetar_parcelamentos':
        return projetarParcelamentos(data, {
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
          busca: asString(args.busca),
          mesInicio: asString(args.mesInicio),
          meses: asNumber(args.meses),
          incluirContas: asBool(args.incluirContas),
        }, refs)

      case 'simular_compra':
        return simularCompra(data, {
          valorTotal: asNumber(args.valorTotal),
          valorParcela: asNumber(args.valorParcela),
          parcelas: asNumber(args.parcelas),
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
          mesPrimeiraParcela: asString(args.mesPrimeiraParcela),
          descricao: asString(args.descricao),
        }, refs)

      case 'consultar_listas':
        return consultarListas(data, { tipo: asString(args.tipo), busca: asString(args.busca) })

      case 'calcular':
        return calcular({ expressoes: args.expressoes })

      case 'consultar_estornos':
        return consultarEstornos(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        })

      default:
        return `Ferramenta "${nome}" não existe. Ferramentas disponíveis: ${[...NOMES_FERRAMENTAS].join(', ')}. Escolha uma delas.`
    }
  } catch (err) {
    // Filtro que não casa com nada: a mensagem já diz os valores válidos, e o
    // modelo deve refazer a chamada — não responder com um total sem filtro.
    if (err instanceof FiltroInvalido) return `FILTRO INVÁLIDO em "${nome}": ${err.message}`
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return `Falha ao executar "${nome}": ${msg}. Tente outra ferramenta ou outros filtros.`
  }
}
