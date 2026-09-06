/**
 * Pacote de dados para IA: extrai o conteúdo do app em um documento que outra
 * IA (ChatGPT, Claude, Gemini…) consegue ler e analisar sem contexto extra.
 *
 * Três decisões guiam este relatório:
 *
 * 1. **Dicionário junto dos dados.** A primeira seção explica as convenções da
 *    base (mês de fatura, estornos, prefixos de item, previsto x realizado).
 *    Sem isso o modelo inventa a interpretação — e erra em silêncio.
 * 2. **Modo resumido por padrão.** Doze meses de compras linha a linha estouram
 *    a janela de contexto de qualquer modelo. O modo resumido agrega por mês e
 *    categoria; o detalhado só é usado quando o usuário quer o dado cru.
 * 3. **Nada de dado sensível.** Só saem lançamentos financeiros já digitados
 *    pelo usuário — sem e-mail, sem login, sem número de cartão.
 */
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { buscarPaginado } from './supabasePaginado'
import { ehDespesaReal, ehLinhaDeReceita, removerPrefixoCartao } from './tipoCartao'
import { formatarData, formatarMes } from './relatoriosFormat'
import type { DocumentoRelatorio, SecaoDocumento } from './relatorioDocumento'
import { documentoParaMarkdown } from './relatorioDocumento'

const RECEITA_PREFIXO = '[RECEITA] '

export const JANELAS_DADOS = [1, 3, 6, 12] as const
export type JanelaDados = typeof JANELAS_DADOS[number]

export type ConjuntoDados =
  | 'resumo'
  | 'despesas'
  | 'receitas'
  | 'compras'
  | 'categorias'
  | 'assinaturas'
  | 'investimentos'

export type NivelDetalhe = 'resumido' | 'detalhado'

export const CONJUNTOS: { chave: ConjuntoDados; label: string; descricao: string }[] = [
  { chave: 'resumo', label: 'Resumo mensal', descricao: 'Receita, despesa, saldo, cartão e aportes de cada mês' },
  { chave: 'despesas', label: 'Despesas', descricao: 'Contas do planejamento: previsto, pago e status' },
  { chave: 'receitas', label: 'Receitas', descricao: 'Entradas previstas e recebidas por mês' },
  { chave: 'compras', label: 'Compras no cartão', descricao: 'Lançamentos da fatura, com categoria e responsável' },
  { chave: 'categorias', label: 'Matriz de categorias', descricao: 'Categoria × mês — a base para análise de tendência' },
  { chave: 'assinaturas', label: 'Assinaturas', descricao: 'Custo recorrente ativo e pausado' },
  { chave: 'investimentos', label: 'Investimentos', descricao: 'Metas do mês e aportes realizados' },
]

const DICIONARIO: [string, string][] = [
  ['Moeda', 'Todos os valores estão em reais (BRL). O separador decimal do texto é a vírgula.'],
  ['Mês de referência', 'Um lançamento pertence ao mês do planejamento (mes_referencia), sempre o primeiro dia do mês.'],
  ['Mês da fatura', 'Compras no cartão são agrupadas pelo mês da fatura em que caíram, não pela data da compra — por isso uma compra de 28/03 pode aparecer na fatura de abril.'],
  ['Previsto x Realizado', '"Previsto" é o valor planejado; "pago"/"recebido" é o valor efetivo. Um lançamento não pago não tem valor realizado — não o trate como zero ao calcular médias.'],
  ['Estornos', 'Compras estornadas já foram removidas: os totais não as incluem.'],
  ['Dupla contagem', 'O pagamento da fatura do cartão aparece como despesa no planejamento e as compras aparecem individualmente. Somar despesas + compras conta o mesmo dinheiro duas vezes.'],
  ['Responsável', 'Cada lançamento é de "Matheus", "Jeniffer" ou compartilhado (conjunto).'],
  ['Assinaturas', 'São cobranças mensais recorrentes; o custo anual é o valor mensal × 12, sem projetar reajustes.'],
]

export interface RelatorioDadosIA {
  meses: Date[]
  janela: JanelaDados
  nivel: NivelDetalhe
  conjuntos: ConjuntoDados[]
  secoes: SecaoDocumento[]
  erros: string[]
}

type PlanejamentoRow = {
  item: string
  categoria: string | null
  responsavel: string | null
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
  data_vencimento: string | null
  mes_referencia: string
}

