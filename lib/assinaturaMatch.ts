/**
 * Identificação da cobrança de uma assinatura dentro da fatura.
 *
 * O critério antigo era só `descricao.includes(nome)`: qualquer compra avulsa no
 * mesmo estabelecimento tomava o lugar da cobrança recorrente. Foi assim que um
 * pacote de cupons do iFood de R$ 8,97 assumiu a cobrança do iFood Club de
 * R$ 12,90 — a assinatura ficava marcada como "valor diferente" e só voltaria ao
 * normal quando a cobrança certa caísse na fatura.
 *
 * Aqui a identificação exige, além do nome:
 *
 *  1. nome casado por TOKENS sobre texto normalizado (acentos, `*`, pontuação),
 *     o que cobre "IFD*IFOOD CLUB" e evita casar por pedaço de palavra;
 *  2. valor PLAUSÍVEL — igual (tolerância de centavos, ou de câmbio em moeda
 *     estrangeira) ou, no máximo, LIMITE_DIVERGENCIA acima/abaixo do valor
 *     vigente no mês (reajuste); fora disso é outra compra, não a assinatura;
 *  3. compra não parcelada — assinatura não é cobrada em 3/12;
 *  4. quando o valor não bate exatamente e a assinatura tem dia de cobrança
 *     cadastrado, a compra precisa estar perto desse dia;
 *  5. exclusividade: cada transação sustenta UMA assinatura (a de melhor
 *     pontuação), então duas assinaturas do mesmo serviço não são dadas como
 *     pagas pelo mesmo lançamento.
 *
 * As compras que citam o nome mas foram recusadas voltam em `descartadas`, com o
 * motivo — a tela usa isso para explicar por que a assinatura segue como não
 * encontrada em vez de simplesmente esconder o que aconteceu.
 */
import { extrairParcela } from './parcelaDescricao'

/** Diferença absoluta (R$) ainda considerada "mesmo valor" em assinaturas em BRL. */
export const TOLERANCIA_CENTAVOS = 0.05
/** Diferença relativa ainda considerada "mesmo valor" em moeda estrangeira (câmbio). */
export const TOLERANCIA_CAMBIO = 0.05
/** Diferença relativa máxima para uma compra ainda ser aceita como a cobrança da
 *  assinatura com valor divergente (reajuste). Acima disso é outra compra. */
export const LIMITE_DIVERGENCIA = 0.2
/** Distância máxima (dias) entre a compra e o dia de cobrança cadastrado, exigida
 *  apenas quando o valor não bate exatamente. */
export const JANELA_DIA_COBRANCA = 7

