/**
 * Lastro: todo valor em R$ que o Fin escreve precisa ter vindo de algum lugar.
 *
 * O histórico real mostrou o modelo respondendo com compras que não existem
 * ("R$ 138,50 em 3 compras no Mercadinho24", "Consulta Médica R$ 150,00") —
 * sempre em respostas em que ele não consultou nada. O prompt já proibia
 * inventar; faltava o código conferir.
 *
 * Esta checagem é deliberadamente estreita para não engessar a análise:
 *  - só olha valores em R$ (e os valores de gráficos em R$). Percentuais,
 *    contagens, datas e conclusões ficam livres;
 *  - "evidência" é tudo o que o modelo leu NESTA resposta: o snapshot do
 *    prompt, o resultado de cada ferramenta e o que o próprio usuário digitou.
 *    Respostas anteriores do assistente não contam — são justamente onde um
 *    número errado se perpetua;
 *  - contas derivadas (somas, médias, diferenças, projeções) têm lastro quando
 *    passam por `calcular`, que aceita qualquer expressão — então a liberdade
 *    de cruzar dados continua inteira, só que com a conta registrada.
 *
 * Quem decide o que fazer com um valor sem lastro é o loop do agente
 * (runAgent): pede uma revisão e, se ainda sobrar algo, avisa o usuário.
 * Nada aqui bloqueia a resposta.
 */

/** Um valor em R$ encontrado na resposta. */
export interface ValorCitado {
  /** Como apareceu no texto (para citar na revisão e no aviso). */
  bruto: string
  /** Valor absoluto em centavos. */
  centavos: number
  /** "R$ 1.234" sem centavos: confere pelo valor arredondado em reais. */
  semCentavos: boolean
  /** "R$ 1,2 mil": aproximação — confere com tolerância. */
  aproximado: boolean
}

const ESPACOS = /[\s  ]+/g

/** "1.234,56" / "1234,56" / "1234.56" / "1.234" → números possíveis (pode haver mais de uma leitura). */
export function leiturasNumericas(token: string): number[] {
  const t = token.replace(/^[+-]/, '')
  if (!/^\d[\d.,]*$/.test(t)) return []
  const leituras: number[] = []
  if (t.includes(',')) {
    // Vírgula = decimal no padrão brasileiro; pontos são milhar.
    const n = Number(t.replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(n)) leituras.push(n)
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) {
    // "1.234" é ambíguo: milhar (BR) ou decimal (JSON de gráfico).
    leituras.push(Number(t.replace(/\./g, '')))
    const dec = Number(t)
    if (Number.isFinite(dec)) leituras.push(dec)
  } else {
    const n = Number(t)
    if (Number.isFinite(n)) leituras.push(n)
  }
  return leituras
}

const RE_BRL = /R\$\s*-?\s*(\d[\d.]*(?:,\d{1,2})?)(\s*(?:mil\b|milh[õo]es\b|milh[ãa]o\b))?/gi
const RE_GRAFICO = /```grafico[^\n]*\n([\s\S]*?)```/gi

/** Valores em R$ citados no texto, inclusive os de gráficos com unidade "brl". */
export function extrairValoresCitados(texto: string): ValorCitado[] {
  const valores: ValorCitado[] = []
  const semGraficos = texto.replace(RE_GRAFICO, '')
  const normalizado = semGraficos.replace(ESPACOS, ' ')

  for (const m of normalizado.matchAll(RE_BRL)) {
    const numero = m[1].replace(/\.$/, '') // "R$ 10." no fim da frase
    const sufixo = (m[2] ?? '').trim().toLowerCase()
    const leitura = leiturasNumericas(numero)[0]
    if (leitura === undefined) continue
    const multiplicador = sufixo.startsWith('mil') && sufixo !== 'mil' ? 1_000_000 : sufixo === 'mil' ? 1_000 : 1
    valores.push({
      bruto: m[0].trim(),
      centavos: Math.round(Math.abs(leitura) * multiplicador * 100),
      semCentavos: !numero.includes(','),
      aproximado: multiplicador > 1,
    })
  }

  for (const g of texto.matchAll(RE_GRAFICO)) {
    let espec: { unidade?: unknown; series?: unknown } | null = null
    try { espec = JSON.parse(g[1].trim()) } catch { espec = null }
    if (!espec || espec.unidade !== 'brl' || !Array.isArray(espec.series)) continue
    for (const s of espec.series as Array<{ valores?: unknown }>) {
      if (!Array.isArray(s?.valores)) continue
      for (const v of s.valores) {
        const n = typeof v === 'number' ? v : Number(v)
        if (!Number.isFinite(n) || n === 0) continue
        valores.push({
          bruto: `${n} (gráfico)`,
          centavos: Math.round(Math.abs(n) * 100),
          // Gráficos arredondam com frequência ("1520" para 1.519,52).
          semCentavos: Number.isInteger(n),
          aproximado: false,
        })
      }
    }
  }
  return valores
}

