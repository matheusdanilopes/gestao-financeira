/**
 * explorar_dados — consulta genérica sobre qualquer fonte do catálogo.
 *
 * As ferramentas especializadas (consultar_transacoes, resumo_mensal…) sabem
 * as regras de negócio e devem continuar sendo a primeira escolha para
 * totais do app. Esta aqui é a rede de segurança para todo o resto: campos que
 * elas não mostram, fontes que elas não cobrem (atividade, histórico de preço
 * das assinaturas, importações…) e listagens detalhadas com filtros
 * arbitrários. Sem ela, qualquer pergunta fora do previsto voltava a ser "não
 * tenho esse dado".
 *
 * Continua sem SQL livre: o modelo escolhe fonte, campos e operadores de
 * listas fechadas; tudo é validado aqui e aplicado em memória, sobre linhas
 * que o gateway leu com colunas da lista branca.
 */

import { format } from 'date-fns'
import { formatBRL } from '../../format'
import type { GatewayDados } from '../data/gateway'
import { FONTES, fontePorId, type Campo, type Fonte, type Linha, type Valor } from '../data/catalogo'
import { casaBusca, normalizar, normalizarMes, fmtMes, linhaSugestoes, FiltroInvalido, type Referencias } from './queryEngine'

const R = formatBRL
const LIMITE_PADRAO = 10
const LIMITE_MAXIMO = 30
const MAX_GRUPOS = 30

export const OPERADORES = ['igual', 'diferente', 'contem', 'nao_contem', 'maior', 'maior_igual', 'menor', 'menor_igual', 'vazio', 'preenchido'] as const
type Operador = typeof OPERADORES[number]

export const AGRUPAMENTOS_TEMPO = ['mes', 'ano', 'dia', 'dia_semana'] as const

export interface ParamsExplorar {
  fonte?: string
  busca?: string
  filtros?: unknown
  dataInicio?: string
  dataFim?: string
  mesInicio?: string
  mesFim?: string
  agruparPor?: string
  somar?: string
  ordenarPor?: string
  ordem?: string
  campos?: unknown
  limite?: number
  pagina?: number
}

interface Filtro { campo: Campo; operador: Operador; valor: string }

// ─── Validação ───────────────────────────────────────────────────────────────

function campoDa(fonte: Fonte, nome: unknown, uso: string): Campo {
  const alvo = normalizar(String(nome ?? ''))
  const campo = fonte.campos.find(c => c.nome === alvo || normalizar(c.nome) === alvo)
  if (!campo) {
    throw new FiltroInvalido(
      `Campo "${String(nome)}" (${uso}) não existe na fonte "${fonte.id}". Campos válidos: ${fonte.campos.map(c => c.nome).join(', ')}.`
    )
  }
  return campo
}

function lerFiltros(fonte: Fonte, bruto: unknown): Filtro[] {
  if (!Array.isArray(bruto)) return []
  return bruto.slice(0, 8).map(f => {
    const o = (f ?? {}) as Record<string, unknown>
    const campo = campoDa(fonte, o.campo, 'filtro')
    const operador = normalizar(String(o.operador ?? 'igual')).replace(/\s+/g, '_') as Operador
    if (!OPERADORES.includes(operador)) {
      throw new FiltroInvalido(`Operador "${String(o.operador)}" inválido. Use um destes: ${OPERADORES.join(', ')}.`)
    }
    return { campo, operador, valor: o.valor === undefined || o.valor === null ? '' : String(o.valor) }
  })
}

const dataValida = (v?: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined)

function diaSeguinte(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return format(d, 'yyyy-MM-dd')
}

function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return format(new Date(a, m, 0), 'yyyy-MM-dd')
}

// ─── Comparação e formatação de valores ──────────────────────────────────────

const numerico = (c: Campo) => c.tipo === 'moeda' || c.tipo === 'numero'

function paraNumero(v: string): number {
  const limpo = v.replace(/[R$\s]/g, '')
  // "1.234,56" → 1234.56; "1234.56" continua igual.
  const normal = /,\d{1,2}$/.test(limpo) ? limpo.replace(/\./g, '').replace(',', '.') : limpo
  return Number(normal)
}

