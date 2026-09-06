'use client'

import { Sparkles, TrendingUp, Calendar, PieChart, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { InsightItem } from '@/lib/insightsTypes'

/**
 * Boas-vindas do chat.
 *
 * Precisa caber inteiro entre o cabeçalho e o campo de digitação, sem rolar:
 * é a primeira coisa que o usuário vê e um avatar cortado no topo passa a
 * impressão de tela quebrada. Por isso nada aqui tem altura fixa generosa —
 * o ritmo vertical é curto e os rótulos são limitados a duas linhas.
 */

interface Sugestao {
  /** Texto curto exibido no card. */
  rotulo: string
  /** Pergunta realmente enviada ao assistente. */
  pergunta: string
  icone?: LucideIcon
  emoji?: string
}

const SUGESTOES_PADRAO: Sugestao[] = [
  { rotulo: 'Onde posso cortar gastos?', pergunta: 'Onde posso cortar gastos esse mês?', icone: TrendingUp },
  { rotulo: 'Quanto sobrou este mês?', pergunta: 'Quanto sobrou depois de tudo neste mês?', icone: Wallet },
  { rotulo: 'Tem conta vencendo?', pergunta: 'Tem alguma conta vencendo ou atrasada?', icone: Calendar },
  { rotulo: 'Categoria fora do padrão', pergunta: 'Qual categoria saiu do padrão neste mês?', icone: PieChart },
]

const SUGESTOES_RAPIDAS = [
  'Quem gastou mais no cartão?',
  'Quanto gastei com iFood?',
  'Parcelamentos em aberto',
  'Dá para cancelar alguma assinatura?',
  'Como está vs o mês passado?',
]

/**
 * Insights reais viram perguntas. O card mostra só o título do insight — o
 * prefixo "Me explique:" ia junto no rótulo e empurrava todo card para três
 * linhas, que era o que estourava a altura da tela.
 */
function sugestoesDeInsights(insights: InsightItem[]): Sugestao[] {
  return insights.slice(0, 4).map(i => ({
    rotulo: i.titulo,
    pergunta: `Me explique: ${i.titulo}`,
    emoji: i.icone,
  }))
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
    <section className="flex flex-col items-center [justify-content:safe_center] min-h-full gap-3.5 page-enter">
      <div className="relative shrink-0">
        <div className="w-14 h-14 [@media(max-height:680px)]:w-11 [@media(max-height:680px)]:h-11 rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-indigo-600 flex items-center justify-center shadow-float transition-all">
          <Sparkles className="w-7 h-7 [@media(max-height:680px)]:w-5 [@media(max-height:680px)]:h-5 text-white" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 border-2 border-gray-50 dark:border-gray-900 rounded-full" />
      </div>

      <div className="text-center space-y-1 px-2">
        <h2 className="font-bold text-gray-800 dark:text-gray-100 text-[15px] tracking-tight text-balance">
          Pergunte o que quiser sobre o seu dinheiro
        </h2>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-snug text-balance max-w-[290px] mx-auto [@media(max-height:680px)]:hidden">
          Consulto suas compras, contas e investimentos reais para responder com números.
        </p>
      </div>

      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 [@media(max-height:600px)]:hidden">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Conectado aos seus dados</span>
      </div>

      <div className="w-full grid grid-cols-2 gap-2">
        {principais.map(({ rotulo, pergunta, icone: Icone, emoji }) => (
          <button
            key={rotulo}
            onClick={() => onEscolher(pergunta)}
            title={rotulo}
            className="card-3d text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-3 py-2.5 shadow-card group transition-colors duration-200 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 dark:hover:border-primary-700"
          >
            <span className="w-6 h-6 rounded-lg bg-primary-50 dark:bg-primary-900/40 flex items-center justify-center mb-1.5 transition-colors duration-200 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/60 text-[13px] leading-none">
              {Icone ? <Icone className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" /> : emoji}
            </span>
            <span className="block text-[11px] text-gray-600 dark:text-gray-400 leading-snug font-medium line-clamp-2">
              {rotulo}
            </span>
          </button>
        ))}
      </div>

      {/* Sangra até a borda: um chip cortado no meio da tela parece bug, na
          borda parece o que é — uma lista que rola. */}
      <div className="w-full -mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {SUGESTOES_RAPIDAS.map(s => (
          <button
            key={s}
            onClick={() => onEscolher(s)}
            className="shrink-0 text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full px-3 py-1.5 border border-transparent transition-colors duration-200 hover:bg-primary-100 hover:text-primary-700 hover:border-primary-200 dark:hover:bg-primary-900/40 dark:hover:text-primary-400 dark:hover:border-primary-700 whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}