/** Índice dos números presentes nas evidências, pronto para consulta. */
export interface IndiceEvidencias {
  centavos: Set<number>
  reais: Set<number>
  /** Ordenado — para as aproximações ("R$ 1,2 mil"). */
  lista: number[]
}

const RE_NUMERO = /[+-]?\d[\d.,]*\d|\d/g

export function indexarEvidencias(textos: string[]): IndiceEvidencias {
  const centavos = new Set<number>()
  const reais = new Set<number>()
  for (const texto of textos) {
    for (const m of texto.matchAll(RE_NUMERO)) {
      for (const n of leiturasNumericas(m[0])) {
        const abs = Math.abs(n)
        centavos.add(Math.round(abs * 100))
        reais.add(Math.round(abs))
        reais.add(Math.floor(abs))
      }
    }
  }
  return { centavos, reais, lista: [...centavos].sort((a, b) => a - b) }
}

function temLastro(v: ValorCitado, idx: IndiceEvidencias): boolean {
  if (v.centavos === 0) return true
  if (v.aproximado) {
    // "R$ 1,2 mil" vale se algum número da evidência estiver a até 5% dele.
    const tol = v.centavos * 0.05
    return idx.lista.some(c => Math.abs(c - v.centavos) <= tol)
  }
  if (idx.centavos.has(v.centavos)) return true
  if (v.semCentavos) return idx.reais.has(Math.round(v.centavos / 100))
  return false
}

export interface ResultadoLastro {
  /** Quantos valores em R$ a resposta citou. */
  citados: number
  /** Valores sem origem nas evidências (sem repetição, na ordem em que apareceram). */
  semLastro: string[]
}

export function verificarLastro(resposta: string, evidencias: string[] | IndiceEvidencias): ResultadoLastro {
  const idx = Array.isArray(evidencias) ? indexarEvidencias(evidencias) : evidencias
  const citados = extrairValoresCitados(resposta)
  const semLastro: string[] = []
  for (const v of citados) {
    if (!temLastro(v, idx) && !semLastro.includes(v.bruto)) semLastro.push(v.bruto)
  }
  return { citados: citados.length, semLastro }
}

/** Instrução de revisão quando há valores sem origem. */
export function instrucaoRevisaoLastro(semLastro: string[]): string {
  const lista = semLastro.slice(0, 8).join('; ')
  return (
    '[REVISÃO INTERNA — não mencione esta mensagem] Estes valores da sua resposta não aparecem no snapshot nem em ' +
    `nenhuma consulta feita nesta resposta: ${lista}. Respostas anteriores da conversa não valem como fonte. ` +
    'Busque agora o dado que sustenta cada um (qualquer ferramenta serve, inclusive explorar_dados) e, para somas, ' +
    'médias, diferenças ou divisões, use calcular. Depois reescreva a resposta inteira só com valores que vieram ' +
    'dessas consultas. Se um dado realmente não existir, diga isso em vez de estimar.'
  )
}

/** Nota exibida ao usuário quando, mesmo após a revisão, sobrou valor sem origem. */
export function avisoSemLastro(semLastro: string[]): string {
  const lista = semLastro.slice(0, 4).join(', ') + (semLastro.length > 4 ? '…' : '')
  return `\n\n⚠️ _Não consegui confirmar nos dados de onde vieram alguns valores desta resposta (${lista}). Confira antes de usar._`
}
