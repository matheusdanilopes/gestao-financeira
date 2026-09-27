'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ArrowUp, Mic, Square } from 'lucide-react'

const ALTURA_MAXIMA = 132

/**
 * Campo de envio. Cresce com o conteúdo, envia com Enter (Shift+Enter quebra
 * linha) e vira botão de parar enquanto a resposta está sendo gerada — antes
 * não havia como interromper um turno longo.
 *
 * O microfone só aparece quando o navegador suporta reconhecimento de voz
 * (`suportaEscuta`); enquanto ouve, ele some e cede lugar a um indicador
 * "Ouvindo…", porque nesse momento digitar e falar ao mesmo tempo confundiria
 * qual das duas fontes vale.
 */
export function Composer({
  valor,
  onChange,
  onEnviar,
  onCancelar,
  streaming,
  desabilitado,
  suportaEscuta,
  ouvindo,
  onMic,
}: {
  valor: string
  onChange: (v: string) => void
  onEnviar: () => void
  onCancelar: () => void
  streaming: boolean
  desabilitado?: boolean
  suportaEscuta?: boolean
  ouvindo?: boolean
  onMic?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`
  }, [valor])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming) onEnviar()
    }
  }

  const podeEnviar = valor.trim().length > 0 && !streaming && !desabilitado

  return (
    <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 sticky-header border-t border-gray-100 dark:border-gray-700/60 px-3 py-2.5 z-[140]">
      <div className="max-w-md lg:max-w-3xl mx-auto flex gap-2 items-end">
        {ouvindo ? (
          <div className="flex-1 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
            <span className="flex gap-1 items-center shrink-0" aria-hidden>
              {[0, 200, 400].map(delay => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-red-400"
                  style={{ animation: 'chat-dot 1.2s ease-in-out infinite', animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            <span className="truncate">{valor || 'Ouvindo…'}</span>
          </div>
        ) : (
          <textarea
            ref={ref}
            value={valor}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={streaming ? 'Gerando resposta…' : 'Pergunte sobre suas finanças…'}
            aria-label="Mensagem"
            className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200"
            style={{ lineHeight: '1.5', overflowY: 'auto', maxHeight: ALTURA_MAXIMA }}
          />
        )}

        {suportaEscuta && !streaming && (
          <button
            onClick={onMic}
            disabled={desabilitado}
            aria-label={ouvindo ? 'Parar escuta' : 'Falar pergunta'}
            aria-pressed={ouvindo}
            className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              ouvindo
                ? 'bg-red-500 text-white shadow-sm animate-pulse'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <Mic className="w-4 h-4" />
          </button>
        )}

        {streaming ? (
          <button
            onClick={onCancelar}
            aria-label="Parar geração"
            className="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center justify-center shrink-0 transition-all duration-200 hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : !ouvindo ? (
          <button
            onClick={onEnviar}
            disabled={!podeEnviar}
            aria-label="Enviar mensagem"
            className="w-11 h-11 rounded-full bg-primary-600 text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 hover:bg-primary-700 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        ) : null}
      </div>

      <style>{`
        @keyframes chat-dot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%           { transform: scale(1.15); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
