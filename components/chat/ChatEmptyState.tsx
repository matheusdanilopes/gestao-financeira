'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Calendar, PieChart, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RoboAvatar, type HumorRobo } from './RoboAvatar'
import { saudacaoDoHorario } from '@/lib/chatSugestoes'

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
  icone: LucideIcon
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

export function ChatEmptyState({
  onEscolher,
  nome,
  humor = 'idle',
}: {
  onEscolher: (texto: string) => void
  /** Primeiro nome de quem está logado, quando dá para saber. */
  nome?: string | null
  /** Expressão do robô (ouvindo, por exemplo, quando a pergunta é por voz). */
  humor?: HumorRobo
}) {
  // Hora do aparelho, não do servidor: calculada só depois de montar para o
  // HTML pré-renderizado não divergir do cliente (fuso diferente).
  const [periodo, setPeriodo] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriodo(saudacaoDoHorario())
  }, [])
  const saudacao = `${periodo ?? 'Olá'}${nome ? `, ${nome}` : ''}!`

  return (
    <section className="flex flex-col items-center [justify-content:safe_center] min-h-full gap-3.5 page-enter">
      {/* O robô "fala" a saudação: o balão sai dele, como numa conversa. */}
      <div className="flex flex-col items-center gap-2 shrink-0">
        <div className="relative text-primary-900 dark:text-black">
          <div className="absolute inset-1 rounded-full bg-primary-400/25 dark:bg-primary-500/20 blur-xl" aria-hidden />
          <RoboAvatar
            humor={humor}
            tamanho={76}
            className="relative [@media(max-height:680px)]:w-14 [@media(max-height:680px)]:h-14"
          />
        </div>

        <div className="relative max-w-[300px] bg-white dark:bg-gray-800 rounded-3xl px-4 py-3 shadow-card text-center chat-pop-in">
          <span
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-800"
            aria-hidden
          />
          <h2 className="relative font-bold text-gray-800 dark:text-gray-100 text-[15px] tracking-tight text-balance">
            {saudacao} <span className="inline-block origin-[70%_70%] animate-[aceno_1.8s_ease-in-out_0.4s_2]">👋</span>
          </h2>
          <p className="relative mt-0.5 text-[13px] text-gray-500 dark:text-gray-400 leading-snug text-balance">
            Eu sou o Fin, seu assistente financeiro. Olho suas compras, contas e investimentos de verdade
            <span className="[@media(max-height:680px)]:hidden"> e te respondo com números</span>. Por onde começamos?
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 [@media(max-height:600px)]:hidden">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Online e conectado aos seus dados</span>
      </div>

      <div className="w-full grid grid-cols-2 gap-2">
        {SUGESTOES_PADRAO.map(({ rotulo, pergunta, icone: Icone }) => (
          <button
            key={rotulo}
            onClick={() => onEscolher(pergunta)}
            title={rotulo}
            className="card-3d text-left bg-white dark:bg-gray-800 rounded-2xl px-3 py-2.5 shadow-soft group transition-colors duration-200 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 dark:hover:border-primary-700"
          >
            <span className="w-6 h-6 rounded-full bg-primary-50 dark:bg-primary-900/40 flex items-center justify-center mb-1.5 transition-colors duration-200 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/60 text-[13px] leading-none">
              <Icone className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" />
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
