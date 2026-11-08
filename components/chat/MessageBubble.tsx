'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { User, Search, Volume2, Send, AlertTriangle, Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react'
import { MarkdownMessage } from './MarkdownMessage'
import { RoboAvatar, type HumorRobo } from './RoboAvatar'
import type { ChatMessage } from '@/lib/useChatFinanceiro'

/** Moldura do robô nas bolhas: mesmo tamanho do avatar do usuário. */
function AvatarRobo({ humor = 'idle', estatico }: { humor?: HumorRobo; estatico?: boolean }) {
  return (
    <div className="w-8 h-8 rounded-full bg-primary-50 dark:bg-primary-900/60 ring-1 ring-primary-100 dark:ring-primary-800 flex items-center justify-center shrink-0 text-primary-900 dark:text-black">
      <RoboAvatar humor={humor} tamanho={26} estatico={estatico} />
    </div>
  )
}

function Avatar({ role }: { role: 'user' | 'assistant' }) {
  return role === 'user' ? (
    <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center shrink-0 shadow-sm">
      <User className="w-4 h-4 text-white" />
    </div>
  ) : (
    <AvatarRobo estatico />
  )
}

const horaDe = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Remove a marcação para copiar só o texto que a pessoa leu. */
function textoPuro(md: string): string {
  return md
    .replace(/```grafico[\s\S]*?```/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2')
    .replace(/^#+\s*/gm, '')
    .trim()
}

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textoPuro(texto))
      setCopiado(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopiado(false), 1600)
    } catch { /* área de transferência bloqueada: nada a fazer */ }
  }, [texto])

  return (
    <button
      onClick={copiar}
      aria-label={copiado ? 'Resposta copiada' : 'Copiar resposta'}
      className={`inline-flex items-center gap-1.5 text-[11px] rounded-full transition-colors ${
        copiado ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400'
      }`}
    >
      {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  )
}

/**
 * 👍/👎 da resposta. O 👎 abre um campo opcional "o que estava errado?" — é
 * dele que saem os casos do conjunto de avaliação do Fin.
 */
function Avaliacao({
  valor,
  onAvaliar,
}: {
  valor: 1 | -1 | null | undefined
  onAvaliar: (valor: 1 | -1 | null, comentario?: string) => void
}) {
  const [comentando, setComentando] = useState(false)
  const [comentario, setComentario] = useState('')
  const [enviado, setEnviado] = useState(false)

  const base = 'inline-flex items-center rounded-full p-1 transition-colors'
  const inativo = 'text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400'

  return (
    <>
      <span className="inline-flex items-center gap-0.5">
        <button
          onClick={() => { setComentando(false); onAvaliar(valor === 1 ? null : 1) }}
          aria-label={valor === 1 ? 'Desfazer avaliação positiva' : 'Resposta útil'}
          aria-pressed={valor === 1}
          className={`${base} ${valor === 1 ? 'text-emerald-600 dark:text-emerald-400' : inativo}`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => {
            const novo = valor === -1 ? null : -1
            setComentando(novo === -1)
            setEnviado(false)
            onAvaliar(novo)
          }}
          aria-label={valor === -1 ? 'Desfazer avaliação negativa' : 'Resposta com problema'}
          aria-pressed={valor === -1}
          className={`${base} ${valor === -1 ? 'text-rose-600 dark:text-rose-400' : inativo}`}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </span>
      {comentando && valor === -1 && (
        <form
          className="basis-full mt-1 flex items-center gap-1.5"
          onSubmit={e => {
            e.preventDefault()
            if (!comentario.trim()) return
            onAvaliar(-1, comentario.trim())
            setEnviado(true)
            setComentando(false)
          }}
        >
          <input
            autoFocus
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            maxLength={1000}
            placeholder="O que estava errado? (opcional)"
            className="flex-1 min-w-0 text-[12px] rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-1.5 text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <button type="submit" className="text-[11px] font-medium text-primary-600 dark:text-primary-400 px-2 py-1.5">
            Enviar
          </button>
        </form>
      )}
      {enviado && valor === -1 && (
        <span className="basis-full text-[10px] text-gray-400 dark:text-gray-500">Obrigado — isso ajuda o Fin a melhorar.</span>
      )}
    </>
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

export const MessageBubble = memo(function MessageBubble({
  mensagem,
  onOuvir,
  onAvaliar,
}: {
  mensagem: ChatMessage
  /** Presente só quando o navegador suporta síntese de fala. */
  onOuvir?: (texto: string) => void
  onAvaliar?: (idLocal: string, valor: 1 | -1 | null, comentario?: string) => void
}) {
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
        {mensagem.aviso && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            {mensagem.aviso}
          </p>
        )}
        {mensagem.telegram && (
          <span
            className={`mt-1.5 flex items-center gap-1 text-[10px] leading-none ${
              ehUsuario ? 'text-white/70 justify-end' : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            <Send className="w-2.5 h-2.5" />
            via Telegram
          </span>
        )}
        {!ehUsuario && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {onOuvir && (
              <button
                onClick={() => onOuvir(mensagem.content)}
                aria-label="Ouvir resposta"
                className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 rounded-full transition-colors hover:text-primary-600 dark:hover:text-primary-400"
              >
                <Volume2 className="w-3.5 h-3.5" />
                Ouvir
              </button>
            )}
            <BotaoCopiar texto={mensagem.content} />
            {onAvaliar && mensagem.dbId && (
              <Avaliacao valor={mensagem.avaliacao} onAvaliar={(v, c) => onAvaliar(mensagem.id, v, c)} />
            )}
            <time className="ml-auto text-[10px] text-gray-300 dark:text-gray-600 tabular-nums">{horaDe(mensagem.ts)}</time>
          </div>
        )}
        {ehUsuario && (
          <time className="block mt-1 text-right text-[10px] text-white/60 tabular-nums">{horaDe(mensagem.ts)}</time>
        )}
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
    <article className="list-item-enter flex gap-2.5 items-end" aria-live="polite" aria-busy="true">
      <AvatarRobo humor={texto ? 'falando' : 'pensando'} />
      <div className="max-w-[88%] sm:max-w-[80%] lg:max-w-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-3xl rounded-bl-md px-4 py-3.5 shadow-card min-w-[180px]">
        {texto ? (
          <>
            <MarkdownMessage texto={texto} />
            <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-primary-500 rounded-sm animate-pulse" />
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
              className="w-1.5 h-1.5 rounded-full bg-primary-400 dark:bg-primary-500"
              style={{ animation: 'chat-dot 1.2s ease-in-out infinite', animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          {status ?? 'Pensando…'}
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
