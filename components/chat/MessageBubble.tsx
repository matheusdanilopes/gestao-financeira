'use client'

import { memo } from 'react'
import { Sparkles, User, Search } from 'lucide-react'
import { MarkdownMessage } from './MarkdownMessage'
import type { ChatMessage } from '@/lib/useChatFinanceiro'

function Avatar({ role }: { role: 'user' | 'assistant' }) {
  return role === 'user' ? (
    <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center shrink-0 shadow-sm">
      <User className="w-4 h-4 text-white" />
    </div>
  ) : (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
      <Sparkles className="w-3.5 h-3.5 text-white" />
    </div>
  )
}

/**
 * Trilha do que a IA consultou para chegar à resposta. Existe para responder
 * à desconfiança natural de "de onde ela tirou esse número" — e para deixar
 * visível que a consulta aos dados de fato aconteceu.
 */
const TrilhaFerramentas = memo(function TrilhaFerramentas({ itens }: { itens: string[] }) {
  const unicos = [...new Set(itens)]
  if (unicos.length === 0) return null

  return (
    <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex flex-wrap items-center gap-1.5">
      <Search className="w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0" />
      {unicos.map(item => (
        <span
          key={item}
          className="text-[10px] leading-none text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700 rounded-full px-2 py-1"
        >
          {item}
        </span>
      ))}
    </div>
  )
})

export const MessageBubble = memo(function MessageBubble({ mensagem }: { mensagem: ChatMessage }) {
  const ehUsuario = mensagem.role === 'user'

  return (
    <article className={`list-item-enter flex gap-2.5 items-end ${ehUsuario ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar role={mensagem.role} />
      <div
        className={
          ehUsuario
            ? 'max-w-[85%] sm:max-w-[78%] lg:max-w-2xl bg-primary-600 text-white rounded-3xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words'
            : 'max-w-[88%] sm:max-w-[80%] lg:max-w-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-3xl rounded-bl-md px-4 py-3.5 shadow-card break-words'
        }
      >
        {ehUsuario ? mensagem.content : <MarkdownMessage texto={mensagem.content} />}
        {!ehUsuario && mensagem.ferramentas && <TrilhaFerramentas itens={mensagem.ferramentas} />}
      </div>
    </article>
  )
})

/** Bolha da resposta que ainda está chegando (streaming). */
export const StreamingBubble = memo(function StreamingBubble({
  texto,
  status,
  ferramentas,
}: {
  texto: string
  status: string | null
  ferramentas: string[]
}) {
  return (
    <article className="list-item-enter flex gap-2.5 items-end">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
        <Sparkles className="w-3.5 h-3.5 text-white animate-pulse" />
      </div>
      <div className="max-w-[88%] sm:max-w-[80%] lg:max-w-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-3xl rounded-bl-md px-4 py-3.5 shadow-card min-w-[180px]">
        {texto ? (
          <>
            <MarkdownMessage texto={texto} />
            <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-violet-500 rounded-sm animate-pulse" />
          </>
        ) : (
          <AtividadeAgente status={status} ferramentas={ferramentas} />
        )}
      </div>
    </article>
  )
})

/** Progresso enquanto o agente ainda está buscando dados. */
function AtividadeAgente({ status, ferramentas }: { status: string | null; ferramentas: string[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <span className="flex gap-1 items-center shrink-0" aria-hidden>
          {[0, 240, 480].map(delay => (
            <span
              key={delay}
              className="w-1.5 h-1.5 rounded-full bg-violet-400 dark:bg-violet-500"
              style={{ animation: 'chat-dot 1.2s ease-in-out infinite', animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          {status ?? 'Analisando seus dados'}
        </span>
      </div>

      {ferramentas.length > 1 && (
        <ul className="space-y-0.5 pl-[26px]">
          {ferramentas.slice(0, -1).slice(-3).map((f, i) => (
            <li key={`${f}-${i}`} className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-emerald-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <style>{`
        @keyframes chat-dot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%           { transform: scale(1.15); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
