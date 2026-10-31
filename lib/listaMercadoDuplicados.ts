// Detecção de itens duplicados na Lista de Mercado.
// Compara nomes ignorando maiúsculas/minúsculas, acentos e espaços extras
// ("Feijão", " feijao ", "FEIJÃO" são o mesmo item).

export function normalizarNomeItem(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function encontrarDuplicado<T extends { nome: string }>(
  itens: readonly T[],
  nome: string,
): T | undefined {
  const alvo = normalizarNomeItem(nome)
  if (!alvo) return undefined
  return itens.find(i => normalizarNomeItem(i.nome) === alvo)
}

export function mensagemDuplicado(item: { nome: string; comprado: boolean }): string {
  return item.comprado
    ? `"${item.nome}" já está na lista (marcado como comprado)`
    : `"${item.nome}" já está na lista`
}
