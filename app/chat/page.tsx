'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import ModalPortal from '@/components/ModalPortal'
import {
  Send, Sparkles, User, Trash2, Plus, History, X,
  MessageSquare, TrendingUp, BarChart2, Calendar, PieChart,
  MoreHorizontal,
} from 'lucide-react'
import NotificacoesBell from '@/components/NotificacoesBell'
import { supabase } from '@/lib/supabaseClient'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useInsights } from '@/lib/useInsights'

interface Mensagem {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

interface ConversaItem {
  id: string
  created_at: string
  preview: string
  message_count: number
}

const SUGESTOES_PRIMARIAS = [
  { texto: 'Onde posso cortar gastos esse mês?', icon: TrendingUp },
  { texto: 'Quanto sobrou para investir este mês?', icon: BarChart2 },
  { texto: 'Tem conta vencendo esta semana?', icon: Calendar },
  { texto: 'Qual categoria está acima do normal?', icon: PieChart },
]

const SUGESTOES_SECUNDARIAS = [
  'Quem gastou mais, Matheus ou Jeniffer?',
  'Quais parcelamentos ainda estão ativos?',
  'Dá para cancelar alguma assinatura?',
  'Estou acima ou abaixo da minha média histórica?',
]

const FOLLOWUPS = [
  'O que está puxando essa alta?',
  'Como estava no mês passado?',
  'Dá para fechar o mês no azul?',
  'Qual foi a maior compra avulsa?',
  'Que % dos gastos é fixo?',
  'O que devo priorizar agora?',
]

function parseInline(line: string): React.ReactNode[] {
  // \*\*[^*]+(?:\*[^*]+)*\*\* allows single * inside bold (e.g. **2*3**)
  const parts = line.split(/(\*\*[^*]+(?:\*[^*]+)*\*\*|\*[^*]+\*|`[^`]+`|R\$\s*[\d.,]+)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={idx} className="font-semibold">{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={idx}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={idx} className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-lg text-[11px] font-mono tracking-tight">{part.slice(1, -1)}</code>
    if (/^R\$\s*[\d.,]+$/.test(part))
      return <span key={idx} className="font-semibold num value-tight">{part}</span>
    return part
  })
}

const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-base font-bold text-gray-900 dark:text-gray-100 mt-3 mb-1 tracking-tight">
          {parseInline(line.slice(2))}
        </h1>
      )
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-sm font-bold text-gray-800 dark:text-gray-200 mt-2.5 mb-1 tracking-tight">
          {parseInline(line.slice(3))}
        </h2>
      )
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-2 mb-0.5">
          {parseInline(line.slice(4))}
        </h3>
      )
    } else if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-2 border-primary-300 dark:border-primary-600 pl-3 text-gray-600 dark:text-gray-400 italic my-1.5 rounded-r">
          {parseInline(line.slice(2))}
        </blockquote>
      )
    } else if (line.trim() === '---' || line.trim() === '***') {
      elements.push(<hr key={i} className="border-gray-200 dark:border-gray-700 my-2" />)
    } else if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} className="leading-relaxed">{parseInline(lines[i].slice(2))}</li>)
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc pl-4 space-y-1 my-1.5 text-gray-700 dark:text-gray-300">
          {items}
        </ul>
      )
      continue
    } else if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={i} className="leading-relaxed">{parseInline(lines[i].replace(/^\d+\. /, ''))}</li>)
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal pl-4 space-y-1 my-1.5 text-gray-700 dark:text-gray-300">
          {items}
        </ol>
      )
      continue
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    } else {
      elements.push(
        <p key={i} className="leading-relaxed text-gray-800 dark:text-gray-200">
          {parseInline(line)}
        </p>
      )
    }
    i++
  }

  return <div className="text-sm space-y-1.5">{elements}</div>
})

function convIdKey(userId: string) {
  return `chat_conv_id_${userId}`
}

function formatarData(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const dias = Math.floor((hoje.getTime() - d.getTime()) / 86400000)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias < 7) return `${dias} dias atrás`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/* Indicador de "pensando" com 3 dots staggered */
const ThinkingIndicator = memo(function ThinkingIndicator() {
  return (
    <div className="list-item-enter flex gap-2.5 items-end">
      {/* Avatar da IA */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      {/* Bolha */}
      <div className="bg-white dark:bg-gray-800 shadow-card border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3.5 flex items-center gap-3">
        <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Analisando seus dados</span>
        <span className="flex gap-1 items-center" aria-label="Processando">
          <span
            className="w-1.5 h-1.5 rounded-full bg-violet-400 dark:bg-violet-500"
            style={{ animation: 'thinking-dot 1.2s ease-in-out infinite', animationDelay: '0ms' }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-violet-400 dark:bg-violet-500"
            style={{ animation: 'thinking-dot 1.2s ease-in-out infinite', animationDelay: '240ms' }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-violet-400 dark:bg-violet-500"
            style={{ animation: 'thinking-dot 1.2s ease-in-out infinite', animationDelay: '480ms' }}
          />
        </span>
        <style>{`
          @keyframes thinking-dot {
            0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
            40%            { transform: scale(1.15); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
})

// Turns a real, data-driven insight headline into a chat suggestion the user
// can tap — keeps the empty-state suggestions grounded in their own numbers
// instead of a fixed generic list.
function sugestoesDinamicas(insights: { titulo: string; icone: string }[]) {
  return insights.slice(0, 4).map(i => ({ texto: `Me explique: ${i.titulo}`, emoji: i.icone }))
}

export default function ChatPage() {
  const { insights: insightsUsuario } = useInsights()
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [historicoRestaurado, setHistoricoRestaurado] = useState(false)
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [conversas, setConversas] = useState<ConversaItem[]>([])
  const [carregandoConversas, setCarregandoConversas] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [compactHeader, setCompactHeader] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const userIdRef = useRef<string>('anonymous')
  const convIdRef = useRef<string | null>(null)
  const shouldScrollRef = useRef(true)

  const mesAtual = format(new Date(), 'MMM/yyyy', { locale: ptBR }).toUpperCase()

  function isNearBottom(): boolean {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 128) + 'px'
  }

  const carregarHistorico = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/chat/history?conversation_id=${conversationId}`)
    if (!res.ok) return []
    const json = await res.json()
    return (json.mensagens ?? []).map((m: { role: string; content: string }) => ({
      id: newId(),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      ts: Date.now(),
    }))
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? 'anonymous'
      userIdRef.current = uid

      let savedConvId: string | null = null
      try { savedConvId = localStorage.getItem(convIdKey(uid)) } catch { /* ignore */ }
      if (!savedConvId) return
      convIdRef.current = savedConvId

      try {
        const msgs = await carregarHistorico(savedConvId)
        if (msgs.length > 0) {
          setMensagens(msgs)
          setHistoricoRestaurado(true)
        }
      } catch { /* ignore */ }
    })
  }, [carregarHistorico])

  useEffect(() => {
    // Nunca rola a tela de boas-vindas (sem mensagens) — só faz sentido
    // acompanhar o fim da conversa quando já existe conteúdo.
    if (shouldScrollRef.current && (mensagens.length > 0 || carregando)) {
      fimRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [mensagens, carregando])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      setCompactHeader(el!.scrollTop > 24)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  async function deletarConversaEspecifica(convId: string) {
    const eraCurrent = convIdRef.current === convId
    if (eraCurrent) novaConversa()
    setConversas(prev => prev.filter(c => c.id !== convId))
    setConfirmDeleteId(null)
    try {
      await fetch(
        `/api/chat/conversations?conversation_id=${encodeURIComponent(convId)}&user_id=${encodeURIComponent(userIdRef.current)}`,
        { method: 'DELETE' }
      )
    } catch { /* silencioso */ }
  }

  async function abrirDrawer() {
    setOverflowOpen(false)
    setConfirmDeleteId(null)
    setDrawerAberto(true)
    setCarregandoConversas(true)
    try {
      const res = await fetch(`/api/chat/conversations?user_id=${encodeURIComponent(userIdRef.current)}`)
      if (res.ok) {
        const json = await res.json()
        setConversas(json.conversations ?? [])
      }
    } catch { /* ignore */ }
    setCarregandoConversas(false)
  }

  async function selecionarConversa(conv: ConversaItem) {
    setDrawerAberto(false)
    setMensagens([])
    setHistoricoRestaurado(false)
    setCarregando(true)
    convIdRef.current = conv.id
    try { localStorage.setItem(convIdKey(userIdRef.current), conv.id) } catch { /* ignore */ }
    try {
      const msgs = await carregarHistorico(conv.id)
      if (msgs.length > 0) {
        setMensagens(msgs)
        setHistoricoRestaurado(true)
      }
    } catch { /* ignore */ }
    setCarregando(false)
  }

  async function enviar(texto?: string) {
    const conteudo = (texto ?? input).trim()
    if (!conteudo || carregando) return

    // Always scroll for user's own message + loading indicator
    shouldScrollRef.current = true

    const novaMensagem: Mensagem = { id: newId(), role: 'user', content: conteudo, ts: Date.now() }
    const historicoOtimista = [...mensagens, novaMensagem]
    setMensagens(historicoOtimista)
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    setCarregando(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pergunta: conteudo,
          conversation_id: convIdRef.current ?? undefined,
          user_id: userIdRef.current,
          tela: 'geral',
        }),
      })
      const data = await res.json()

      if (data.conversation_id && convIdRef.current !== data.conversation_id) {
        convIdRef.current = data.conversation_id
        try { localStorage.setItem(convIdKey(userIdRef.current), data.conversation_id) } catch { /* ignore */ }
      }

      let content: string
      if (data.resposta) {
        content = data.resposta
      } else if (data.errorCode === 'QUOTA_429') {
        content = data.diaria
          ? 'A cota diária da IA foi atingida. Tente novamente amanhã.'
          : data.segundos
            ? `Muitas requisições em pouco tempo. Aguarde ${data.segundos} segundos e tente novamente.`
            : 'Muitas requisições em pouco tempo. Aguarde um momento e tente novamente.'
      } else if (data.error?.includes('GEMINI_API_KEY')) {
        content = 'A chave GEMINI_API_KEY não está configurada no Vercel.\n\nAdicione a variável de ambiente e faça um novo deploy.'
      } else {
        content = 'Não consegui responder agora. Tente novamente em instantes.'
      }

      // Only scroll to AI response if user is still near the loading indicator
      shouldScrollRef.current = isNearBottom()
      setMensagens([...historicoOtimista, { id: newId(), role: 'assistant', content, ts: Date.now() }])
    } catch {
      shouldScrollRef.current = isNearBottom()
      setMensagens([...historicoOtimista, {
        id: newId(),
        role: 'assistant',
        content: 'Erro de conexão. Verifique sua internet e tente novamente.',
        ts: Date.now(),
      }])
    } finally {
      setCarregando(false)
      inputRef.current?.focus()
    }
  }

  function novaConversa() {
    setMensagens([])
    setHistoricoRestaurado(false)
    convIdRef.current = null
    try { localStorage.removeItem(convIdKey(userIdRef.current)) } catch { /* ignore */ }
  }

  function handleNovaConversa() {
    setOverflowOpen(false)
    novaConversa()
  }

  async function deletarConversa() {
    const convId = convIdRef.current
    novaConversa()
    if (!convId) return
    setConversas(prev => prev.filter(c => c.id !== convId))
    try {
      await fetch(
        `/api/chat/conversations?conversation_id=${encodeURIComponent(convId)}&user_id=${encodeURIComponent(userIdRef.current)}`,
        { method: 'DELETE' }
      )
    } catch { /* silencioso */ }
  }

  async function handleDeletarConversa() {
    setOverflowOpen(false)
    await deletarConversa()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  const ultimaMensagemAI = mensagens.length > 0 && mensagens[mensagens.length - 1].role === 'assistant'
  const followupChips = FOLLOWUPS.slice(0, 4)
  const insightsDinamicas = sugestoesDinamicas(insightsUsuario)

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50 dark:bg-gray-900 pb-16">

      {/* Drawer overlay */}
      {drawerAberto && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[190] bg-black/40 backdrop-blur-sm modal-overlay"
            onClick={() => { setDrawerAberto(false); setConfirmDeleteId(null) }}
          />
        </ModalPortal>
      )}

      {/* Drawer de conversas */}
      <ModalPortal>
        <div className={`fixed top-0 left-0 h-full w-80 lg:w-96 max-w-[85vw] bg-white dark:bg-gray-900 z-[200] shadow-float flex flex-col transition-transform duration-300 ease-smooth border-r border-gray-100 dark:border-gray-700/60 ${drawerAberto ? 'translate-x-0' : '-translate-x-full'}`}>
          {/* Drawer header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-700/60">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                <History className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm tracking-tight">Conversas anteriores</span>
            </div>
            <button
              onClick={() => { setDrawerAberto(false); setConfirmDeleteId(null) }}
              className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 transition-colors tap-scale"
              aria-label="Fechar histórico"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Nova conversa */}
          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => { novaConversa(); setDrawerAberto(false) }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 text-sm font-semibold hover:bg-primary-100 dark:hover:bg-primary-900/40 transition active:scale-[0.98]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Nova conversa
            </button>
          </div>

          {/* Lista de conversas */}
          <div className="flex-1 overflow-y-auto py-2">
            {carregandoConversas ? (
              <div className="space-y-2 px-3 pt-2">
                {[...Array(5)].map((_, idx) => (
                  <div key={idx} className="skeleton h-14 rounded-2xl" />
                ))}
              </div>
            ) : conversas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
                <div className="w-11 h-11 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Nenhuma conversa anterior</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Suas conversas aparecerão aqui</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-0.5 px-2">
                {conversas.map((conv) => {
                  const ativa = conv.id === convIdRef.current
                  const confirmando = confirmDeleteId === conv.id
                  return (
                    <li key={conv.id}>
                      {confirmando ? (
                        <div className="mx-1 px-3 py-2.5 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 flex items-center justify-between gap-2">
                          <p className="text-xs text-red-600 dark:text-red-400 font-medium">Excluir esta conversa?</p>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-gray-500 dark:text-gray-400 px-2.5 py-1 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                            >
                              Não
                            </button>
                            <button
                              onClick={() => deletarConversaEspecifica(conv.id)}
                              className="text-xs text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-xl transition font-semibold"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className={`flex items-center rounded-2xl transition-colors ${
                          ativa
                            ? 'bg-primary-50 dark:bg-primary-900/30 border border-primary-100 dark:border-primary-800'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 border border-transparent'
                        }`}>
                          <button
                            onClick={() => selecionarConversa(conv)}
                            className="flex-1 text-left px-3 py-3 flex items-start gap-2.5 min-w-0"
                          >
                            <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                              ativa ? 'bg-primary-100 dark:bg-primary-900' : 'bg-gray-100 dark:bg-gray-800'
                            }`}>
                              <Sparkles className={`w-3.5 h-3.5 ${ativa ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold truncate leading-snug ${
                                ativa ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
                              }`}>
                                {conv.preview}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatarData(conv.created_at)}</span>
                                <span className="text-[10px] text-gray-300 dark:text-gray-600">·</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">{conv.message_count} msgs</span>
                              </div>
                            </div>
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(conv.id)}
                            aria-label="Excluir conversa"
                            className="p-2 mr-1.5 rounded-xl text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 transition shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </ModalPortal>

      {/* Overflow menu backdrop */}
      {overflowOpen && (
        <div
          className="fixed inset-0 z-[150]"
          onClick={() => setOverflowOpen(false)}
        />
      )}

      {/* Header */}
      <header className={`sticky top-0 z-[160] sticky-header border-b border-gray-100 dark:border-gray-700/60 transition-[padding] duration-200 ${compactHeader ? 'py-1.5' : 'py-2'}`}>
        <div className="flex items-center gap-1 px-1">

          {/* Left zone: History */}
          <button
            onClick={abrirDrawer}
            aria-label="Histórico de conversas"
            className="flex items-center justify-center w-11 h-11 rounded-xl text-gray-500 dark:text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition active:scale-95 shrink-0"
          >
            <History className="w-5 h-5" />
          </button>

          {/* Center zone: Context */}
          <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
            <div className={`w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 ${compactHeader ? 'scale-90' : ''}`}>
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 text-center">
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-tight truncate tracking-tight">
                IA Financeira
              </p>
              <div className={`flex items-center justify-center gap-1.5 transition-all duration-200 overflow-hidden ${compactHeader ? 'max-h-0 opacity-0' : 'max-h-4 opacity-100 mt-0.5'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">Analisando · {mesAtual}</span>
              </div>
            </div>
          </div>

          {/* Right zone: Bell + Overflow */}
          <div className="flex items-center shrink-0">
            <NotificacoesBell />
            <div className="relative">
              <button
                onClick={() => setOverflowOpen(prev => !prev)}
                aria-label="Mais opções"
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                className="flex items-center justify-center w-11 h-11 rounded-xl text-gray-500 dark:text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition active:scale-95"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {/* Overflow popover */}
              {overflowOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-12 w-52 bg-white dark:bg-gray-900 rounded-2xl shadow-float border border-gray-100 dark:border-gray-700/60 overflow-hidden z-[151] animate-in"
                >
                  <button
                    role="menuitem"
                    onClick={handleNovaConversa}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition text-left"
                  >
                    <Plus className="w-4 h-4 text-gray-400 shrink-0" />
                    Nova conversa
                  </button>
                  {mensagens.length > 0 && (
                    <button
                      role="menuitem"
                      onClick={handleDeletarConversa}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-left border-t border-gray-100 dark:border-gray-700/60"
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

      {/* Mensagens */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pt-8 pb-24 space-y-5"
      >
        {mensagens.length === 0 && !carregando ? (
          /* ── Estado vazio / boas-vindas ── */
          <div className="flex flex-col items-center justify-center min-h-full py-8 gap-6 page-enter">
            {/* Avatar grande da IA */}
            <div className="relative">
              <div className="w-18 h-18 w-[72px] h-[72px] rounded-3xl bg-gradient-to-br from-violet-500 via-indigo-500 to-indigo-600 flex items-center justify-center shadow-float">
                <Sparkles className="w-9 h-9 text-white" />
              </div>
              {/* Anel de status online */}
              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 border-2 border-white dark:border-gray-900 rounded-full" />
            </div>

            <div className="text-center space-y-1.5 px-2">
              <p className="font-bold text-gray-800 dark:text-gray-100 text-base tracking-tight text-balance">
                Olá! Sou seu assistente financeiro.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed text-balance max-w-[280px] mx-auto">
                Analiso os seus dados reais do mês e respondo perguntas sobre gastos, investimentos e planejamento.
              </p>
            </div>

            {/* Badge "Baseado nos seus dados" */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Baseado nos seus dados financeiros</span>
            </div>

            {/* Sugestões primárias em grid 2x2 — dinâmicas quando há insights reais do usuário */}
            <div className="w-full grid grid-cols-2 gap-2.5">
              {insightsDinamicas.length >= 2
                ? insightsDinamicas.map(({ texto, emoji }) => (
                    <button
                      key={texto}
                      onClick={() => enviar(texto)}
                      className="card-3d text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3.5 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 dark:hover:border-primary-700 transition-colors shadow-card group"
                    >
                      <div className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-900/40 flex items-center justify-center mb-2.5 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/60 transition-colors text-sm leading-none">
                        {emoji}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug font-medium">{texto}</p>
                    </button>
                  ))
                : SUGESTOES_PRIMARIAS.map(({ texto, icon: Icon }) => (
                    <button
                      key={texto}
                      onClick={() => enviar(texto)}
                      className="card-3d text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3.5 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 dark:hover:border-primary-700 transition-colors shadow-card group"
                    >
                      <div className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-900/40 flex items-center justify-center mb-2.5 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/60 transition-colors">
                        <Icon className="w-4 h-4 text-primary-500 dark:text-primary-400" />
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug font-medium">{texto}</p>
                    </button>
                  ))}
            </div>

            {/* Chips secundários */}
            <div className="w-full flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {SUGESTOES_SECUNDARIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="shrink-0 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full px-3.5 py-1.5 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900/40 dark:hover:text-primary-400 transition-colors whitespace-nowrap border border-transparent hover:border-primary-200 dark:hover:border-primary-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {historicoRestaurado && (
              <div className="flex justify-center">
                <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                  Conversa anterior restaurada
                </span>
              </div>
            )}

            {mensagens.map((m) => (
              <div key={m.id} className={`list-item-enter flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end`}>
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                  m.role === 'user'
                    ? 'bg-primary-600'
                    : 'bg-gradient-to-br from-violet-500 to-indigo-600'
                }`}>
                  {m.role === 'user'
                    ? <User className="w-4 h-4 text-white" />
                    : <Sparkles className="w-3.5 h-3.5 text-white" />
                  }
                </div>

                {/* Bolha */}
                <div className={`max-w-[85%] sm:max-w-[78%] lg:max-w-2xl ${
                  m.role === 'user'
                    ? 'bg-primary-600 text-white rounded-3xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm'
                    : 'bg-white dark:bg-gray-800 text-gray-800 shadow-card border border-gray-100 dark:border-gray-700 rounded-3xl rounded-bl-sm px-5 py-4'
                }`}>
                  {m.role === 'user'
                    ? m.content
                    : <MarkdownContent text={m.content} />
                  }
                </div>
              </div>
            ))}

            {/* Follow-up chips após última resposta da IA */}
            {ultimaMensagemAI && !carregando && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 pl-10">
                {followupChips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => enviar(chip)}
                    className="shrink-0 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full px-3.5 py-1.5 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900/40 dark:hover:text-primary-400 transition-colors whitespace-nowrap border border-transparent hover:border-primary-200 dark:hover:border-primary-800"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Indicador de carregamento — "pensando" */}
        {carregando && <ThinkingIndicator />}

        <div ref={fimRef} />
      </div>

      {/* Input */}
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 sticky-header border-t border-gray-100 dark:border-gray-700/60 px-4 py-3">
        <div className="max-w-md lg:max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoGrow(e.target)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre suas finanças…"
            rows={1}
            disabled={carregando}
            className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow disabled:opacity-50"
            style={{ lineHeight: '1.5', overflow: 'hidden' }}
          />
          <button
            onClick={() => enviar()}
            disabled={!input.trim() || carregando}
            aria-label="Enviar mensagem"
            className="w-10 h-10 bg-primary-600 rounded-full flex items-center justify-center transition-all hover:bg-primary-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-sm hover:shadow-md"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

    </div>
  )
}