type TransacaoRow = {
  data: string | null
  data_compra: string | null
  descricao: string
  categoria: string | null
  responsavel: string | null
  cartao: string | null
  valor: number
  projeto_fatura: string
}

type AssinaturaRow = {
  nome: string
  valor: number
  categoria: string | null
  responsavel: string | null
  cartao: string | null
  dia_cobranca: number | null
  ativa: boolean
}

function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split('-')
  return formatarMes(new Date(Number(ano), Number(mes) - 1, 1))
}

function agregar<T>(
  linhas: T[],
  chave: (l: T) => string,
  valor: (l: T) => number,
): { chave: string; total: number; quantidade: number }[] {
  const mapa = new Map<string, { chave: string; total: number; quantidade: number }>()
  for (const linha of linhas) {
    const k = chave(linha)
    const atual = mapa.get(k) ?? { chave: k, total: 0, quantidade: 0 }
    atual.total += valor(linha)
    atual.quantidade += 1
    mapa.set(k, atual)
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total)
}

export async function buscarDadosIA(
  janela: JanelaDados,
  conjuntos: ConjuntoDados[],
  nivel: NivelDetalhe,
  hoje: Date = new Date(),
): Promise<RelatorioDadosIA> {
  const erros: string[] = []
  const meses = Array.from({ length: janela }, (_, i) => startOfMonth(subMonths(hoje, janela - 1 - i)))
  const mesesStr = meses.map(m => format(m, 'yyyy-MM-dd'))
  const fimJanela = format(endOfMonth(meses[meses.length - 1]), 'yyyy-MM-dd')

  const precisaPlanejamento = conjuntos.some(c =>
    c === 'resumo' || c === 'despesas' || c === 'receitas' || c === 'categorias')
  const precisaTransacoes = conjuntos.some(c =>
    c === 'resumo' || c === 'compras' || c === 'categorias')

  const [planRes, transRes, assinaturasRes, investimentosRes, aportesRes] = await Promise.all([
    precisaPlanejamento
      ? buscarPaginado<PlanejamentoRow>((de, ate) =>
          supabase
            .from('planejamento')
            .select('item, categoria, responsavel, valor_previsto, valor_real, pago, data_vencimento, mes_referencia')
            .in('mes_referencia', mesesStr)
            .range(de, ate),
        )
      : Promise.resolve({ data: [] as PlanejamentoRow[], error: null, truncado: false }),
    precisaTransacoes
      ? buscarPaginado<TransacaoRow>((de, ate) =>
          supabase
            .from('transacoes_nubank')
            .select('data, data_compra, descricao, categoria, responsavel, cartao, valor, projeto_fatura')
            .in('projeto_fatura', mesesStr)
            .neq('status', 'ESTORNO')
            .neq('status', 'ESTORNADO')
            .range(de, ate),
        )
      : Promise.resolve({ data: [] as TransacaoRow[], error: null, truncado: false }),
    conjuntos.includes('assinaturas')
      ? supabase
          .from('assinaturas')
          .select('nome, valor, categoria, responsavel, cartao, dia_cobranca, ativa')
          .order('valor', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    conjuntos.includes('investimentos')
      ? supabase.from('investimentos').select('id, descricao, percentual, mes_referencia').in('mes_referencia', mesesStr)
      : Promise.resolve({ data: [], error: null }),
    conjuntos.includes('investimentos') || conjuntos.includes('resumo')
      ? supabase
          .from('investimentos_aportes')
          .select('investimento_id, valor, data_aporte')
          .gte('data_aporte', mesesStr[0])
          .lte('data_aporte', fimJanela)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (planRes.error) erros.push('Não foi possível carregar receitas e despesas do período.')
  if (transRes.error) erros.push('Não foi possível carregar as compras do cartão.')
  if (assinaturasRes.error) erros.push('Não foi possível carregar as assinaturas.')
  if (investimentosRes.error || aportesRes.error) erros.push('Não foi possível carregar os investimentos.')
  if (planRes.truncado || transRes.truncado) {
    erros.push('O período tem lançamentos demais: o pacote traz apenas os primeiros 20 mil de cada base. Use uma janela menor.')
  }

  const planejamento = planRes.data ?? []
  const transacoes = transRes.data ?? []
  const assinaturas = (assinaturasRes.data ?? []) as AssinaturaRow[]
  const investimentos = (investimentosRes.data ?? []) as { id: string; descricao: string; percentual: number; mes_referencia: string }[]
  const aportes = (aportesRes.data ?? []) as { investimento_id: string; valor: number; data_aporte: string }[]

  const receitas = planejamento.filter(p => p.item.startsWith(RECEITA_PREFIXO))
  const despesas = planejamento.filter(p => !ehLinhaDeReceita(p.item))

  const secoes: SecaoDocumento[] = [
    {
      titulo: 'Dicionário de dados',
      explicacao: 'Convenções da base. Leia antes de interpretar os números.',
      colunas: ['Conceito', 'O que significa'],
      linhas: DICIONARIO.map(([conceito, texto]) => [conceito, texto]),
    },
  ]

  if (conjuntos.includes('resumo')) {
    secoes.push({
      titulo: 'Resumo mensal',
      explicacao: 'Um registro por mês, com o que entrou, o que saiu e o que sobrou.',
      colunas: ['Mês', 'Receita prevista', 'Receita recebida', 'Despesa prevista', 'Despesa paga', 'Saldo', 'Compras no cartão', 'Aportes'],
      linhas: mesesStr.map(mesIso => {
        const recMes = receitas.filter(r => r.mes_referencia === mesIso)
        const despMes = despesas.filter(d => d.mes_referencia === mesIso)
        const recebido = recMes.reduce((a, r) => a + (r.pago ? (r.valor_real ?? r.valor_previsto ?? 0) : 0), 0)
        const pago = despMes.reduce((a, d) => a + (d.pago ? (d.valor_real ?? d.valor_previsto ?? 0) : 0), 0)
        const compras = transacoes.filter(t => t.projeto_fatura === mesIso).reduce((a, t) => a + Number(t.valor ?? 0), 0)
        const aportadoMes = aportes
          .filter(a => a.data_aporte.substring(0, 7) === mesIso.substring(0, 7))
          .reduce((a, x) => a + Number(x.valor ?? 0), 0)

        return [
          rotuloMes(mesIso),
          recMes.reduce((a, r) => a + (r.valor_previsto ?? 0), 0),
          recebido,
          despMes.reduce((a, d) => a + (d.valor_previsto ?? 0), 0),
          pago,
          recebido - pago,
          compras,
          aportadoMes,
        ]
      }),
    })
  }

  if (conjuntos.includes('despesas')) {
    secoes.push(
      nivel === 'detalhado'
        ? {
            titulo: 'Despesas (linha a linha)',
            explicacao: 'Cada lançamento do planejamento no período, exceto receitas.',
            colunas: ['Mês', 'Item', 'Categoria', 'Responsável', 'Status', 'Vencimento', 'Previsto', 'Pago'],
            linhas: despesas.map(d => [
              rotuloMes(d.mes_referencia),
              removerPrefixoCartao(d.item),
              d.categoria ?? 'Sem categoria',
              d.responsavel ?? '',
              d.pago ? 'Pago' : 'Em aberto',
              d.data_vencimento ? formatarData(d.data_vencimento) : '',
              d.valor_previsto ?? 0,
              d.pago ? (d.valor_real ?? d.valor_previsto ?? 0) : '',
            ]),
          }
        : {
            titulo: 'Despesas por categoria',
            explicacao: 'Despesas do período somadas por categoria (valores pagos; lançamentos em aberto usam o previsto).',
            colunas: ['Categoria', 'Lançamentos', 'Total'],
            linhas: agregar(
              despesas,
              d => d.categoria ?? 'Sem categoria',
              d => (d.pago ? (d.valor_real ?? d.valor_previsto ?? 0) : (d.valor_previsto ?? 0)),
            ).map(a => [a.chave, String(a.quantidade), a.total]),
          },
    )
  }

  if (conjuntos.includes('receitas')) {
    secoes.push({
      titulo: 'Receitas',
      explicacao: 'Entradas previstas e efetivamente recebidas em cada mês.',
      colunas: nivel === 'detalhado'
        ? ['Mês', 'Item', 'Responsável', 'Previsto', 'Recebido']
        : ['Mês', 'Previsto', 'Recebido'],
      linhas: nivel === 'detalhado'
        ? receitas.map(r => [
            rotuloMes(r.mes_referencia),
            r.item.replace(RECEITA_PREFIXO, ''),
            r.responsavel ?? '',
            r.valor_previsto ?? 0,
            r.pago ? (r.valor_real ?? r.valor_previsto ?? 0) : 0,
          ])
        : mesesStr.map(mesIso => {
            const doMes = receitas.filter(r => r.mes_referencia === mesIso)
            return [
              rotuloMes(mesIso),
              doMes.reduce((a, r) => a + (r.valor_previsto ?? 0), 0),
              doMes.reduce((a, r) => a + (r.pago ? (r.valor_real ?? r.valor_previsto ?? 0) : 0), 0),
            ]
          }),
    })
  }

  if (conjuntos.includes('compras')) {
    secoes.push(
      nivel === 'detalhado'
        ? {
            titulo: 'Compras no cartão (linha a linha)',
            explicacao: 'Lançamentos da fatura no período, sem estornos.',
            colunas: ['Fatura', 'Data da compra', 'Descrição', 'Categoria', 'Responsável', 'Cartão', 'Valor'],
            linhas: transacoes.map(t => [
              rotuloMes(t.projeto_fatura),
              formatarData((t.data_compra ?? t.data ?? '').toString()),
              t.descricao ?? '',
              t.categoria ?? 'Sem categoria',
              t.responsavel ?? '',
              t.cartao ?? 'nubank',
              Number(t.valor ?? 0),
            ]),
          }
        : {
            titulo: 'Compras no cartão por categoria',
            explicacao: 'Compras da fatura somadas por categoria no período, sem estornos.',
            colunas: ['Categoria', 'Compras', 'Total', 'Ticket médio'],
            linhas: agregar(transacoes, t => t.categoria ?? 'Sem categoria', t => Number(t.valor ?? 0))
              .map(a => [a.chave, String(a.quantidade), a.total, a.quantidade > 0 ? a.total / a.quantidade : 0]),
          },
    )
  }

  if (conjuntos.includes('categorias')) {
    const categorias = new Set<string>()
    for (const t of transacoes) categorias.add(t.categoria ?? 'Sem categoria')
    for (const d of despesas) categorias.add(d.categoria ?? 'Sem categoria')

    secoes.push({
      titulo: 'Matriz categoria × mês',
      explicacao: 'Total por categoria em cada mês, somando compras do cartão e despesas do planejamento (as linhas de pagamento de fatura ficam de fora para não duplicar).',
      colunas: ['Categoria', ...mesesStr.map(rotuloMes)],
      linhas: [...categorias].sort().map(cat => [
        cat,
        ...mesesStr.map(mesIso => {
          const doCartao = transacoes
            .filter(t => t.projeto_fatura === mesIso && (t.categoria ?? 'Sem categoria') === cat)
            .reduce((a, t) => a + Number(t.valor ?? 0), 0)
          const dasContas = despesas
            // ehDespesaReal descarta as linhas de pagamento de fatura: o gasto
            // delas já está distribuído nas compras do cartão acima.
            .filter(d =>
              d.mes_referencia === mesIso &&
              (d.categoria ?? 'Sem categoria') === cat &&
              ehDespesaReal(d.item),
            )
            .reduce((a, d) => a + (d.pago ? (d.valor_real ?? d.valor_previsto ?? 0) : (d.valor_previsto ?? 0)), 0)
          return doCartao + dasContas
        }),
      ]),
    })
  }

  if (conjuntos.includes('assinaturas')) {
    const ativas = assinaturas.filter(a => a.ativa)
    secoes.push({
      titulo: 'Assinaturas',
      explicacao: 'Cobranças recorrentes mensais cadastradas. O custo anual é o valor mensal × 12.',
      colunas: ['Assinatura', 'Categoria', 'Responsável', 'Cartão', 'Dia', 'Status', 'Mensal', 'Anual'],
      linhas: assinaturas.map(a => [
        a.nome,
        a.categoria ?? 'Outros',
        a.responsavel ?? 'Compartilhado',
        a.cartao ?? 'nubank',
        a.dia_cobranca !== null ? String(a.dia_cobranca) : '',
        a.ativa ? 'Ativa' : 'Pausada/cancelada',
        Number(a.valor ?? 0),
        Number(a.valor ?? 0) * 12,
      ]),
      totais: [
        { label: 'Custo mensal ativo', valor: ativas.reduce((acc, a) => acc + Number(a.valor ?? 0), 0) },
        { label: 'Custo anual ativo', valor: ativas.reduce((acc, a) => acc + Number(a.valor ?? 0), 0) * 12 },
      ],
    })
  }

  if (conjuntos.includes('investimentos')) {
    const descricaoPorId = new Map(investimentos.map(i => [i.id, i.descricao]))
    secoes.push({
      titulo: 'Investimentos',
      explicacao: 'Metas cadastradas por mês (percentual do saldo) e aportes efetivamente realizados.',
      colunas: ['Mês', 'Investimento', 'Percentual da meta', 'Aportado'],
      linhas: investimentos.map(inv => {
        const aportado = aportes
          .filter(a => a.investimento_id === inv.id)
          .reduce((acc, a) => acc + Number(a.valor ?? 0), 0)
        return [rotuloMes(inv.mes_referencia), inv.descricao, `${inv.percentual}%`, aportado]
      }),
      totais: [
        {
          label: 'Aportes no período',
          valor: aportes
            .filter(a => descricaoPorId.has(a.investimento_id))
            .reduce((acc, a) => acc + Number(a.valor ?? 0), 0),
        },
      ],
      vazio: 'Nenhum investimento cadastrado no período.',
    })
  }

  return { meses, janela, nivel, conjuntos, secoes, erros }
}

/** Perguntas prontas para colar junto dos dados — poupam o usuário de escrever o prompt. */
export const PROMPTS_SUGERIDOS: { titulo: string; texto: string }[] = [
  {
    titulo: 'Diagnóstico geral',
    texto: 'Estes são os dados financeiros da minha família. Faça um diagnóstico: para onde vai o dinheiro, o que está fora do padrão nos últimos meses e quais são os 3 maiores riscos. Use apenas os números fornecidos e diga explicitamente quando faltar informação.',
  },
  {
    titulo: 'Plano de corte de gastos',
    texto: 'Com base nestes dados, monte um plano para reduzir R$ 500 por mês nas despesas, priorizando cortes de menor impacto na qualidade de vida. Liste item por item, com o valor economizado e o esforço de cada corte.',
  },
  {
    titulo: 'Revisão do orçamento',
    texto: 'Compare o previsto com o realizado nestes dados e me diga quais valores previstos estão mal calibrados. Sugira um novo valor previsto para cada item que erra sistematicamente, explicando o critério.',
  },
  {
    titulo: 'Projeção dos próximos meses',
    texto: 'Projete meus próximos 6 meses a partir deste histórico: receita, despesa e saldo esperados. Aponte quais meses tendem a ficar apertados e por quê. Deixe claras as premissas usadas.',
  },
  {
    titulo: 'Auditoria de recorrentes',
    texto: 'Analise as assinaturas e os gastos recorrentes destes dados. Identifique duplicidades, serviços pouco usados e oportunidades de trocar plano mensal por anual. Calcule a economia anual de cada sugestão.',
  },
]

export function montarDocumentoDadosIA(relatorio: RelatorioDadosIA): DocumentoRelatorio {
  const primeiro = relatorio.meses[0]
  const ultimo = relatorio.meses[relatorio.meses.length - 1]

  return {
    titulo: 'Pacote de Dados Financeiros',
    subtitulo: `${formatarMes(primeiro)} a ${formatarMes(ultimo)} (${relatorio.janela} ${relatorio.janela === 1 ? 'mês' : 'meses'}) · modo ${relatorio.nivel}`,
    nomeArquivo: `dados-financeiros-${format(ultimo, 'yyyy-MM')}-${relatorio.janela}m`,
    avisos: relatorio.erros,
    corCabecalho: [79, 70, 229],
    secoes: relatorio.secoes,
    notaRodape:
      'Dados exportados do app de gestão financeira. Todos os valores em BRL. Ao analisar, não some despesas do planejamento com compras do cartão: o pagamento da fatura já representa as compras.',
  }
}

/**
 * Tamanho aproximado do pacote. A regra de ~4 caracteres por token é grosseira,
 * mas suficiente para avisar que 12 meses de compras detalhadas não vão caber
 * numa conversa curta.
 */
export function estimarTamanho(documento: DocumentoRelatorio): { caracteres: number; tokens: number } {
  const texto = documentoParaMarkdown(documento)
  return { caracteres: texto.length, tokens: Math.round(texto.length / 4) }
}