function paraBooleano(v: string): boolean {
  return ['true', 'sim', 's', '1', 'verdadeiro', 'yes'].includes(normalizar(v))
}

function aplicar(f: Filtro, v: Valor): boolean {
  const vazio = v === null || v === undefined || v === ''
  if (f.operador === 'vazio') return vazio
  if (f.operador === 'preenchido') return !vazio
  if (f.campo.tipo === 'booleano') {
    const alvo = paraBooleano(f.valor)
    return f.operador === 'diferente' ? Boolean(v) !== alvo : Boolean(v) === alvo
  }
  if (vazio) return f.operador === 'diferente' || f.operador === 'nao_contem'

  if (numerico(f.campo)) {
    const a = Number(v)
    const b = paraNumero(f.valor)
    if (!Number.isFinite(b)) throw new FiltroInvalido(`Valor "${f.valor}" não é um número (campo ${f.campo.nome}).`)
    switch (f.operador) {
      case 'igual': return Math.abs(a - b) < 0.005
      case 'diferente': return Math.abs(a - b) >= 0.005
      case 'maior': return a > b
      case 'maior_igual': return a >= b
      case 'menor': return a < b
      case 'menor_igual': return a <= b
      case 'contem': return String(v).includes(f.valor)
      case 'nao_contem': return !String(v).includes(f.valor)
    }
  }

  const s = String(v)
  const temporal = f.campo.tipo === 'data' || f.campo.tipo === 'datahora' || f.campo.tipo === 'mes'
  switch (f.operador) {
    // Em datas, "igual a 2026-09-29" casa com qualquer hora daquele dia.
    case 'igual': return temporal ? s.startsWith(f.valor) : normalizar(s) === normalizar(f.valor)
    case 'diferente': return temporal ? !s.startsWith(f.valor) : normalizar(s) !== normalizar(f.valor)
    case 'contem': return casaBusca(s, f.valor)
    case 'nao_contem': return !casaBusca(s, f.valor)
    case 'maior': return temporal ? s.substring(0, f.valor.length) > f.valor : normalizar(s) > normalizar(f.valor)
    case 'maior_igual': return temporal ? s.substring(0, f.valor.length) >= f.valor : normalizar(s) >= normalizar(f.valor)
    case 'menor': return temporal ? s.substring(0, f.valor.length) < f.valor : normalizar(s) < normalizar(f.valor)
    case 'menor_igual': return temporal ? s.substring(0, f.valor.length) <= f.valor : normalizar(s) <= normalizar(f.valor)
  }
  return true
}

function formatar(c: Campo | undefined, v: Valor): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (c?.tipo) {
    case 'moeda': return R(Number(v))
    case 'booleano': return v ? 'sim' : 'não'
    case 'mes': return fmtMes(String(v))
    case 'data': {
      const [a, m, d] = String(v).substring(0, 10).split('-')
      return d ? `${d}/${m}/${a.slice(2)}` : String(v)
    }
    case 'datahora': {
      const s = String(v)
      const [a, m, d] = s.substring(0, 10).split('-')
      const hora = s.substring(11, 16)
      return d ? `${d}/${m}/${a.slice(2)}${hora ? ` ${hora}` : ''}` : s
    }
    default: {
      const s = String(v).replace(/\s+/g, ' ')
      return s.length > 60 ? `${s.slice(0, 57)}…` : s
    }
  }
}

