'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Sparkles, Trash2, Plus } from 'lucide-react'
import BottomNav from '@/components/BottomNav'
import NotificacoesBell from '@/components/NotificacoesBell'
import { supabase } from '@/lib/supabaseClient'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
  ts?: number
}

const SUGESTOES = [
  'Como estamos no orçamento esse mês?',
  'Quais foram os 5 maiores gastos?',
  'Compare esse mês com o anterior',
  'Quanto cada um gastou?',
  'Quais categorias gastamos mais?',
  'Estamos dentro do planejado?',
]

function parseInline(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={idx}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={idx} className="bg-gray-100 px-1 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>
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
      elements.push(<p key={i} className="font-bold text-gray-800 mt-2 mb-0.5">{parseInline(line.slice(4))}</p>)
    } else if (line.startsWith('## ') || line.startsWith('# ')) {
      const slice = line.startsWith('## ') ? 3 : 2
      elements.push(<p key={i} className="font-bold text-gray-900 text-base mt-3 mb-1">{parseInline(line.slice(slice))}</p>)
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

function storageKey(userId: string) {
  return `chat_history_${userId}`
}

export default function ChatPage() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [historicoRestaurado, setHistoricoRestaurado] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const userIdRef = useRef<string>('anonymous')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? 'anonymous'
      userIdRef.current = uid
      try {
        const saved = localStorage.getItem(storageKey(uid))
        if (saved) {
          setMensagens(JSON.parse(saved))
          setHistoricoRestaurado(true)
        }
      } catch {
        // ignore parse errors
      }
    })
  }, [])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  function salvar(msgs: Mensagem[]) {
    try {
      if (msgs.length > 0) {
        localStorage.setItem(storageKey(userIdRef.current), JSON.stringify(msgs))
      } else {
        localStorage.removeItem(storageKey(userIdRef.current))
      }
    } catch {
      // ignore storage errors (quota, private mode)
    }
  }

  async function enviar(texto?: string) {
    const conteudo = (texto ?? input).trim()
    if (!conteudo || carregando) return

    const novaMensagem: Mensagem = { role: 'user', content: conteudo, ts: Date.now() }
    const historico = [...mensagens, novaMensagem]
    setMensagens(historico)
    salvar(historico)
    setInput('')
    setCarregando(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: historico }),
      })
      const data = await res.json()

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
      const completo = [...historico, { role: 'assistant' as const, content, ts: Date.now() }]
      setMensagens(completo)
      salvar(completo)
    } catch {
      const completo = [...historico, {
        role: 'assistant' as const,
        content: 'Erro de conexão. Verifique sua internet e tente novamente.',
        ts: Date.now(),
      }]
      setMensagens(completo)
      salvar(completo)
    } finally {
      setCarregando(false)
      inputRef.current?.focus()
    }
  }

  function novaConversa() {
    setMensagens([])
    setHistoricoRestaurado(false)
    try { localStorage.removeItem(storageKey(userIdRef.current)) } catch { /* ignore */ }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800">Assistente Financeiro</p>
          <p className="text-xs text-gray-400">Powered by Gemini</p>
        </div>
        <div className="flex items-center gap-1">
          {mensagens.length > 0 && (
            <>
              <button
                onClick={novaConversa}
                className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition"
                title="Nova conversa"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={novaConversa}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition"
                title="Limpar conversa"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <NotificacoesBell />
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {mensagens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
              <Bot className="w-8 h-8 text-blue-400" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-700">Olá! Sou seu assistente financeiro.</p>
              <p className="text-sm text-gray-400 mt-1">Analiso os dados do mês e respondo suas perguntas.</p>
            </div>
            <div className="w-full grid grid-cols-2 gap-2 mt-1">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="text-left text-xs bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition leading-snug"
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
                <span className="text-[11px] text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                  Conversa anterior restaurada
                </span>
              </div>
            )}
            {mensagens.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  m.role === 'user' ? 'bg-blue-600' : 'bg-gray-100'
                }`}>
                  {m.role === 'user'
                    ? <User className="w-4 h-4 text-white" />
                    : <Bot className="w-4 h-4 text-gray-500" />
                  }
                </div>
                <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-sm text-sm leading-relaxed'
                    : 'bg-white text-gray-800 shadow-sm rounded-tl-sm'
                }`}>
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
            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-gray-500" />
            </div>
            <div className="bg-white shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={fimRef} />
      </div>

      {/* Input */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3">
        <div className="max-w-md mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre suas finanças..."
            rows={1}
            disabled={carregando}
            className="flex-1 bg-gray-50 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 max-h-32"
            style={{ lineHeight: '1.5' }}
          />
          <button
            onClick={() => enviar()}
            disabled={!input.trim() || carregando}
            className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center transition hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
