export const CATEGORIAS_PADRAO = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet', 'Outros',
]

export function normalizarCategorias(categorias: string[]): string[] {
  const unicas = Array.from(new Set(categorias.map(c => c.trim()).filter(Boolean)))
  return unicas.length > 0 ? unicas : CATEGORIAS_PADRAO
}

export function parseCategoriasConfig(valor?: string | null): string[] {
  if (!valor) return CATEGORIAS_PADRAO

  try {
    const parsed = JSON.parse(valor)
    if (Array.isArray(parsed)) {
      return normalizarCategorias(parsed.filter((item): item is string => typeof item === 'string'))
    }
  } catch {
    const split = valor.split(',').map(item => item.trim()).filter(Boolean)
    if (split.length > 0) return normalizarCategorias(split)
  }

  return CATEGORIAS_PADRAO
}
