'use client'

import { Sparkles, TrendingUp, Calendar, PieChart, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { InsightItem } from '@/lib/insightsTypes'

interface Sugestao {
  texto: string
  icone?: LucideIcon
  emoji?: string
}

const SUGESTOES_PADRAO: Sugestao[] = [
  { texto: 'Onde posso cortar gastos esse mês?', icone: TrendingUp },
  { texto: 'Quanto sobrou depois de tudo?', icone: Wallet },
  { texto: 'Tem alguma conta vencendo?', icone: Calendar },
  { texto: 'Qual categoria saiu do padrão?', icone: PieChart },
]

const SUGESTOES_RAPIDAS = [
  'Quem gastou mais, Matheus ou Jeniffer?',
  'Quanto gastei com iFood nos últimos 3 meses?',
  'Quais parcelamentos ainda estão abertos?',
  'Dá para cancelar alguma assinatura?',
  'Como foi minha fatura vs o mês passado?',
]

/** Transforma insights reais do usuário em perguntas prontas. */
function sugestoesDeInsights(insights: InsightItem[]): Sugestao[] {
  return insights.slice(0, 4).map(i => ({ texto: `Me explique: ${i.titulo}`, emoji: i.icone }))
}

export function ChatEmptyState({
  insights,
  onEscolher,
}: {
  insights: InsightItem[]
  onEscolher: (texto: string) => void
}) {
  const dinamicas = sugestoesDeInsights(insights)
  const principais = dinamicas.length >= 2 ? dinamicas : SUGESTOES_PADRAO

  return (
    <section className="flex flex-col items-center justify-center min-h-full py-8 gap-6 page-enter">
      <div className="relative">
        <div className="w-[72px] h-[72px] rounded-3xl bg-gradient-to-br from-violet-500 via-indigo-500 to-indigo-600 flex items-center justify-center shadow-float">
          <Sparkles className="w-9 h-9 text-white" />
        </div>
        <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 border-2 border-white dark:border-gray-900 rounded-full" />
      </div>

      <div className="text-center space-y-1.5 px-2">
        <h2 className="font-bold text-gray-800 dark:text-gray-100 text-base tracking-tight text-balance">
          Pergunte o que quiser sobre o seu dinheiro
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed text-balance max-w-[300px] mx-auto">
          Consulto suas compras, contas, receitas, assinaturas e investimentos reais para responder com números.
        </p>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Conectado aos seus dados</span>
      </div>

      <div className="w-full grid grid-cols-2 gap-2.5">
        {principais.map(({ texto, icone: Icone, emoji }) => (
          <button
            key={texto}
            onClick={() => onEscolher(texto)}
            className="card-3d text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3.5 shadow-card group transition-colors duration-200 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 dark:hover:border-primary-700"
          >
            <span className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-900/40 flex items-center justify-center mb-2.5 transition-colors duration-200 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/60 text-sm leading-none">
              {Icone ? <Icone className="w-4 h-4 text-primary-500 dark:text-primary-400" /> : emoji}
            </span>
            <span className="block text-xs text-gray-600 dark:text-gray-400 leading-snug font-medium">{texto}</span>
          </button>
        ))}
      </div>

      <div className="w-full flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {SUGESTOES_RAPIDAS.map(s => (
          <button
            key={s}
            onClick={() => onEscolher(s)}
            className="shrink-0 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full px-3.5 py-2 border border-transparent transition-colors duration-200 hover:bg-primary-100 hover:text-primary-700 hover:border-primary-200 dark:hover:bg-primary-900/40 dark:hover:text-primary-400 dark:hover:border-primary-700 whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}
