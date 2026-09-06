'use client'

import { useEffect, useState } from 'react'
import { History, X, Plus, Sparkles, Trash2, MessageSquare } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import type { ConversaResumo } from '@/lib/useChatFinanceiro'

function rotularData(iso: string): string {
  const d = new Date(iso)
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (dias <= 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias < 7) return `${dias} dias atrás`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function ConversationDrawer({
  aberto,
  conversaAtiva,
  onFechar,
  onNova,
  onSelecionar,
  onExcluir,
  carregar,
}: {
  aberto: boolean
  conversaAtiva: string | null
  onFechar: () => void
  onNova: () => void
  onSelecionar: (id: string) => void
  onExcluir: (id: string) => void
  carregar: () => Promise<ConversaResumo[]>
}) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  // Uma confirmação pendente não sobrevive ao fechamento do drawer. Derivar
  // aqui (em vez de zerar num efeito) evita um render em cascata.
  const confirmandoVisivel = aberto ? confirmando : null

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    carregar()
      .then(lista => { if (vivo) { setConversas(lista); setCarregando(false) } })
      .catch(() => { if (vivo) { setConversas([]); setCarregando(false) } })
    return () => { vivo = false }
  }, [aberto, carregar])

  function excluir(id: string) {
    setConversas(prev => prev.filter(c => c.id !== id))
    setConfirmando(null)
    onExcluir(id)
  }

  return (
    <>
      {aberto && (
        <ModalPortal>
          <div className="fixed inset-0 z-[190] bg-black/40 backdrop-blur-sm modal-overlay" onClick={onFechar} />
        </ModalPortal>
      )}

      <ModalPortal>
        <aside
          aria-hidden={!aberto}
          className={`fixed top-0 left-0 h-full w-80 lg:w-96 max-w-[85vw] bg-white dark:bg-gray-900 z-[200] shadow-float flex flex-col border-r border-gray-100 dark:border-gray-700/60 transition-transform duration-300 ease-smooth ${aberto ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <header className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-700/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                <History className="w-3.5 h-3.5 text-white" />
              </div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm tracking-tight truncate">Conversas</h2>
            </div>
            <button
              onClick={onFechar}
              aria-label="Fechar histórico"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors tap-scale"
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="px-3 pt-3">
            <button
              onClick={() => { onNova(); onFechar() }}
              className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl border border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 text-sm font-semibold transition-all duration-200 hover:bg-primary-100 dark:hover:bg-primary-900/40 active:scale-[0.98]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Nova conversa
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-3">
            {carregando ? (
              <div className="space-y-2 px-3">
                {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}
              </div>
            ) : conversas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 px-6 text-center">
                <div className="w-11 h-11 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Nenhuma conversa ainda</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">O que você perguntar fica salvo aqui</p>
              </div>
            ) : (
              <ul className="space-y-1 px-2">
                {conversas.map(conv => {
                  const ativa = conv.id === conversaAtiva
                  if (confirmandoVisivel === conv.id) {
                    return (
                      <li key={conv.id} className="mx-1 px-3 py-3 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 flex items-center justify-between gap-2">
                        <p className="text-xs text-red-600 dark:text-red-400 font-medium">Excluir esta conversa?</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => setConfirmando(null)} className="text-xs text-gray-500 dark:text-gray-400 px-2.5 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                            Não
                          </button>
                          <button onClick={() => excluir(conv.id)} className="text-xs text-white bg-red-500 hover:bg-red-600 px-2.5 py-1.5 rounded-xl font-semibold transition-colors">
                            Excluir
                          </button>
                        </div>
                      </li>
                    )
                  }
                  return (
                    <li
                      key={conv.id}
                      className={`flex items-center rounded-2xl border transition-colors ${
                        ativa
                          ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-100 dark:border-primary-700'
                          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60'
                      }`}
                    >
                      <button
                        onClick={() => { onSelecionar(conv.id); onFechar() }}
                        className="flex-1 text-left px-3 py-3 flex items-start gap-2.5 min-w-0"
                      >
                        <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${ativa ? 'bg-primary-100 dark:bg-primary-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                          <Sparkles className={`w-3.5 h-3.5 ${ativa ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500'}`} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className={`block text-xs font-semibold truncate leading-snug ${ativa ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'}`}>
                            {conv.preview}
                          </span>
                          <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                            {rotularData(conv.created_at)} · {conv.message_count} mensagens
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => setConfirmando(conv.id)}
                        aria-label="Excluir conversa"
                        className="p-2 mr-1.5 rounded-xl text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
      </ModalPortal>
    </>
  )
}
