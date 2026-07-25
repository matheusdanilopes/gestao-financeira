import { normalizarDescricaoParaHash } from '@/lib/csvparser'

// Comprimento mínimo (após normalização) para considerar duas descrições "parecidas".
// Evita falso positivo em títulos curtos/genéricos (ex.: "B" também seria prefixo de
// "B1 - Parcela 1/6"). Mesmo limiar historicamente usado em lib/validacaoFatura.ts.
const COMPRIMENTO_MIN = 8

// Tolerância de edição: exatamente 1 caractere alterado — o suficiente para cobrir
// uma letra ou pontuação removida/trocada (o caso relatado), sem arriscar aproximar
// descrições curtas e genéricas que só diferem por um contador (ex.: "B1 - Parcela
// 1/6" vs "B2 - Parcela 2/6", que já divergem em 2 posições e devem ficar de fora).
const DIST_MAX_EDICAO = 1

function distanciaLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let anterior = new Array(b.length + 1)
  let atual = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) anterior[j] = j

  for (let i = 1; i <= a.length; i++) {
    atual[0] = i
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      atual[j] = Math.min(
        anterior[j] + 1,       // remoção
        atual[j - 1] + 1,      // inserção
        anterior[j - 1] + custo // substituição
      )
    }
    ;[anterior, atual] = [atual, anterior]
  }

  return anterior[b.length]
}

// Extrai o número da parcela no padrão "X/Y" da descrição (ex.: "Parcela 2/2").
function extrairParcela(descricaoNormalizada: string): { atual: number; total: number } | null {
  const m = descricaoNormalizada.match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return null
  return { atual: parseInt(m[1], 10), total: parseInt(m[2], 10) }
}

// Normaliza a descrição substituindo o número da parcela atual por um marcador,
// mantendo o total fixo — permite comparar "Loja X 1/12" e "Loja X 2/12" como a
// mesma compra, ao contrário de descricoesParecidas() (que as trata como diferentes).
export function normalizarDescricaoSemParcela(descricao: string): string {
  const normalizada = normalizarDescricaoParaHash(descricao)
  return normalizada.replace(/\d+(\s*\/\s*\d+)/, '#$1')
}

/**
 * Compara duas descrições de transação e diz se provavelmente são "a mesma compra",
 * tolerando as pequenas variações que o Nubank/emissores costumam introduzir entre
 * exportações sucessivas do mesmo extrato: truncamento do título (prefixo) ou uma
 * letra/pontuação removida ou trocada em qualquer posição (distância de edição).
 */
export function descricoesParecidas(descricaoA: string, descricaoB: string): boolean {
  const a = normalizarDescricaoParaHash(descricaoA)
  const b = normalizarDescricaoParaHash(descricaoB)

  if (a === b) return true

  // Parcelas diferentes (ex.: "Parcela 1/2" vs "Parcela 2/2") nunca são a mesma
  // compra, mesmo quando o número da parcela é o único caractere que muda — caso
  // contrário a tolerância de 1 caractere de edição abaixo confundiria as duas.
  const parcelaA = extrairParcela(a)
  const parcelaB = extrairParcela(b)
  if (parcelaA && parcelaB && (parcelaA.atual !== parcelaB.atual || parcelaA.total !== parcelaB.total)) {
    return false
  }

  const minLen = Math.min(a.length, b.length)
  if (minLen < COMPRIMENTO_MIN) return false

  if (a.startsWith(b) || b.startsWith(a)) return true

  // Corte rápido: distância de edição nunca é menor que a diferença de comprimento.
  if (Math.abs(a.length - b.length) > DIST_MAX_EDICAO) return false

  return distanciaLevenshtein(a, b) <= DIST_MAX_EDICAO
}
