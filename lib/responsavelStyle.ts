// Tokens de identidade visual por responsável — reaproveitados por qualquer tela
// que precise diferenciar Matheus/Jeniffer/Conjunto (parcelamentos, simulador, etc.)

export const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Conjunto'] as const
export type Responsavel = typeof RESPONSAVEIS[number]

// Reaproveita os tokens de marca já definidos em tailwind.config.js (matheus/jeniffer).
// "Conjunto" não é uma pessoa, então usa um neutro em vez de inventar uma cor nova —
// violet já é a cor-assinatura de Investimentos/IA em outras telas do app.
export const RESPONSAVEL_STYLE: Record<Responsavel, { texto: string; iconBg: string }> = {
  Matheus:  { texto: 'text-matheus dark:text-blue-400',    iconBg: 'bg-matheus-light dark:bg-blue-900/20' },
  Jeniffer: { texto: 'text-jeniffer dark:text-pink-400',   iconBg: 'bg-jeniffer-light dark:bg-pink-900/20' },
  Conjunto: { texto: 'text-slate-600 dark:text-slate-300', iconBg: 'bg-slate-100 dark:bg-slate-800/40' },
}

// Paleta das barras de fatura do Dashboard. Antes esses tons ficavam repetidos
// inline em três blocos JSX quase idênticos (Matheus azul, Jeniffer rosa, Conjunto
// roxo); agora o bloco é um só e escolhe a paleta pelo responsável.
//
// ATENÇÃO: as classes precisam aparecer aqui como strings literais completas. O
// Tailwind varre o código-fonte procurando nomes de classe, então algo como
// `bg-${cor}-500` some no build de produção e a barra fica transparente.
export interface ResponsavelBarra {
  ponto: string
  trilho: string
  segExistente: string
  segNovo: string
  segAssinatura: string
  badge: string
  borda: string
  tileFundo: string
  tileTexto: string
}

const BARRA_MATHEUS: ResponsavelBarra = {
  ponto: 'bg-blue-500',
  trilho: 'bg-blue-100 dark:bg-blue-900/30',
  segExistente: 'bg-blue-800',
  segNovo: 'bg-blue-500',
  segAssinatura: 'bg-blue-300',
  badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  borda: 'border-l-blue-400',
  tileFundo: 'bg-blue-50',
  tileTexto: 'text-blue-600',
}

const BARRA_JENIFFER: ResponsavelBarra = {
  ponto: 'bg-pink-500',
  trilho: 'bg-pink-100 dark:bg-pink-900/30',
  segExistente: 'bg-pink-800',
  segNovo: 'bg-pink-500',
  segAssinatura: 'bg-pink-300',
  badge: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
  borda: 'border-l-pink-400',
  tileFundo: 'bg-pink-50',
  tileTexto: 'text-pink-600',
}

const BARRA_CONJUNTO: ResponsavelBarra = {
  ponto: 'bg-purple-500',
  trilho: 'bg-purple-100 dark:bg-purple-900/30',
  segExistente: 'bg-purple-800',
  segNovo: 'bg-purple-500',
  segAssinatura: 'bg-purple-300',
  badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  borda: 'border-l-purple-400',
  tileFundo: 'bg-purple-50',
  tileTexto: 'text-purple-600',
}

const BARRA_PADRAO: ResponsavelBarra = {
  ponto: 'bg-slate-400',
  trilho: 'bg-slate-100 dark:bg-slate-800/40',
  segExistente: 'bg-slate-700',
  segNovo: 'bg-slate-500',
  segAssinatura: 'bg-slate-300',
  badge: 'bg-slate-100 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300',
  borda: 'border-l-slate-400',
  tileFundo: 'bg-slate-50',
  tileTexto: 'text-slate-600',
}

const RESPONSAVEL_BARRA: Record<Responsavel, ResponsavelBarra> = {
  Matheus: BARRA_MATHEUS,
  Jeniffer: BARRA_JENIFFER,
  Conjunto: BARRA_CONJUNTO,
}

/** Paleta do responsável, com um neutro para nomes fora da lista conhecida. */
export function estiloResponsavel(responsavel: string | null | undefined): ResponsavelBarra {
  return RESPONSAVEL_BARRA[responsavel as Responsavel] ?? BARRA_PADRAO
}

/** Ordem de exibição: usuário logado primeiro, depois a outra pessoa, Conjunto por último. */
export function ordenarResponsaveis(responsaveis: string[], usuarioLogado: string): string[] {
  const peso = (r: string) => {
    if (r === usuarioLogado) return 0
    if (r === 'Conjunto') return 2
    return RESPONSAVEIS.includes(r as Responsavel) ? 1 : 3
  }
  return [...responsaveis].sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, 'pt-BR'))
}
