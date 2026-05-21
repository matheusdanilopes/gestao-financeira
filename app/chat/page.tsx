'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { Send, Bot, User, Trash2, Plus, History, X, MessageSquare, ChevronRight, ArrowLeft, Star } from 'lucide-react'
import NotificacoesBell from '@/components/NotificacoesBell'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
  ts?: number
}

interface ConversaItem {
  id: string
  created_at: string
  preview: string
  message_count: number
}

const SUGESTOES = [
  'Como está meu orçamento?',
  'Principais gastos',
  'Compare com o mês passado',
  'Categorias que mais gastei',
  'Estamos dentro do planejado?',
  'Quanto cada um gastou?',
]

function CosmicOrb() {
  return (
    <div className="relative w-40 h-40 mx-auto orb-glow">
      <svg viewBox="0 0 160 160" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="orbBase" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#C8BAFF" />
            <stop offset="20%" stopColor="#9B88F8" />
            <stop offset="50%" stopColor="#5A3ED4" />
            <stop offset="75%" stopColor="#2A1580" />
            <stop offset="100%" stopColor="#07091A" />
          </radialGradient>
          <radialGradient id="orbSheen" cx="42%" cy="30%" r="45%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8B7AF5" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#8B7AF5" stopOpacity="0" />
          </radialGradient>
          <clipPath id="orbClip">
            <circle cx="80" cy="80" r="70" />
          </clipPath>
        </defs>
        {/* Ambient glow ring */}
        <circle cx="80" cy="80" r="76" fill="url(#orbGlow)" />
        {/* Main sphere */}
        <circle cx="80" cy="80" r="70" fill="url(#orbBase)" />
        {/* Crystal facets */}
        <g clipPath="url(#orbClip)" opacity="0.55">
          <polygon points="80,14 34,56 80,80" fill="rgba(180,165,255,0.22)" />
          <polygon points="80,14 126,56 80,80" fill="rgba(100,80,200,0.14)" />
          <polygon points="34,56 80,80 18,100" fill="rgba(160,140,255,0.16)" />
          <polygon points="126,56 80,80 142,100" fill="rgba(70,50,180,0.12)" />
          <polygon points="18,100 80,80 80,146" fill="rgba(110,90,230,0.18)" />
          <polygon points="142,100 80,80 80,146" fill="rgba(60,40,160,0.12)" />
          <polygon points="34,56 80,14 80,80" stroke="rgba(200,185,255,0.20)" strokeWidth="0.5" fill="none" />
          <polygon points="126,56 80,14 80,80" stroke="rgba(140,120,220,0.15)" strokeWidth="0.5" fill="none" />
          <line x1="80" y1="14" x2="80" y2="146" stroke="rgba(180,165,255,0.10)" strokeWidth="0.5" />
          <line x1="18" y1="100" x2="142" y2="100" stroke="rgba(160,145,240,0.08)" strokeWidth="0.5" />
          <line x1="34" y1="56" x2="126" y2="56" stroke="rgba(160,145,240,0.08)" strokeWidth="0.5" />
        </g>
        {/* Specular highlight */}
        <ellipse cx="58" cy="50" rx="20" ry="13" fill="url(#orbSheen)" transform="rotate(-18,58,50)" />
        {/* Edge rim light */}
        <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(180,165,255,0.18)" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

function parseInline(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={idx}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={idx} className="bg-white/10 px-1 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>
    return part
  })
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('### ')) {
      elements.push(<p key={i} className="font-bold text-white/90 mt-2 mb-0.5">{parseInline(line.slice(4))}</p>)
    } else if (line.startsWith('## ') || line.startsWith('# ')) {
      const slice = line.startsWith('## ') ? 3 : 2
      elements.push(<p key={i} className="font-bold text-white text-base mt-3 mb-1">{parseInline(line.slice(slice))}</p>)
    } else if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i}>{parseInline(lines[i].slice(2))}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc pl-4 space-y-0.5 my-1">{items}</ul>)
      continue
    } else if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={i}>{parseInline(lines[i].replace(/^\d+\. /, ''))}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal pl-4 space-y-0.5 my-1">{items}</ol>)
      continue
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />)
    } else {
      elements.push(<p key={i} className="leading-relaxed">{parseInline(line)}</p>)
    }
    i++
  }

  return <div className="text-sm space-y-0.5">{elements}</div>
}

function convIdKey(userId: string) {
  return `chat_conv_id_${userId}`
}

