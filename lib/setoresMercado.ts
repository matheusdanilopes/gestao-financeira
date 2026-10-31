// Setores do mercado para organizar a Lista de Mercado.
// O setor de cada item fica na coluna `category` de `lista_mercado_itens`:
// é detectado automaticamente pelo nome ao adicionar e pode ser trocado
// manualmente na tela.

import { normalizarNomeItem } from './listaMercadoDuplicados'

export const SETORES = [
  'Hortifruti',
  'Padaria',
  'Açougue',
  'Frios e Laticínios',
  'Mercearia',
  'Bebidas',
  'Congelados',
  'Higiene',
  'Limpeza',
  'Pet',
  'Outros',
] as const

export type Setor = (typeof SETORES)[number]

export const SETOR_PADRAO: Setor = 'Outros'

export const SETOR_EMOJI: Record<Setor, string> = {
  'Hortifruti': '🥬',
  'Padaria': '🍞',
  'Açougue': '🥩',
  'Frios e Laticínios': '🧀',
  'Mercearia': '🥫',
  'Bebidas': '🥤',
  'Congelados': '🧊',
  'Higiene': '🧴',
  'Limpeza': '🧽',
  'Pet': '🐾',
  'Outros': '📦',
}

// Categorias antigas (API externa) → setores atuais
const CATEGORIAS_LEGADAS: Record<string, Setor> = {
  'proteinas': 'Açougue',
  'carboidratos': 'Mercearia',
  'laticinios': 'Frios e Laticínios',
  'temperos': 'Mercearia',
}

