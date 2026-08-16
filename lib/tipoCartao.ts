// Fonte única da convenção que associa uma linha de `planejamento` a um cartão.
//
// A tabela `planejamento` não tem coluna de cartão — a associação vive no texto de
// `item`, por prefixo:
//
//   [PRINCIPAL] <nome>  → cartão principal (a fatura do NuBank)
//   [CARTAO1] <nome>    → cartão extra 1
//   [CARTAO2] <nome>    → cartão extra 2
//
// Antes o principal era identificado pelos nomes literais "NuBank Matheus",
// "NuBank Jeniffer", "NuBank Jeniffer Conjunto" e "NuBank Conjunto", repetidos em
// ~8 arquivos com regras de comparação ligeiramente diferentes entre si. Esses nomes
// foram migrados para o prefixo, mas continuam sendo reconhecidos aqui como fallback:
// meses históricos e linhas criadas fora do app não passam pela migração.

export const PREFIXO_PRINCIPAL = '[PRINCIPAL] '
export const PREFIXO_CARTAO_1 = '[CARTAO1] '
export const PREFIXO_CARTAO_2 = '[CARTAO2] '

export const TIPOS_CARTAO = ['principal', 'cartao1', 'cartao2'] as const
export type TipoCartao = typeof TIPOS_CARTAO[number]

const PREFIXO_POR_TIPO: Record<TipoCartao, string> = {
  principal: PREFIXO_PRINCIPAL,
  cartao1: PREFIXO_CARTAO_1,
  cartao2: PREFIXO_CARTAO_2,
}

/** Prefixo (com o espaço final) do tipo de cartão. */
export function prefixoDoTipo(tipo: TipoCartao): string {
  return PREFIXO_POR_TIPO[tipo]
}

/**
 * O cartão ao qual uma linha de planejamento pertence, ou `null` quando é uma
 * despesa comum (conta fixa, extra…). Aceita o prefixo com ou sem o espaço, já que
 * parte do código antigo gravou/comparou sem ele.
 */
export function tipoCartaoPorItem(item: string | null | undefined): TipoCartao | null {
  const texto = String(item ?? '').trim()
  if (texto.startsWith(PREFIXO_PRINCIPAL.trim())) return 'principal'
  if (texto.startsWith(PREFIXO_CARTAO_1.trim())) return 'cartao1'
  if (texto.startsWith(PREFIXO_CARTAO_2.trim())) return 'cartao2'
  // Compatibilidade com os nomes anteriores à migração ("NuBank Matheus" etc.).
  if (/^nubank\b/i.test(texto)) return 'principal'
  return null
}

/** Aplica o prefixo do cartão a um nome já limpo. `null`/'' devolve o nome como está. */
export function aplicarPrefixoCartao(item: string, tipo: TipoCartao | null | ''): string {
  if (!tipo) return item
  return `${PREFIXO_POR_TIPO[tipo]}${item}`
}

/** Nome exibível da linha, sem o prefixo de cartão. */
export function removerPrefixoCartao(item: string | null | undefined): string {
  let texto = String(item ?? '')
  for (const prefixo of Object.values(PREFIXO_POR_TIPO)) {
    if (texto.startsWith(prefixo)) return texto.slice(prefixo.length).trim()
    // Variante sem o espaço, gravada por versões antigas.
    const semEspaco = prefixo.trim()
    if (texto.startsWith(semEspaco)) return texto.slice(semEspaco.length).trim()
  }
  // Linhas legadas: "NuBank Jeniffer Conjunto" → "Jeniffer Conjunto".
  texto = texto.replace(/^nubank\s+/i, '')
  return texto.trim()
}

/** A linha representa o pagamento de uma fatura de cartão (qualquer um dos três)? */
export function ehLinhaDeCartao(item: string | null | undefined): boolean {
  return tipoCartaoPorItem(item) !== null
}

/** A linha é uma receita (`Receita Total` ou `[RECEITA] …`)? */
export function ehLinhaDeReceita(item: string | null | undefined): boolean {
  const texto = String(item ?? '').trim()
  return texto === 'Receita Total' || texto.startsWith('[RECEITA]')
}

/**
 * A linha é uma despesa "real" — nem receita, nem quitação de fatura. As linhas de
 * cartão são excluídas porque o gasto delas já entra pelas transações importadas;
 * contá-las como despesa fixa dobraria o valor.
 */
export function ehDespesaReal(item: string | null | undefined): boolean {
  return !ehLinhaDeReceita(item) && !ehLinhaDeCartao(item)
}
