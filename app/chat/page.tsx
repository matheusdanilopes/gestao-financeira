'use client'

/**
 * Tela do assistente financeiro.
 *
 * Responsabilidade única: desenhar. Estado, transporte SSE, cancelamento e
 * histórico ficam em useChatFinanceiro; markdown, bolhas, composer e drawer
 * em components/chat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, MoreHorizontal, Plus, Sparkles, Trash2, AlertTriangle, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import NotificacoesBell from '@/components/NotificacoesBell'
import { MessageBubble, StreamingBubble } from '@/components/chat/MessageBubble'
import { Composer } from '@/components/chat/Composer'
import { ConversationDrawer } from '@/components/chat/ConversationDrawer'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { useChatFinanceiro } from '@/lib/useChatFinanceiro'
import { useInsights } from '@/lib/useInsights'

const FOLLOWUPS = [
  'O que está puxando esse número?',
  'Como foi no mês passado?',
  'O que dá para cortar?',
  'Detalhe por categoria',
  'E nos próximos meses?',
]

/** Distância do fim a partir da qual paramos de acompanhar o scroll. */
const MARGEM_AUTOSCROLL = 160

export default function ChatPage() {
  const chat = useChatFinanceiro('geral')
  const { insights } = useInsights()

  const [input, setInput] = useState('')
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [menuAberto, setMenuAberto] = useState(false)
  const [headerCompacto, setHeaderCompacto] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const seguirFimRef = useRef(true)

  const mesAtual = useMemo(() => format(new Date(), 'MMM/yyyy', { locale: ptBR }).toUpperCase(), [])

  const vazio = chat.mensagens.length === 0 && !chat.streaming && !chat.carregandoHistorico

  // ── Scroll: acompanha o fim só enquanto o usuário estiver perto dele ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function aoRolar() {
      const perto = el!.scrollHeight - el!.scrollTop - el!.clientHeight < MARGEM_AUTOSCROLL
      seguirFimRef.current = perto
      setHeaderCompacto(el!.scrollTop > 24)
    }
    el.addEventListener('scroll', aoRolar, { passive: true })
    return () => el.removeEventListener('scroll', aoRolar)
  }, [])

  useEffect(() => {
    if (!seguirFimRef.current) return
    if (chat.mensagens.length === 0 && !chat.streaming) return
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.mensagens, chat.textoParcial, chat.streaming])

  const enviar = useCallback((texto?: string) => {
    const conteudo = (texto ?? input).trim()
    if (!conteudo || chat.streaming) return
    seguirFimRef.current = true
    setInput('')
    void chat.enviar(conteudo)
  }, [input, chat])

  const ultimaEhResposta =
    chat.mensagens.length > 0 && chat.mensagens[chat.mensagens.length - 1].role === 'assistant'

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50 dark:bg-gray-900 pb-16">

      <ConversationDrawer
        aberto={drawerAberto}
        conversaAtiva={chat.conversationId}
        onFechar={() => setDrawerAberto(false)}
        onNova={chat.novaConversa}
        onSelecionar={id => { void chat.abrirConversa(id) }}
        onExcluir={id => { void chat.excluirConversa(id) }}
        carregar={chat.listarConversas}
      />

      {menuAberto && <div className="fixed inset-0 z-[150]" onClick={() => setMenuAberto(false)} />}

      {/* ── Cabeçalho ── */}
      <header className={`sticky top-0 z-[160] sticky-header border-b border-gray-100 dark:border-gray-700/60 transition-[padding] duration-200 ${headerCompacto ? 'py-1.5' : 'py-2'}`}>
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={() => { setMenuAberto(false); setDrawerAberto(true) }}
            aria-label="Histórico de conversas"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0 transition-all duration-200 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 active:scale-95"
          >
            <History className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
            <div className={`w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 ${headerCompacto ? 'scale-90' : ''}`}>
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 text-center">
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-tight truncate tracking-tight">
                IA Financeira
              </p>
              <div className={`flex items-center justify-center gap-1.5 overflow-hidden transition-all duration-200 ${headerCompacto ? 'max-h-0 opacity-0' : 'max-h-4 opacity-100 mt-0.5'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chat.streaming ? 'bg-violet-400 animate-pulse' : 'bg-emerald-400'}`} />
                <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                  {chat.streaming ? (chat.status ?? 'Analisando') : `Pronta · ${mesAtual}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center shrink-0">
            <NotificacoesBell />
            <div className="relative">
              <button
                onClick={() => setMenuAberto(v => !v)}
                aria-label="Mais opções"
                aria-expanded={menuAberto}
                aria-haspopup="menu"
                className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 transition-all duration-200 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 active:scale-95"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {menuAberto && (
                <div role="menu" className="absolute right-0 top-12 w-52 bg-white dark:bg-gray-900 rounded-2xl shadow-float border border-gray-100 dark:border-gray-700/60 overflow-hidden z-[151] animate-in">
                  <button
                    role="menuitem"
                    onClick={() => { setMenuAberto(false); chat.novaConversa() }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 dark:text-gray-200 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  >
                    <Plus className="w-4 h-4 text-gray-400 shrink-0" />
                    Nova conversa
                  </button>
                  {chat.conversationId && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuAberto(false)
                        const id = chat.conversationId
                        if (id) void chat.excluirConversa(id)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-600 dark:text-red-400 text-left border-t border-gray-100 dark:border-gray-700/60 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4 shrink-0" />
                      Excluir conversa
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Conversa ── */}
      {/* O padding inferior generoso existe só para o último balão não ficar
          atrás do composer fixo. Na tela de boas-vindas ele não tem função e
          era justamente o que, somado ao min-h-full do conteúdo, empurrava o
          topo para fora da área visível. */}
      <main
        ref={scrollRef}
        // space-y-5 separa balões; na tela vazia ele só dava 20px de margem ao
        // sentinela de scroll do fim da lista, criando uma rolagem fantasma.
        className={`flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 ${
          // Na tela vazia o padding inferior compensa a altura do composer,
          // que flutua por cima do main: sem ele o "centralizado" fica visualmente
          // baixo, encostando no campo de digitação.
          vazio ? 'pt-3 pb-20' : 'pt-6 pb-28 space-y-5'
        }`}
      >
        {chat.carregandoHistorico ? (
          <div className="space-y-4 pt-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                <div className={`skeleton rounded-3xl ${i % 2 ? 'h-12 w-48' : 'h-24 w-[80%]'}`} />
              </div>
            ))}
          </div>
        ) : vazio ? (
          <ChatEmptyState insights={insights} onEscolher={enviar} />
        ) : (
          <>
            {chat.restaurada && (
              <div className="flex justify-center">
                <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                  Conversa anterior restaurada
                </span>
              </div>
            )}

            {chat.mensagens.map(m => <MessageBubble key={m.id} mensagem={m} />)}

            {chat.streaming && (
              <StreamingBubble
                texto={chat.textoParcial}
                status={chat.status}
                ferramentas={chat.ferramentas}
              />
            )}

            {chat.erro && (
              <div className="flex gap-2.5 items-start pl-10">
                <div className="flex-1 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{chat.erro.mensagem}</p>
                      <button
                        onClick={chat.tentarNovamente}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 rounded-lg px-2.5 py-1.5 -ml-2.5 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Tentar novamente
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {ultimaEhResposta && !chat.streaming && !chat.erro && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 pl-10">
                {FOLLOWUPS.map(chip => (
                  <button
                    key={chip}
                    onClick={() => enviar(chip)}
                    className="shrink-0 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full px-3.5 py-2 border border-transparent transition-colors duration-200 hover:bg-primary-100 hover:text-primary-700 hover:border-primary-200 dark:hover:bg-primary-900/40 dark:hover:text-primary-400 dark:hover:border-primary-700 whitespace-nowrap"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div ref={fimRef} />
      </main>

      <Composer
        valor={input}
        onChange={setInput}
        onEnviar={() => enviar()}
        onCancelar={chat.cancelar}
        streaming={chat.streaming}
        desabilitado={chat.carregandoHistorico}
      />
    </div>
  )
}