function formatarData(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const diff = hoje.getTime() - d.getTime()
  const dias = Math.floor(diff / 86400000)

  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias < 7) return `${dias} dias atrás`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export default function ChatPage() {
  const router = useRouter()
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [historicoRestaurado, setHistoricoRestaurado] = useState(false)
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [conversas, setConversas] = useState<ConversaItem[]>([])
  const [carregandoConversas, setCarregandoConversas] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const userIdRef = useRef<string>('anonymous')
  const convIdRef = useRef<string | null>(null)

  const carregarHistorico = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/chat/history?conversation_id=${conversationId}`)
    if (!res.ok) return []
    const json = await res.json()
    return (json.mensagens ?? []).map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
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
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  async function abrirDrawer() {
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
    try {
      localStorage.setItem(convIdKey(userIdRef.current), conv.id)
    } catch { /* ignore */ }

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

    const novaMensagem: Mensagem = { role: 'user', content: conteudo, ts: Date.now() }
    const historicoOtimista = [...mensagens, novaMensagem]
    setMensagens(historicoOtimista)
    setInput('')
    setCarregando(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pergunta: conteudo,
          conversation_id: convIdRef.current ?? undefined,
          user_id: userIdRef.current,
        }),
      })
      const data = await res.json()

      if (data.conversation_id && !convIdRef.current) {
        convIdRef.current = data.conversation_id
        try {
          localStorage.setItem(convIdKey(userIdRef.current), data.conversation_id)
        } catch { /* ignore */ }
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
        content = 'A chave GEMINI_API_KEY não está configurada.\n\nAdicione a variável de ambiente e faça um novo deploy.'
      } else {
        content = 'Não consegui responder agora. Tente novamente em instantes.'
      }

      setMensagens([...historicoOtimista, { role: 'assistant', content, ts: Date.now() }])
    } catch {
      setMensagens([...historicoOtimista, {
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div
      className="flex flex-col h-screen pb-16"
      style={{ background: 'linear-gradient(165deg, #0D1240 0%, #07091A 40%, #070918 100%)' }}
    >
      {/* Drawer overlay */}
      {drawerAberto && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[190] bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerAberto(false)}
          />
        </ModalPortal>
      )}

      {/* Drawer de conversas anteriores */}
      <ModalPortal>
        <div className={`fixed top-0 left-0 h-full w-80 lg:w-96 max-w-[85vw] z-[200] shadow-2xl flex flex-col transition-transform duration-300 ${drawerAberto ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ background: 'linear-gradient(180deg, #0D1240 0%, #07091A 100%)', borderRight: '1px solid rgba(139,122,245,0.18)' }}
        >
          <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid rgba(139,122,245,0.15)' }}>
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-primary-400" />
              <span className="font-semibold text-white/90 text-sm">Conversas anteriores</span>
            </div>
            <button
              onClick={() => setDrawerAberto(false)}
              className="p-1.5 rounded-full text-white/40 hover:text-white/70 hover:bg-white/10 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => { novaConversa(); setDrawerAberto(false) }}
            className="mx-3 mt-3 mb-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-primary-300 text-sm font-medium transition"
            style={{ background: 'rgba(139,122,245,0.15)', border: '1px solid rgba(139,122,245,0.25)' }}
          >
            <Plus className="w-4 h-4" />
            Nova conversa
          </button>

          <div className="flex-1 overflow-y-auto py-2">
            {carregandoConversas ? (
              <div className="flex justify-center py-8">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-primary-400/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-primary-400/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-primary-400/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            ) : conversas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-white/30">
                <MessageSquare className="w-8 h-8" />
                <p className="text-sm">Nenhuma conversa anterior</p>
              </div>
            ) : (
              <ul className="space-y-0.5 px-2">
                {conversas.map((conv) => {
                  const ativa = conv.id === convIdRef.current
                  return (
                    <li key={conv.id}>
                      <button
                        onClick={() => selecionarConversa(conv)}
                        className={`w-full text-left px-3 py-3 rounded-xl transition flex items-start gap-2.5 group ${
                          ativa ? 'border border-primary-500/30' : 'hover:bg-white/5'
                        }`}
                        style={ativa ? { background: 'rgba(139,122,245,0.15)' } : undefined}
                      >
                        <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${ativa ? 'bg-primary-500/30' : 'bg-white/10'}`}>
                          <Bot className={`w-3.5 h-3.5 ${ativa ? 'text-primary-300' : 'text-white/40'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${ativa ? 'text-primary-200' : 'text-white/70'}`}>
                            {conv.preview}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-white/30">{formatarData(conv.created_at)}</span>
                            <span className="text-[10px] text-white/20">·</span>
                            <span className="text-[10px] text-white/30">{conv.message_count} msgs</span>
                          </div>
                        </div>
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 mt-1 text-white/20 group-hover:text-white/40 transition ${ativa ? 'text-primary-400' : ''}`} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </ModalPortal>

      {/* Header */}
      <div
        className="sticky top-0 z-[10] px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(7,9,26,0.80)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(139,122,245,0.12)',
        }}
      >
        <button
          onClick={() => router.back()}
          className="p-2 rounded-xl text-white/50 hover:text-white/90 hover:bg-white/10 transition shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="font-semibold text-white text-sm">Assistente Financeiro</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={abrirDrawer}
            className="p-2 text-white/40 hover:text-primary-300 hover:bg-white/10 rounded-xl transition"
            title="Histórico de conversas"
          >
            <History className="w-4 h-4" />
          </button>
          {mensagens.length > 0 && (
            <>
              <button
                onClick={novaConversa}
                className="p-2 text-white/40 hover:text-primary-300 hover:bg-white/10 rounded-xl transition"
                title="Nova conversa"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={deletarConversa}
                className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition"
                title="Excluir conversa"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <div className="opacity-80">
            <NotificacoesBell />
          </div>
          <button className="p-2 text-white/40 hover:text-white/70 hover:bg-white/10 rounded-xl transition">
            <Star className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {mensagens.length === 0 && !carregando ? (
          <div className="flex flex-col items-center justify-center py-6 gap-6">
            {/* Cosmic Orb */}
            <CosmicOrb />

            {/* Suggestion grid */}
            <div className="w-full grid grid-cols-2 gap-2.5 mt-1 max-w-sm mx-auto">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="glass-card text-left text-sm px-4 py-3.5 text-white/80 hover:text-white leading-snug active:scale-[0.97] transition-all"
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
                <span className="text-[11px] text-white/30 bg-white/5 border border-white/10 px-3 py-1 rounded-full">
                  Conversa anterior restaurada
                </span>
              </div>
            )}
            {mensagens.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  m.role === 'user'
                    ? 'bg-primary-600'
                    : 'bg-white/10 border border-white/15'
                }`}>
                  {m.role === 'user'
                    ? <User className="w-4 h-4 text-white" />
                    : <Bot className="w-4 h-4 text-primary-300" />
                  }
                </div>
                <div className={`max-w-[82%] lg:max-w-[65%] rounded-2xl px-4 py-2.5 ${
                  m.role === 'user'
                    ? 'rounded-tr-sm text-sm leading-relaxed text-white'
                    : 'rounded-tl-sm text-white/85'
                }`}
                  style={m.role === 'user'
                    ? { background: 'linear-gradient(135deg, #8B7AF5 0%, #6355D8 100%)' }
                    : { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }
                  }
                >
                  {m.role === 'user'
                    ? m.content
                    : <MarkdownContent text={m.content} />
                  }
                </div>
              </div>
            ))}
          </>
        )}

        {carregando && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary-300" />
            </div>
            <div className="rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <span className="w-2 h-2 bg-primary-400/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-primary-400/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-primary-400/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={fimRef} />
      </div>

      {/* Input bar */}
      <div
        className="fixed bottom-16 lg:bottom-0 left-0 right-0 px-4 py-3"
        style={{
          background: 'rgba(7,9,26,0.88)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(139,122,245,0.15)',
        }}
      >
        <div className="max-w-md lg:max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre suas finanças…"
            rows={1}
            disabled={carregando}
            className="flex-1 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none transition-shadow disabled:opacity-50 max-h-32 text-white/90 placeholder-white/30"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(139,122,245,0.22)',
              lineHeight: '1.5',
            }}
            onFocus={e => { e.target.style.borderColor = 'rgba(139,122,245,0.50)'; e.target.style.boxShadow = '0 0 0 3px rgba(139,122,245,0.12)' }}
            onBlur={e => { e.target.style.borderColor = 'rgba(139,122,245,0.22)'; e.target.style.boxShadow = 'none' }}
          />
          <button
            onClick={() => enviar()}
            disabled={!input.trim() || carregando}
            className="w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            style={{ background: 'linear-gradient(135deg, #8B7AF5 0%, #6355D8 100%)', boxShadow: '0 4px 16px rgba(139,122,245,0.45)' }}
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
