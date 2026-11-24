import { normalizarDescricaoParaHash } from '@/lib/csvparser'
import { descricoesParecidas } from '@/lib/descricaoSimilaridade'

// O NuBank descreve o mesmo estorno de formas diferentes conforme a origem:
//   'Estorno de "Ifd*Elaine Felipe da S" (iFood)'   ← extrato/CSV da fatura
//   'Estorno de compra (iFood)'                      ← lançamento avulso (API)
//   'Estorno de compra (Loja X 2x de 12x)'           ← compra parcelada
//   'Estorno de Loja X'

const SUFIXO_PARCELA = /\s*\d+x\s+de\s+\d+x\s*$/i

/**
 * Nome do estabelecimento da compra estornada, para achar a compra original.
 * No formato genérico ('Estorno de compra (iFood)') devolve só o que está entre
 * parênteses, que pode ser a plataforma e não o estabelecimento.
 */
export function extrairEstabelecimentoDoEstorno(descricao: string): string {
  const texto = descricao.trim()

  const entreAspas = texto.match(/^estorno\s+de\s+"([^"]+)"/i)
  if (entreAspas) return entreAspas[1].trim()

  const generico = texto.match(/^estorno\s+de\s+compra\s*\((.*?)\)?$/i)
  if (generico) return generico[1].replace(SUFIXO_PARCELA, '').trim()

  return texto
    .replace(/^estorno\s+de\s+/i, '')
    .replace(SUFIXO_PARCELA, '')
    .trim()
}

/** Rótulo entre parênteses no fim da descrição ('(iFood)' → 'ifood'), ou null. */
function rotuloDoEstorno(descricao: string): string | null {
  const m = descricao.trim().match(/\(([^()]*)\)\s*$/)
  if (!m) return null
  const rotulo = normalizarDescricaoParaHash(m[1].replace(SUFIXO_PARCELA, ''))
  return rotulo || null
}

/** O formato do extrato (com o estabelecimento entre aspas) é o mais específico. */
export function estornoTemEstabelecimento(descricao: string): boolean {
  return /^estorno\s+de\s+"[^"]+"/i.test(descricao.trim())
}

/**
 * Duas descrições de estorno parecem ser o MESMO estorno escrito de formas
 * diferentes: mesmo rótulo entre parênteses ('(iFood)') ou estabelecimentos
 * parecidos. Valor e data são conferidos por quem chama.
 */
export function estornosParecidos(descricaoA: string, descricaoB: string): boolean {
  const rotuloA = rotuloDoEstorno(descricaoA)
  const rotuloB = rotuloDoEstorno(descricaoB)
  if (rotuloA && rotuloB && rotuloA === rotuloB) return true

  const a = extrairEstabelecimentoDoEstorno(descricaoA)
  const b = extrairEstabelecimentoDoEstorno(descricaoB)
  return normalizarDescricaoParaHash(a) === normalizarDescricaoParaHash(b) || descricoesParecidas(a, b)
}

/** A compra `descricaoCompra` é a estornada por `descricaoEstorno`? */
export function compraDoEstorno(descricaoEstorno: string, descricaoCompra: string): boolean {
  const estabelecimento = extrairEstabelecimentoDoEstorno(descricaoEstorno)
  return (
    normalizarDescricaoParaHash(estabelecimento) === normalizarDescricaoParaHash(descricaoCompra) ||
    descricoesParecidas(estabelecimento, descricaoCompra)
  )
}
