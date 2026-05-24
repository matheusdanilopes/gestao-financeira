// Categorias padrão unificadas — compras, despesas, receitas e assinaturas
export const CATEGORIAS_PADRAO = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet',
  // Assinatura-específicas incorporadas ao conjunto universal
  'Streaming', 'Música', 'Jogos', 'Segurança',
  'Outros',
]

// Categorias legadas usadas pelo módulo de Assinaturas antes da unificação.
// Mantidas para compatibilidade retroativa — não remover.
export const CATEGORIAS_ASSINATURAS_LEGADO = [
  'Streaming', 'Música', 'Software', 'Saúde', 'Educação', 'Jogos', 'Segurança', 'Outros',
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

// ── Utilitários de migração por aproximação ──────────────────────────────────

export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Mapeamento direto de categorias legadas de assinaturas → categoria unificada.
// 'Software' é o único caso de renomeação real; demais já existem no conjunto unificado.
const MAPA_MIGRACAO_LEGADO: Record<string, string> = {
  software:   'Tecnologia', // melhor aproximação para Software → Tecnologia
  streaming:  'Streaming',
  musica:     'Música',
  saude:      'Saúde',
  educacao:   'Educação',
  jogos:      'Jogos',
  seguranca:  'Segurança',
  outros:     'Outros',
}

// Mapeamento por palavras-chave no nome do serviço.
// Threshold mínimo de confiança: 0.85
const MAPA_PALAVRAS_CHAVE: Array<{ termos: string[]; categoria: string }> = [
  {
    termos: ['netflix', 'hbo', 'disney', 'prime video', 'amazon prime', 'apple tv', 'youtube premium',
             'globoplay', 'paramount', 'star+', 'star plus', 'crunchyroll', 'mubi', 'looke',
             'telecine', 'claro video', 'oi play', 'sky+', 'dazn', 'fuboTV'],
    categoria: 'Streaming',
  },
  {
    termos: ['spotify', 'deezer', 'apple music', 'youtube music', 'tidal', 'amazon music', 'napster'],
    categoria: 'Música',
  },
  {
    termos: ['uber', 'cabify', '99 taxi', '99pop', 'moovit', 'bom pra credito transporte'],
    categoria: 'Transporte',
  },
  {
    termos: ['ifood', 'rappi', 'uber eats', 'james delivery'],
    categoria: 'Alimentação',
  },
  {
    termos: ['duolingo', 'coursera', 'udemy', 'alura', 'rocketseat', 'dio', 'datacamp',
             'pluralsight', 'linkedin learning', 'skillshare', 'domestika', 'origamid'],
    categoria: 'Educação',
  },
  {
    termos: ['office', 'microsoft 365', 'adobe', 'github', 'jira', 'notion', 'figma',
             'sketch', 'canva', 'dropbox', 'google workspace', 'g suite', 'slack',
             'zoom', 'monday', 'trello', 'asana', '1password', 'bitwarden', 'todoist'],
    categoria: 'Tecnologia',
  },
  {
    termos: ['lastpass', 'nordvpn', 'expressvpn', 'surfshark', 'avg', 'avast',
             'norton', 'mcafee', 'kaspersky', 'malwarebytes', 'vpn', 'bitdefender'],
    categoria: 'Segurança',
  },
  {
    termos: ['xbox', 'playstation', 'ps plus', 'nintendo', 'steam', 'ea play',
             'game pass', 'geforce now', 'ubisoft+', 'epic games'],
    categoria: 'Jogos',
  },
  {
    termos: ['academia', 'gym', 'gympass', 'totalpass', 'yoga', 'meditacao', 'headspace',
             'calm', 'plano saude', 'unimed', 'hapvida', 'sulamerica', 'amil',
             'bradesco saude', 'prevent senior'],
    categoria: 'Saúde',
  },
]

export interface ResultadoAproximacao {
  categoria: string
  confianca: number
  motivo: 'exato' | 'mapa_legado' | 'palavra_chave' | 'sem_correspondencia'
}

/**
 * Tenta mapear uma assinatura para a categoria unificada correspondente.
 * Retorna confiança 0.0 se nenhuma correspondência for encontrada,
 * mantendo a categoria original (não sobrescreve dados incertos).
 */
export function aproximarCategoriaAssinatura(
  nomeServico: string,
  categoriaAtual: string,
  categoriasDisponiveis: string[],
): ResultadoAproximacao {
  const categoriaAtualNorm = normalizarTexto(categoriaAtual)

  // 1. Categoria já existe no conjunto unificado — sem necessidade de migração
  const matchExato = categoriasDisponiveis.find(
    c => normalizarTexto(c) === categoriaAtualNorm,
  )
  if (matchExato) {
    return { categoria: matchExato, confianca: 1.0, motivo: 'exato' }
  }

  // 2. Mapa de migração de categorias legadas (ex: Software → Tecnologia)
  const migracao = MAPA_MIGRACAO_LEGADO[categoriaAtualNorm]
  if (migracao && categoriasDisponiveis.includes(migracao)) {
    return { categoria: migracao, confianca: 0.90, motivo: 'mapa_legado' }
  }

  // 3. Correspondência por palavra-chave no nome do serviço (threshold ≥ 0.85)
  const nomeNorm = normalizarTexto(nomeServico)
  for (const { termos, categoria } of MAPA_PALAVRAS_CHAVE) {
    const match = termos.some(t => nomeNorm.includes(normalizarTexto(t)))
    if (match && categoriasDisponiveis.includes(categoria)) {
      return { categoria, confianca: 0.85, motivo: 'palavra_chave' }
    }
  }

  // 4. Sem correspondência suficiente — mantém categoria original
  return { categoria: categoriaAtual, confianca: 0.0, motivo: 'sem_correspondencia' }
}