// Palavras-chave por setor (sem acento, minúsculas). Em caso de várias
// correspondências vence a mais longa: "leite condensado" (Mercearia)
// ganha de "leite" (Frios e Laticínios); "agua sanitaria" (Limpeza) ganha
// de "agua" (Bebidas).
const PALAVRAS: Record<Exclude<Setor, 'Outros'>, string[]> = {
  'Hortifruti': [
    'alface', 'rucula', 'agriao', 'couve', 'repolho', 'espinafre', 'brocolis', 'couve flor',
    'acelga', 'almeirao', 'chicoria', 'salsa', 'salsinha', 'cebolinha', 'cheiro verde', 'coentro',
    'manjericao', 'hortela', 'alecrim fresco', 'tomate', 'cebola', 'alho', 'batata', 'batata doce',
    'mandioca', 'aipim', 'macaxeira', 'inhame', 'cenoura', 'beterraba', 'abobrinha', 'abobora',
    'chuchu', 'berinjela', 'pimentao', 'pepino', 'quiabo', 'jilo', 'vagem', 'milho verde', 'gengibre',
    'cogumelo', 'champignon fresco', 'banana', 'maca', 'pera', 'uva', 'laranja', 'limao', 'limoes',
    'tangerina', 'mexerica', 'bergamota', 'mamao', 'melao', 'melancia', 'abacaxi', 'manga', 'morango',
    'kiwi', 'abacate', 'goiaba', 'maracuja', 'caqui', 'ameixa fresca', 'pessego', 'coco verde',
    'fruta', 'frutas', 'verdura', 'verduras', 'legume', 'legumes', 'salada',
  ],
  'Padaria': [
    'pao', 'paes', 'pao frances', 'pao de forma', 'pao de queijo assado', 'bisnaguinha', 'baguete',
    'croissant', 'bolo', 'rosca', 'sonho', 'torrada', 'broa', 'pao de mel', 'pao sirio', 'ciabatta',
  ],
  'Açougue': [
    'carne', 'carne moida', 'patinho', 'alcatra', 'picanha', 'maminha', 'fraldinha', 'contra file',
    'file mignon', 'acem', 'musculo', 'costela', 'cupim', 'coxao mole', 'coxao duro', 'lagarto',
    'paleta', 'bife', 'frango', 'peito de frango', 'coxa', 'sobrecoxa', 'asa', 'coracao de frango',
    'file de frango', 'porco', 'lombo', 'pernil', 'bisteca', 'costelinha', 'linguica', 'linguica toscana',
    'calabresa', 'bacon', 'toucinho', 'peixe', 'tilapia', 'salmao', 'merluza', 'pescada', 'sardinha fresca',
    'camarao', 'figado', 'carne seca', 'charque', 'hamburguer',
  ],
  'Frios e Laticínios': [
    'leite', 'queijo', 'mussarela', 'muçarela', 'mucarela', 'prato', 'parmesao', 'requeijao',
    'cream cheese', 'ricota', 'cottage', 'queijo minas', 'manteiga', 'margarina', 'iogurte', 'coalhada',
    'nata', 'presunto', 'apresuntado', 'mortadela', 'salame', 'peito de peru', 'blanquet', 'ovo', 'ovos',
    'salsicha', 'leite fermentado', 'yakult', 'danone', 'petit suisse', 'chantilly',
  ],
  'Mercearia': [
    'arroz', 'feijao', 'macarrao', 'espaguete', 'lasanha', 'farinha', 'farinha de trigo', 'farinha de mandioca',
    'farofa', 'fuba', 'amido', 'maisena', 'aveia', 'granola', 'cereal', 'sucrilhos', 'acucar', 'adocante',
    'sal', 'oleo', 'azeite', 'vinagre', 'molho', 'molho de tomate', 'extrato de tomate', 'catchup', 'ketchup',
    'mostarda', 'maionese', 'tempero', 'temperos', 'caldo', 'caldo knorr', 'sazon', 'oregano', 'pimenta do reino',
    'colorau', 'cominho', 'canela', 'louro', 'cafe', 'cha', 'achocolatado', 'nescau', 'toddy', 'leite em po',
    'leite condensado', 'creme de leite', 'doce de leite', 'gelatina', 'fermento', 'chocolate', 'bombom',
    'biscoito', 'bolacha', 'salgadinho', 'batata palha', 'pipoca', 'amendoim', 'castanha', 'atum', 'sardinha',
    'milho', 'ervilha', 'seleta', 'palmito', 'azeitona', 'pepino em conserva', 'geleia', 'mel', 'pao de queijo mistura',
    'mistura para bolo', 'lentilha', 'grao de bico', 'quinoa', 'tapioca', 'goma', 'massa', 'miojo', 'lamen',
    'pure', 'sopa', 'granulado', 'leite de coco', 'coco ralado', 'uva passa', 'barra de cereal',
  ],
  'Bebidas': [
    'agua', 'agua com gas', 'agua mineral', 'refrigerante', 'coca', 'coca cola', 'guarana', 'suco', 'nectar',
    'cerveja', 'vinho', 'espumante', 'vodka', 'cachaca', 'whisky', 'gin', 'energetico', 'isotonico',
    'gatorade', 'cha gelado', 'agua de coco', 'refri', 'kombucha',
  ],
  'Congelados': [
    'sorvete', 'picole', 'acai', 'pizza', 'pizza congelada', 'lasanha congelada', 'pao de queijo', 'nuggets',
    'empanado', 'batata frita', 'batata congelada', 'hamburguer congelado', 'polpa', 'polpa de fruta',
    'gelo', 'congelado', 'congelados', 'legumes congelados', 'ervilha congelada', 'lasanha pronta',
  ],
  'Higiene': [
    'papel higienico', 'sabonete', 'shampoo', 'xampu', 'condicionador', 'creme dental', 'pasta de dente',
    'escova de dente', 'fio dental', 'enxaguante bucal', 'desodorante', 'absorvente', 'fralda', 'lenco umedecido',
    'cotonete', 'algodao', 'aparelho de barbear', 'gilete', 'barbeador', 'creme de barbear', 'hidratante',
    'protetor solar', 'repelente', 'curativo', 'band aid', 'esmalte', 'acetona', 'perfume', 'creme para cabelo',
  ],
  'Limpeza': [
    'detergente', 'sabao', 'sabao em po', 'sabao liquido', 'lava roupas', 'amaciante', 'agua sanitaria',
    'cloro', 'alvejante', 'desinfetante', 'multiuso', 'limpador', 'veja', 'lustra moveis', 'esponja',
    'bombril', 'palha de aco', 'saco de lixo', 'saco lixo', 'papel toalha', 'pano de chao', 'pano de prato',
    'flanela', 'vassoura', 'rodo', 'balde', 'luva', 'inseticida', 'aromatizador', 'tira manchas', 'limpa vidro',
    'pedra sanitaria', 'guardanapo', 'papel aluminio', 'filme plastico', 'filtro de cafe', 'fosforo', 'vela',
  ],
  'Pet': [
    'racao', 'petisco', 'areia de gato', 'areia sanitaria', 'sache', 'osso', 'tapete higienico',
    'antipulgas', 'cachorro', 'gato',
  ],
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Pré-compila: cada palavra-chave casa como palavra inteira, aceitando plural simples
const REGRAS: { setor: Setor; tamanho: number; re: RegExp }[] = Object.entries(PALAVRAS).flatMap(
  ([setor, palavras]) =>
    palavras.map(p => {
      const kw = normalizarNomeItem(p)
      return {
        setor: setor as Setor,
        tamanho: kw.length,
        re: new RegExp(`(^|[^a-z0-9])${escaparRegex(kw)}(s|es)?($|[^a-z0-9])`),
      }
    }),
)

/** Detecta o setor de um item pelo nome. Retorna 'Outros' se não reconhecer. */
export function detectarSetor(nome: string): Setor {
  const alvo = normalizarNomeItem(nome)
  if (!alvo) return SETOR_PADRAO
  let melhor: { setor: Setor; tamanho: number } | null = null
  for (const r of REGRAS) {
    if (r.tamanho > (melhor?.tamanho ?? 0) && r.re.test(alvo)) {
      melhor = { setor: r.setor, tamanho: r.tamanho }
    }
  }
  return melhor?.setor ?? SETOR_PADRAO
}

/** Converte um valor de categoria (atual ou legado) para um setor válido, ou null. */
export function normalizarSetor(categoria: string | null | undefined): Setor | null {
  if (!categoria) return null
  const chave = normalizarNomeItem(categoria)
  const atual = SETORES.find(s => normalizarNomeItem(s) === chave)
  if (atual) return atual
  return CATEGORIAS_LEGADAS[chave] ?? null
}

/**
 * Setor exibido para um item. Usa o setor salvo; itens sem setor (ou em
 * 'Outros', o padrão do banco) caem na detecção pelo nome.
 */
export function setorDoItem(item: { nome: string; category?: string | null }): Setor {
  const salvo = normalizarSetor(item.category)
  if (salvo && salvo !== SETOR_PADRAO) return salvo
  return detectarSetor(item.nome)
}

/** Agrupa itens por setor, na ordem de SETORES, mantendo a ordem original dentro de cada grupo. */
export function agruparPorSetor<T extends { nome: string; category?: string | null }>(
  itens: readonly T[],
): { setor: Setor; itens: T[] }[] {
  const mapa = new Map<Setor, T[]>()
  for (const item of itens) {
    const setor = setorDoItem(item)
    const lista = mapa.get(setor)
    if (lista) lista.push(item)
    else mapa.set(setor, [item])
  }
  return SETORES.filter(s => mapa.has(s)).map(setor => ({ setor, itens: mapa.get(setor)! }))
}