export function normalizarTexto(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function tokensDe(valor: string | null | undefined): string[] {
  const normalizado = normalizarTexto(valor)
  return normalizado ? normalizado.split(' ') : []
}

// Prefixo só vale a partir de 4 caracteres: com menos que isso "max" casaria
// "maxipan" e "one" casaria "onefootball".
function tokenCasa(tokenNome: string, tokenDescricao: string): boolean {
  if (tokenNome === tokenDescricao) return true
  if (tokenNome.length >= 4 && tokenDescricao.startsWith(tokenNome)) return true
  if (tokenDescricao.length >= 4 && tokenNome.startsWith(tokenDescricao)) return true
  return false
}

/**
 * Aderência do nome da assinatura à descrição da compra. Retorna `null` quando
 * algum token do nome não aparece na descrição; caso contrário, um número de 0 a
 * 1 medindo quanto da descrição o nome cobre — a especificidade, que faz
 * "iFood Club" ganhar de "iFood" na mesma descrição.
 */
export function aderenciaNome(nome: string, descricao: string | null | undefined): number | null {
  const tokensNome = tokensDe(nome)
  const tokensDescricao = tokensDe(descricao)
  if (tokensNome.length === 0 || tokensDescricao.length === 0) return null
  const casados = tokensNome.filter(tn => tokensDescricao.some(td => tokenCasa(tn, td)))
  if (casados.length < tokensNome.length) return null
  return Math.min(1, tokensNome.length / tokensDescricao.length)
}

/** Tolerância absoluta (R$) para considerar que o valor cobrado é o esperado. */
export function toleranciaDe(valorEsperado: number, moeda?: string | null): number {
  return moeda && moeda !== 'BRL'
    ? Math.abs(valorEsperado) * TOLERANCIA_CAMBIO
    : TOLERANCIA_CENTAVOS
}

function diaDoMes(dataISO?: string | null): number | null {
  const match = /^\d{4}-\d{2}-(\d{2})/.exec(String(dataISO ?? ''))
  return match ? Number(match[1]) : null
}

/** Distância em dias entre a compra e o dia de cobrança, dando a volta no mês
 *  (dia 1 e dia 30 estão a 2 dias, não a 29). `null` quando falta algum dos dois. */
export function distanciaDoDiaCobranca(
  diaCobranca: number | null | undefined,
  dataCompraISO: string | null | undefined
): number | null {
  const dia = diaDoMes(dataCompraISO)
  if (dia === null || !diaCobranca) return null
  const bruta = Math.abs(dia - diaCobranca)
  return Math.min(bruta, 31 - bruta)
}

export interface AssinaturaParaMatch {
  id: string
  nome: string
  cartao?: string | null
  moeda?: string | null
  diaCobranca?: number | null
  /** Valor vigente no mês analisado (já resolvido pelo histórico). */
  valorEsperado: number
}

export interface TransacaoParaMatch {
  descricao?: string | null
  valor: number
  cartao?: string | null
  dataCompra?: string | null
  parcelaAtual?: number | null
  totalParcelas?: number | null
}

export type MotivoDescarte =
  /** Compra parcelada — assinatura não vem em N/M. */
  | 'parcelada'
  /** Valor longe demais do vigente (compra avulsa no mesmo estabelecimento). */
  | 'valor_fora_da_faixa'
  /** Valor divergente e compra longe do dia de cobrança cadastrado. */
  | 'data_distante'
  /** Já usada como cobrança de outra assinatura com nome mais específico. */
  | 'de_outra_assinatura'

export type StatusAssinatura = 'detectada' | 'valor_divergente' | 'nao_encontrada' | 'inativa'

export interface CandidatoDescartado<T> {
  transacao: T
  motivo: MotivoDescarte
  /** valor da compra − valor esperado da assinatura */
  diferenca: number
}

export interface IdentificacaoAssinatura<T> {
  status: Exclude<StatusAssinatura, 'inativa'>
  /** Cobrança aceita como sendo a da assinatura. */
  transacao: T | null
  valorCobrado: number | null
  /** valor cobrado − valor esperado (positivo = cobrou mais). */
  diferenca: number | null
  /** Compras que citam o nome da assinatura mas foram recusadas, com o motivo. */
  descartadas: CandidatoDescartado<T>[]
}

interface Par<T> {
  assinaturaId: string
  indiceTransacao: number
  transacao: T
  exata: boolean
  diferenca: number
  score: number
  motivo: MotivoDescarte | null
}

function ehParcelada(transacao: TransacaoParaMatch): boolean {
  if (transacao.totalParcelas != null && Number(transacao.totalParcelas) > 1) return true
  const parcela = extrairParcela(
    transacao.descricao,
    transacao.parcelaAtual ?? null,
    transacao.totalParcelas ?? null
  )
  return !!parcela && parcela.total > 1
}

/**
 * Casa assinaturas com as transações da fatura. Devolve um mapa por id de
 * assinatura — as que não aparecem na fatura vêm com status `nao_encontrada` e,
 * quando existir, a lista de compras parecidas que foram recusadas.
 */
export function identificarAssinaturasNaFatura<
  A extends AssinaturaParaMatch,
  T extends TransacaoParaMatch,
>(assinaturas: A[], transacoes: T[]): Map<string, IdentificacaoAssinatura<T>> {
  const pares: Par<T>[] = []

  for (const assinatura of assinaturas) {
    const valorEsperado = Number(assinatura.valorEsperado ?? 0)
    const tolerancia = toleranciaDe(valorEsperado, assinatura.moeda)

    for (let indice = 0; indice < transacoes.length; indice++) {
      const transacao = transacoes[indice]
      // Cartão só descarta quando os dois lados o informam (o Dashboard, por
      // exemplo, já filtra as transações do cartão antes de chamar).
      if (assinatura.cartao && transacao.cartao && assinatura.cartao !== transacao.cartao) continue

      const aderencia = aderenciaNome(assinatura.nome, transacao.descricao)
      if (aderencia === null) continue

      const diferenca = Number(transacao.valor ?? 0) - valorEsperado
      const exata = Math.abs(diferenca) <= tolerancia
      const relativa = valorEsperado !== 0
        ? Math.abs(diferenca) / Math.abs(valorEsperado)
        : (exata ? 0 : Number.POSITIVE_INFINITY)
      const distancia = distanciaDoDiaCobranca(assinatura.diaCobranca, transacao.dataCompra)

      let motivo: MotivoDescarte | null = null
      if (ehParcelada(transacao)) motivo = 'parcelada'
      else if (!exata && relativa > LIMITE_DIVERGENCIA) motivo = 'valor_fora_da_faixa'
      else if (!exata && distancia !== null && distancia > JANELA_DIA_COBRANCA) motivo = 'data_distante'

      // Peso maior no valor: é o sinal mais confiável de que a compra é a
      // cobrança recorrente, e não uma compra avulsa no mesmo lugar.
      const proximidadeValor = exata ? 1 : Math.max(0, 1 - relativa / LIMITE_DIVERGENCIA)
      const proximidadeData = distancia === null ? 0.5 : Math.max(0, 1 - distancia / 15)
      const score = proximidadeValor * 0.6 + aderencia * 0.25 + proximidadeData * 0.15

      pares.push({
        assinaturaId: assinatura.id,
        indiceTransacao: indice,
        transacao,
        exata,
        diferenca,
        score,
        motivo,
      })
    }
  }

  // Atribuição gulosa: o par de maior pontuação leva a transação, que sai do
  // jogo para as demais assinaturas.
  const escolhidos = new Map<string, Par<T>>()
  const transacoesUsadas = new Map<number, string>()
  const validos = pares
    .filter(p => p.motivo === null)
    .sort((a, b) => (b.score - a.score) || (Math.abs(a.diferenca) - Math.abs(b.diferenca)))

  for (const par of validos) {
    if (escolhidos.has(par.assinaturaId)) continue
    if (transacoesUsadas.has(par.indiceTransacao)) continue
    escolhidos.set(par.assinaturaId, par)
    transacoesUsadas.set(par.indiceTransacao, par.assinaturaId)
  }

  const resultado = new Map<string, IdentificacaoAssinatura<T>>()
  for (const assinatura of assinaturas) {
    const escolhido = escolhidos.get(assinatura.id)
    const descartadas: CandidatoDescartado<T>[] = []

    for (const par of pares) {
      if (par.assinaturaId !== assinatura.id) continue
      if (escolhido && par.indiceTransacao === escolhido.indiceTransacao) continue
      const dono = transacoesUsadas.get(par.indiceTransacao)
      const motivo: MotivoDescarte | null = par.motivo
        ?? (dono && dono !== assinatura.id ? 'de_outra_assinatura' : null)
      // Sem motivo é só uma alternativa pior para a mesma assinatura (ex.: duas
      // cobranças no mês) — não é ruído que valha mostrar.
      if (!motivo) continue
      descartadas.push({ transacao: par.transacao, motivo, diferenca: par.diferenca })
    }

    descartadas.sort((a, b) => Math.abs(a.diferenca) - Math.abs(b.diferenca))

    resultado.set(assinatura.id, {
      status: escolhido ? (escolhido.exata ? 'detectada' : 'valor_divergente') : 'nao_encontrada',
      transacao: escolhido?.transacao ?? null,
      valorCobrado: escolhido ? Number(escolhido.transacao.valor ?? 0) : null,
      diferenca: escolhido ? escolhido.diferenca : null,
      descartadas,
    })
  }

  return resultado
}

/**
 * Versão "uma transação por vez", para classificar um lançamento da fatura sem
 * montar a atribuição inteira (composição da fatura / filtro de compras). Aplica
 * as mesmas regras de nome, parcelamento e faixa de valor; quando a assinatura
 * não informa valor, cai no critério antigo (só o nome).
 */
export function transacaoEhCobrancaDeAssinatura(
  transacao: Omit<TransacaoParaMatch, 'valor'> & { valor?: number | null },
  assinaturas: { nome: string; valor?: number | null; moeda?: string | null }[]
): boolean {
  if (ehParcelada({ ...transacao, valor: Number(transacao.valor ?? 0) })) return false
  return assinaturas.some(assinatura => {
    if (aderenciaNome(assinatura.nome, transacao.descricao) === null) return false
    // Sem valor dos dois lados não dá para julgar a faixa — vale o critério
    // antigo (só o nome), sem passar a classificar tudo como "não é assinatura".
    const valorEsperado = Number(assinatura.valor ?? 0)
    if (!valorEsperado || transacao.valor == null) return true
    const diferenca = Math.abs(Number(transacao.valor) - valorEsperado)
    if (diferenca <= toleranciaDe(valorEsperado, assinatura.moeda)) return true
    return diferenca / Math.abs(valorEsperado) <= LIMITE_DIVERGENCIA
  })
}

const TEXTO_DESCARTE: Record<MotivoDescarte, string> = {
  parcelada: 'compra parcelada',
  valor_fora_da_faixa: 'valor fora do esperado',
  data_distante: 'longe do dia de cobrança',
  de_outra_assinatura: 'já contabilizada em outra assinatura',
}

export function explicarDescarte(motivo: MotivoDescarte): string {
  return TEXTO_DESCARTE[motivo]
}