// ─── Agrupamento ─────────────────────────────────────────────────────────────

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function chaveTempo(fonte: Fonte, linha: Linha, tipo: typeof AGRUPAMENTOS_TEMPO[number]): string | null {
  const data = fonte.campoData ? (linha[fonte.campoData] as string | null) : null
  const mes = fonte.campoMes ? (linha[fonte.campoMes] as string | null) : data?.substring(0, 7) ?? null
  switch (tipo) {
    case 'mes': return mes
    case 'ano': return mes?.substring(0, 4) ?? null
    case 'dia': return data?.substring(0, 10) ?? null
    case 'dia_semana': return data ? DIAS_SEMANA[new Date(`${data.substring(0, 10)}T12:00:00`).getDay()] : null
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────

export async function explorarDados(gw: GatewayDados, p: ParamsExplorar, refs: Referencias): Promise<string> {
  const fonte = fontePorId(String(p.fonte ?? ''))
  if (!fonte) {
    throw new FiltroInvalido(`Fonte "${p.fonte ?? ''}" não existe. Fontes válidas: ${FONTES.map(f => f.id).join(', ')}.`)
  }

  const filtros = lerFiltros(fonte, p.filtros)
  const busca = typeof p.busca === 'string' && p.busca.trim() ? p.busca.trim() : undefined
  const dataInicio = dataValida(p.dataInicio)
  const dataFim = dataValida(p.dataFim)
  const mesInicio = normalizarMes(p.mesInicio)
  const mesFim = normalizarMes(p.mesFim)

  const campoSoma = p.somar ? campoDa(fonte, p.somar, 'somar') : fonte.campoValor ? campoDa(fonte, fonte.campoValor, 'valor') : undefined
  if (campoSoma && !numerico(campoSoma)) throw new FiltroInvalido(`Campo "${campoSoma.nome}" não é numérico; não dá para somar.`)

  const agrupTempo = AGRUPAMENTOS_TEMPO.find(a => a === normalizar(String(p.agruparPor ?? '')))
  const campoGrupo = p.agruparPor && !agrupTempo ? campoDa(fonte, p.agruparPor, 'agruparPor') : undefined
  const campoOrdem = p.ordenarPor ? campoDa(fonte, p.ordenarPor, 'ordenarPor') : undefined
  const camposLista = Array.isArray(p.campos) && p.campos.length > 0
    ? p.campos.slice(0, 10).map(c => campoDa(fonte, c, 'campos'))
    : fonte.campos
  const campoTitulo = fonte.campos.find(c => c.nome === fonte.campoTitulo)

  const notas: string[] = []
  const temPeriodo = Boolean(dataInicio || dataFim || mesInicio || mesFim)
  if (temPeriodo && !fonte.campoData && !fonte.campoMes) {
    notas.push(`A fonte "${fonte.id}" não tem data: o período pedido foi ignorado.`)
  }

  // ── Leitura ──
  let linhas: Linha[]
  const dados = await gw.dados()
  if (fonte.origem === 'nucleo') {
    if (fonte.historico) {
      const inicio = mesInicio ?? dataInicio?.substring(0, 7)
      if (inicio) await gw.garantirDesde(inicio)
      else await gw.garantirTudo()
    }
    linhas = fonte.linhas(await gw.dados())
  } else {
    let desde = dataInicio ?? (mesInicio ? `${mesInicio}-01` : undefined)
    const ate = dataFim ?? (mesFim ? ultimoDiaDoMes(mesFim) : undefined)
    if (!desde && fonte.janelaPadraoMeses) {
      const d = new Date(refs.hoje)
      d.setMonth(d.getMonth() - fonte.janelaPadraoMeses)
      desde = format(d, 'yyyy-MM-dd')
      notas.push(`Sem período na pergunta: foram considerados só os últimos ${fonte.janelaPadraoMeses} meses (desde ${formatar({ nome: '', tipo: 'data', descricao: '' }, desde)}). Para ir mais longe, passe dataInicio.`)
    }
    // Um dia de folga nas pontas: o banco guarda UTC e o filtro fino, na hora
    // de Brasília, é feito em memória logo abaixo.
    const { linhas: brutas, truncado } = await gw.lerFonte({
      ...fonte.consulta,
      filtros: [
        ...(desde ? [{ op: 'gte' as const, coluna: fonte.colunaPeriodo, valor: format(new Date(`${desde}T12:00:00`).getTime() - 86_400_000, 'yyyy-MM-dd') }] : []),
        ...(ate ? [{ op: 'lt' as const, coluna: fonte.colunaPeriodo, valor: diaSeguinte(diaSeguinte(ate)) }] : []),
      ],
    })
    if (truncado) notas.push('ATENÇÃO: o período tem registros demais e a leitura foi cortada — restrinja o período para ter totais completos.')
    linhas = fonte.transformar(brutas, dados)
    if (desde && !dataInicio && !mesInicio) {
      // Janela padrão: o corte fino também é em memória (o banco teve folga de 1 dia).
      const limite = desde
      linhas = linhas.filter(l => {
        const v = fonte.campoData ? l[fonte.campoData] : null
        return !v || String(v).substring(0, 10) >= limite
      })
    }
  }

  // ── Filtros em memória ──
  const mesDaLinha = (l: Linha): string | null =>
    fonte.campoMes ? (l[fonte.campoMes] as string | null) : fonte.campoData ? String(l[fonte.campoData] ?? '').substring(0, 7) || null : null
  const diaDaLinha = (l: Linha): string | null =>
    fonte.campoData ? String(l[fonte.campoData] ?? '').substring(0, 10) || null : null
  const camposTexto = fonte.campos.filter(c => c.tipo === 'texto')

  const encontradas = linhas.filter(l => {
    if (dataInicio || dataFim) {
      const d = diaDaLinha(l)
      if (fonte.campoData) {
        if (!d) return false
        if (dataInicio && d < dataInicio) return false
        if (dataFim && d > dataFim) return false
      }
    }
    if (mesInicio || mesFim) {
      const m = mesDaLinha(l)
      if (fonte.campoMes || fonte.campoData) {
        if (!m) return false
        if (mesInicio && m < mesInicio) return false
        if (mesFim && m > mesFim) return false
      }
    }
    if (busca && !camposTexto.some(c => l[c.nome] && casaBusca(String(l[c.nome]), busca))) return false
    return filtros.every(f => aplicar(f, l[f.campo.nome]))
  })

  // ── Cabeçalho ──
  const descFiltros = [
    busca && `texto contém "${busca}"`,
    dataInicio && `desde ${formatar({ nome: '', tipo: 'data', descricao: '' }, dataInicio)}`,
    dataFim && `até ${formatar({ nome: '', tipo: 'data', descricao: '' }, dataFim)}`,
    mesInicio && mesFim && mesInicio === mesFim ? `mês ${fmtMes(mesInicio)}` : [
      mesInicio && `a partir de ${fmtMes(mesInicio)}`,
      mesFim && `até ${fmtMes(mesFim)}`,
    ].filter(Boolean).join(' '),
    ...filtros.map(f => `${f.campo.nome} ${f.operador.replace('_', ' ')}${f.operador === 'vazio' || f.operador === 'preenchido' ? '' : ` ${f.valor}`}`),
  ].filter(Boolean).join(' · ')

  const saida: string[] = [
    `CONSULTA: explorar_dados · fonte=${fonte.id} (${descFiltros || 'sem filtros'})`,
  ]
  if (fonte.nota) saida.push(`Obs.: ${fonte.nota}`)

  if (encontradas.length === 0) {
    saida.push(`Resultado: nenhum registro (de ${linhas.length} na fonte) com esses filtros.`)
    const sugestao = linhaSugestoes(linhas.map(l => String(l[fonte.campoTitulo] ?? '')), busca)
    if (sugestao) saida.push(sugestao)
    saida.push(...notas)
    return saida.join('\n')
  }

  // ── Totais ──
  const valorDe = (l: Linha) => (campoSoma ? Number(l[campoSoma.nome] ?? 0) || 0 : 0)
  if (campoSoma) {
    const comValor = encontradas.filter(l => l[campoSoma.nome] !== null && l[campoSoma.nome] !== undefined)
    const soma = comValor.reduce((s, l) => s + valorDe(l), 0)
    const valores = comValor.map(valorDe)
    const fmt = (n: number) => formatar(campoSoma, n)
    saida.push(
      `Total: ${encontradas.length} registro(s) · soma de ${campoSoma.nome}: ${fmt(soma)}` +
      (valores.length > 1
        ? ` · média ${fmt(soma / valores.length)} · menor ${fmt(Math.min(...valores))} · maior ${fmt(Math.max(...valores))}`
        : '')
    )
  } else {
    saida.push(`Total: ${encontradas.length} registro(s).`)
  }

  // ── Agrupamento ──
  if (agrupTempo || campoGrupo) {
    const mapa = new Map<string, { total: number; n: number }>()
    for (const l of encontradas) {
      const k = agrupTempo ? chaveTempo(fonte, l, agrupTempo) : formatar(campoGrupo, l[campoGrupo!.nome])
      const chave = k ?? '—'
      const atual = mapa.get(chave) ?? { total: 0, n: 0 }
      atual.total += valorDe(l)
      atual.n += 1
      mapa.set(chave, atual)
    }
    const cronologico = agrupTempo === 'mes' || agrupTempo === 'ano' || agrupTempo === 'dia'
    const entradas = [...mapa.entries()].sort(cronologico
      ? (a, b) => a[0].localeCompare(b[0])
      : (a, b) => (campoSoma ? b[1].total - a[1].total : b[1].n - a[1].n))
    const visiveis = cronologico ? entradas.slice(-MAX_GRUPOS) : entradas.slice(0, MAX_GRUPOS)
    const rotulo = (k: string) => (agrupTempo === 'mes' && k !== '—' ? fmtMes(k) : agrupTempo === 'dia' && k !== '—' ? formatar({ nome: '', tipo: 'data', descricao: '' }, k) : k)
    saida.push(
      `Por ${agrupTempo ?? campoGrupo!.nome}: ` +
      visiveis.map(([k, v]) => `${rotulo(k)}: ${campoSoma ? `${formatar(campoSoma, v.total)} (${v.n}x)` : `${v.n}x`}`).join(' · ') +
      (entradas.length > visiveis.length ? ` · [+${entradas.length - visiveis.length} grupos não exibidos]` : '')
    )
  }

  // ── Lista ──
  const ordem = normalizar(String(p.ordem ?? '')) === 'asc' ? 1 : -1
  const campoOrdenacao = campoOrdem
    ?? (fonte.campoData ? fonte.campos.find(c => c.nome === fonte.campoData) : undefined)
    ?? campoSoma
  const ordenadas = campoOrdenacao
    ? [...encontradas].sort((a, b) => {
      const va = a[campoOrdenacao.nome]
      const vb = b[campoOrdenacao.nome]
      if (va === vb) return 0
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      const cmp = numerico(campoOrdenacao) ? Number(va) - Number(vb) : String(va).localeCompare(String(vb))
      return cmp * ordem
    })
    : encontradas

  const limite = Math.min(Math.max(Math.round(Number(p.limite) || LIMITE_PADRAO), 1), LIMITE_MAXIMO)
  const paginas = Math.max(1, Math.ceil(ordenadas.length / limite))
  const pagina = Math.min(Math.max(Math.round(Number(p.pagina) || 1), 1), paginas)
  const itens = ordenadas.slice((pagina - 1) * limite, pagina * limite)
  const inicio = (pagina - 1) * limite

  saida.push(
    `Registros ${inicio + 1}–${inicio + itens.length} de ${ordenadas.length}` +
    (campoOrdenacao ? ` (ordem: ${campoOrdenacao.nome} ${ordem === 1 ? 'crescente' : 'decrescente'})` : '') + ':'
  )
  for (const l of itens) {
    const titulo = campoTitulo ? formatar(campoTitulo, l[campoTitulo.nome]) : ''
    const resto = camposLista
      .filter(c => c.nome !== fonte.campoTitulo)
      .map(c => [c, l[c.nome]] as const)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([c, v]) => `${c.nome}: ${formatar(c, v)}`)
      .join(' · ')
    saida.push(`  • ${titulo}${resto ? ` — ${resto}` : ''}`)
  }
  if (paginas > 1) {
    saida.push(
      `LISTA PARCIAL: página ${pagina} de ${paginas}. Os totais acima já consideram todos os ${ordenadas.length}. ` +
      (pagina < paginas ? `Próxima página: pagina=${pagina + 1}.` : '')
    )
  }
  saida.push(...notas)
  return saida.join('\n')
}
