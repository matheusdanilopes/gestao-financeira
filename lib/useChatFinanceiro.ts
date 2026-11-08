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
import { aguardarResposta, SEM_SINAL_MS } from '@/lib/chatRecuperacao'
import type { TelaAtual } from '@/lib/ai/types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Ferramentas consultadas para produzir esta resposta (trilha de auditoria). */
  ferramentas?: string[]
  ts: number
  /** Veio do assessor no Telegram (o histórico do bot fica aqui no app). */
  telegram?: boolean
  /** Aviso do servidor sobre esta resposta (ex.: não foi salva no histórico). */
  aviso?: string
  /** Id da mensagem no banco — necessário para avaliar (👍/👎). */
  dbId?: string
  /** 👍 (1) / 👎 (-1) dado pelo usuário. */
  avaliacao?: 1 | -1 | null
}

/** Quantas mensagens da tela vão junto como histórico de reserva. */
const HISTORICO_RESERVA = 18

export interface ChatErro {
  codigo: string
  mensagem: string
}

export interface ConversaResumo {
  id: string
  created_at: string
  preview: string
  message_count: number
  telegram?: boolean
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
  // Conexão do turno: hora do último evento recebido (inclui o ping de 8 s),
  // pedido de reconexão (o app voltou do segundo plano com o stream parado) e
  // pedido para parar de procurar a resposta (botão de parar).
  const ultimoEventoRef = useRef(0)
  const reconectarRef = useRef(false)
  const pararRecuperacaoRef = useRef(false)
  // Espelho de `mensagens` para montar o histórico de reserva sem
  // recriar `enviar` a cada mensagem.
  const mensagensRef = useRef<ChatMessage[]>([])
  useEffect(() => { mensagensRef.current = mensagens }, [mensagens])

  // ── Restauração da última conversa ──
  const carregarHistorico = useCallback(async (conversationId: string): Promise<ChatMessage[]> => {
    const res = await fetch(`/api/chat/history?conversation_id=${encodeURIComponent(conversationId)}`)
    if (!res.ok) return []
    const json = await res.json()
    return ((json.mensagens ?? []) as Array<{
      id?: string; role: string; content: string; created_at?: string; canal?: string
      ferramentas?: Array<{ rotulo?: string }> | null
      avaliacao?: number | null
    }>)
      .map(m => ({
        id: novoId(),
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
        ts: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
        telegram: m.canal === 'telegram',
        ferramentas: Array.isArray(m.ferramentas)
          ? m.ferramentas.map(f => f?.rotulo).filter((r): r is string => typeof r === 'string')
          : undefined,
        dbId: typeof m.id === 'string' ? m.id : undefined,
        avaliacao: m.avaliacao === 1 || m.avaliacao === -1 ? m.avaliacao : null,
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
    reconectarRef.current = false
    pararRecuperacaoRef.current = false
    ultimoEventoRef.current = Date.now()
    let terminou = false

    let acumulado = ''
    let aviso: string | undefined
    const usadas: string[] = []
    // O que está na tela ANTES desta pergunta. O servidor só usa se o
    // histórico gravado tiver menos mensagens (uma gravação que falhou).
    const historico = mensagensRef.current
      .filter(m => !m.content.endsWith('_(interrompido)_'))
      .slice(-HISTORICO_RESERVA)
      .map(m => ({ role: m.role, content: m.content }))

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
          historico,
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
        ultimoEventoRef.current = Date.now()
        if (evento.tipo === 'done' || evento.tipo === 'error') terminou = true
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
          case 'aviso':
            if (typeof evento.dados.texto === 'string') aviso = evento.dados.texto
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
                aviso,
                dbId: typeof evento.dados.message_id === 'string' ? evento.dados.message_id : undefined,
                avaliacao: null,
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
      // Stream fechado sem "done" nem "error": a conexão caiu no meio.
      if (!terminou) throw new Error('stream interrompido')
    } catch (err) {
      const reconectar = reconectarRef.current
      reconectarRef.current = false
      if ((err as Error)?.name === 'AbortError' && !reconectar) {
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
        // A conexão caiu (quase sempre: a pessoa saiu do app no meio da
        // espera). O servidor termina e grava a resposta mesmo assim — busca
        // no histórico antes de falar em erro.
        const convId = convIdRef.current
        let recuperada = false
        if (convId && !descartarParcialRef.current) {
          setTextoParcial('')
          setStatus('A conexão caiu — buscando sua resposta…')
          const historico = await aguardarResposta(
            () => carregarHistorico(convId),
            conteudo,
            () => convIdRef.current === convId && !descartarParcialRef.current && !pararRecuperacaoRef.current,
            { visivel: () => typeof document === 'undefined' || document.visibilityState !== 'hidden' }
          )
          if (historico) {
            setMensagens(historico)
            recuperada = true
          }
        }
        if (!recuperada && !pararRecuperacaoRef.current) {
          setErro({ codigo: 'REDE', mensagem: 'Falha de conexão. Verifique sua internet e tente novamente.' })
        }
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
      setStatus(null)
      setTextoParcial('')
      setFerramentas([])
    }
  }, [tela, guardarConversa, carregarHistorico])

  const cancelar = useCallback(() => {
    pararRecuperacaoRef.current = true
    abortRef.current?.abort()
  }, [])

  // Voltou para o app com uma resposta em andamento e sem sinal do servidor
  // há um tempo: a conexão morreu em segundo plano (alguns navegadores deixam
  // o fetch "pendurado" em vez de falhar). Encerra e vai buscar no histórico.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible' || !abortRef.current) return
      if (Date.now() - ultimoEventoRef.current < SEM_SINAL_MS) return
      reconectarRef.current = true
      abortRef.current.abort()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
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

  // ── Avaliação (👍/👎) ──
  // Otimista: marca na hora e desfaz se o servidor recusar.
  const avaliar = useCallback(async (idLocal: string, valor: 1 | -1 | null, comentario?: string) => {
    const alvo = mensagensRef.current.find(m => m.id === idLocal)
    if (!alvo?.dbId) return
    const anterior = alvo.avaliacao ?? null
    const aplicar = (v: 1 | -1 | null) =>
      setMensagens(prev => prev.map(m => (m.id === idLocal ? { ...m, avaliacao: v } : m)))
    aplicar(valor)
    try {
      const res = await fetch('/api/chat/avaliacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: alvo.dbId, avaliacao: valor, comentario }),
      })
      if (!res.ok) aplicar(anterior)
    } catch {
      aplicar(anterior)
    }
  }, [])

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
    avaliar,
  }
}
