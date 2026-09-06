'use client'

/**
 * Estado e transporte do chat financeiro.
 *
 * Toda a conversa com /api/chat acontece aqui: leitura do stream SSE,
 * acumulação da resposta, trilha de ferramentas, cancelamento e reenvio.
 * A tela só desenha o que este hook expõe.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { lerSSE } from '@/lib/sseStream'
import type { TelaAtual } from '@/lib/ai/types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Ferramentas consultadas para produzir esta resposta (trilha de auditoria). */
  ferramentas?: string[]
  ts: number
}

export interface ChatErro {
  codigo: string
  mensagem: string
}

export interface ConversaResumo {
  id: string
  created_at: string
  preview: string
  message_count: number
}

function novoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const chaveConversa = (userId: string) => `chat_conv_id_${userId}`

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChatFinanceiro(tela: TelaAtual = 'geral') {
  const [mensagens, setMensagens] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [textoParcial, setTextoParcial] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [ferramentas, setFerramentas] = useState<string[]>([])
  const [erro, setErro] = useState<ChatErro | null>(null)
  const [restaurada, setRestaurada] = useState(false)
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  // Espelha convIdRef em estado: o drawer e o menu precisam re-renderizar
  // quando a conversa ativa muda, e um ref sozinho não dispara render.
  const [conversationId, setConversationId] = useState<string | null>(null)

  const userIdRef = useRef<string>('anonymous')
  const convIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ultimaPerguntaRef = useRef<string | null>(null)
  // Um cancelamento vindo de "nova conversa"/"abrir conversa" não deve
  // aproveitar o texto parcial: ele pertence à conversa que acabou de sair
  // da tela e apareceria como resposta órfã na conversa nova.
  const descartarParcialRef = useRef(false)

  // ── Restauração da última conversa ──
  const carregarHistorico = useCallback(async (conversationId: string): Promise<ChatMessage[]> => {
    const res = await fetch(`/api/chat/history?conversation_id=${encodeURIComponent(conversationId)}`)
    if (!res.ok) return []
    const json = await res.json()
    return ((json.mensagens ?? []) as Array<{ role: string; content: string; created_at?: string }>)
      .map(m => ({
        id: novoId(),
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
        ts: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
      }))
  }, [])

  useEffect(() => {
    let cancelado = false
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? 'anonymous'
      userIdRef.current = uid

      let salva: string | null = null
      try { salva = localStorage.getItem(chaveConversa(uid)) } catch { /* storage indisponível */ }
      if (!salva || cancelado) return

      convIdRef.current = salva
      setConversationId(salva)
      setCarregandoHistorico(true)
      try {
        const msgs = await carregarHistorico(salva)
        if (!cancelado && msgs.length > 0) {
          setMensagens(msgs)
          setRestaurada(true)
        }
      } catch { /* conversa some silenciosamente; começa uma nova */ }
      if (!cancelado) setCarregandoHistorico(false)
    })
    return () => { cancelado = true }
  }, [carregarHistorico])

  const guardarConversa = useCallback((id: string | null) => {
    convIdRef.current = id
    setConversationId(id)
    try {
      if (id) localStorage.setItem(chaveConversa(userIdRef.current), id)
      else localStorage.removeItem(chaveConversa(userIdRef.current))
    } catch { /* storage indisponível */ }
  }, [])

  // ── Envio ──
  const enviar = useCallback(async (texto: string, opcoes?: { reenvio?: boolean }) => {
    const conteudo = texto.trim()
    if (!conteudo || abortRef.current) return

    const reenvio = opcoes?.reenvio === true

    ultimaPerguntaRef.current = conteudo
    setErro(null)
    setRestaurada(false)
    // Num reenvio a pergunta já está na tela (e já foi gravada no servidor):
    // repetir a bolha duplicaria a mensagem aqui e no histórico.
    if (!reenvio) {
      setMensagens(prev => [...prev, { id: novoId(), role: 'user', content: conteudo, ts: Date.now() }])
    }
    setTextoParcial('')
    setFerramentas([])
    setStatus('Pensando')
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller
    descartarParcialRef.current = false

    let acumulado = ''
    const usadas: string[] = []

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          pergunta: conteudo,
          conversation_id: convIdRef.current ?? undefined,
          tela,
          reenvio,
        }),
      })

      if (!res.ok || !res.body) {
        // Erros anteriores ao stream chegam como JSON com status HTTP.
        let mensagem = 'Não consegui responder agora. Tente novamente em instantes.'
        try {
          const json = await res.json()
          if (typeof json.error === 'string') mensagem = json.error
        } catch { /* resposta não-JSON */ }
        setErro({ codigo: 'HTTP', mensagem })
        return
      }

      for await (const evento of lerSSE(res.body)) {
        switch (evento.tipo) {
          case 'meta': {
            const id = evento.dados.conversation_id
            if (typeof id === 'string' && id !== convIdRef.current) guardarConversa(id)
            break
          }
          case 'status':
            if (typeof evento.dados.texto === 'string') setStatus(evento.dados.texto)
            break
          case 'tool':
            if (typeof evento.dados.rotulo === 'string') {
              usadas.push(evento.dados.rotulo)
              setFerramentas([...usadas])
            }
            break
          case 'delta':
            if (typeof evento.dados.texto === 'string') {
              acumulado += evento.dados.texto
              setTextoParcial(acumulado)
              setStatus(null)
            }
            break
          case 'reset':
            // O texto emitido era um preâmbulo antes de uma consulta.
            acumulado = ''
            setTextoParcial('')
            break
          case 'done': {
            const final = typeof evento.dados.texto === 'string' && evento.dados.texto
              ? evento.dados.texto
              : acumulado
            if (final.trim()) {
              setMensagens(prev => [...prev, {
                id: novoId(),
                role: 'assistant',
                content: final,
                ferramentas: [...usadas],
                ts: Date.now(),
              }])
            }
            acumulado = ''
            setTextoParcial('')
            break
          }
          case 'error': {
            const dados = evento.dados as { codigo?: string; mensagem?: string }
            setErro({
              codigo: dados.codigo ?? 'INTERNO',
              mensagem: dados.mensagem ?? 'Algo falhou ao responder. Tente novamente.',
            })
            break
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // Parada explícita pelo usuário: preserva o que já tinha chegado.
        if (acumulado.trim() && !descartarParcialRef.current) {
          setMensagens(prev => [...prev, {
            id: novoId(),
            role: 'assistant',
            content: `${acumulado}\n\n_(interrompido)_`,
            ferramentas: [...usadas],
            ts: Date.now(),
          }])
        }
      } else {
        setErro({ codigo: 'REDE', mensagem: 'Falha de conexão. Verifique sua internet e tente novamente.' })
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
      setStatus(null)
      setTextoParcial('')
      setFerramentas([])
    }
  }, [tela, guardarConversa])

  const cancelar = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const tentarNovamente = useCallback(() => {
    const pergunta = ultimaPerguntaRef.current
    if (!pergunta) return
    setErro(null)
    void enviar(pergunta, { reenvio: true })
  }, [enviar])

  const novaConversa = useCallback(() => {
    descartarParcialRef.current = true
    abortRef.current?.abort()
    setMensagens([])
    setTextoParcial('')
    setStatus(null)
    setFerramentas([])
    setErro(null)
    setRestaurada(false)
    guardarConversa(null)
  }, [guardarConversa])

  const abrirConversa = useCallback(async (id: string) => {
    descartarParcialRef.current = true
    abortRef.current?.abort()
    setMensagens([])
    setErro(null)
    setRestaurada(false)
    setCarregandoHistorico(true)
    guardarConversa(id)
    try {
      const msgs = await carregarHistorico(id)
      setMensagens(msgs)
      setRestaurada(msgs.length > 0)
    } catch {
      setErro({ codigo: 'HISTORICO', mensagem: 'Não consegui abrir essa conversa.' })
    }
    setCarregandoHistorico(false)
  }, [carregarHistorico, guardarConversa])

  const listarConversas = useCallback(async (): Promise<ConversaResumo[]> => {
    const res = await fetch('/api/chat/conversations')
    if (!res.ok) return []
    const json = await res.json()
    return (json.conversations ?? []) as ConversaResumo[]
  }, [])

  const excluirConversa = useCallback(async (id: string) => {
    if (convIdRef.current === id) novaConversa()
    try {
      await fetch(`/api/chat/conversations?conversation_id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch { /* exclusão é best-effort */ }
  }, [novaConversa])

  return {
    mensagens,
    streaming,
    textoParcial,
    status,
    ferramentas,
    erro,
    restaurada,
    carregandoHistorico,
    conversationId,
    enviar,
    cancelar,
    tentarNovamente,
    novaConversa,
    abrirConversa,
    listarConversas,
    excluirConversa,
  }
}
