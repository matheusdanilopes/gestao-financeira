'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Sparkles } from 'lucide-react'
import BottomNav from '@/components/BottomNav'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

const SUGESTOES = [
  'Como estamos no orçamento esse mês?',
  'Quais foram os 5 maiores gastos?',
  'Compare esse mês com o anterior',
  'Quanto cada um gastou?',
]

export default function ChatPage() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  async function enviar(texto?: string) {
    const conteudo = (texto ?? input).trim()
    if (!conteudo || carregando) return

    const novaMensagem: Mensagem = { role: 'user', content: conteudo }
    const historico = [...mensagens, novaMensagem]
    setMensagens(historico)
    setInput('')
    setCarregando(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: historico }),
      })
      const data = await res.json()

      if (data.resposta) {
        setMensagens(prev => [...prev, { role: 'assistant', content: data.resposta }])
      } else {
        setMensagens(prev => [...prev, { role: 'assistant', content: 'Erro ao processar sua pergunta. Tente novamente.' }])
      }
    } catch {
      setMensagens(prev => [...prev, { role: 'assistant', content: 'Erro de conexão. Verifique sua internet.' }])
    } finally {
      setCarregando(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <p className="font-semibold text-gray-800">Assistente Financeiro</p>
          <p className="text-xs text-gray-400">Powered by Claude</p>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {mensagens.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
              <Bot className="w-8 h-8 text-blue-400" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-700">Olá! Sou seu assistente financeiro.</p>
              <p className="text-sm text-gray-400 mt-1">Pergunte qualquer coisa sobre as finanças do casal.</p>
            </div>
            <div className="w-full space-y-2 mt-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="w-full text-left text-sm bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition"
                >
                  {s}
                </button>
              ))}
            </div>
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
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-sm'
                : 'bg-white text-gray-800 shadow-sm rounded-tl-sm'
            }`}>
              {m.content}
            </div>
          </div>
        ))}

        {carregando && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-gray-500" />
            </div>
            <div className="bg-white shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
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
