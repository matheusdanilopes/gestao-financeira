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
