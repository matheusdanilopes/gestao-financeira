'use client'

/**
 * Voz do assistente: reconhecimento de fala (pergunta por voz) e síntese de
 * fala (resposta falada), num único hook porque as duas pontas se coordenam
 * (falar cancela escuta e vice-versa) e a tela só quer ligar/desligar.
 *
 * Ambas as APIs são nativas do navegador (Web Speech API) — sem custo e sem
 * round-trip a um serviço externo. O suporte varia por navegador (Safari em
 * PWA instalado no iOS é o caso mais frágil), por isso tudo aqui é opcional:
 * a tela verifica `suportaEscuta`/`suportaFala` e esconde os controles quando
 * a API não existe, em vez de quebrar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ocuparMicrofone, liberarMicrofone } from './voiceLock'

const CHAVE_AUTO_FALAR = 'chat_falar_respostas'

interface SpeechRecognitionResultLike {
  isFinal: boolean
  [index: number]: { transcript: string }
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultLike[]
}
interface SpeechRecognitionErrorEventLike extends Event {
  error?: string
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function obterConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Checagem de suporte sem instanciar o hook inteiro — usada por telas que só
 * precisam decidir se mostram um atalho de voz (ex.: o FAB de lançamento
 * rápido), sem precisar de toda a lógica de escuta/fala.
 */
export function suportaReconhecimentoVoz(): boolean {
  return obterConstructor() !== null
}

/** Remove marcação markdown para a fala não soar "asterisco asterisco". */
function paraFala(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export interface OpcoesEscuta {
  /** Chamado a cada trecho reconhecido, incluindo parciais ainda não confirmados. */
  onParcial?: (texto: string) => void
  /** Chamado uma vez, quando a escuta termina com transcrição não-vazia. */
  onResultado: (texto: string) => void
  onErro?: (mensagem: string) => void
}

export function useVoice() {
  const [suportaEscuta, setSuportaEscuta] = useState(false)
  const [suportaFala, setSuportaFala] = useState(false)
  const [ouvindo, setOuvindo] = useState(false)
  const [falando, setFalando] = useState(false)
  const [autoFalar, setAutoFalarState] = useState(true)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const vozRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    // Detecção de suporte roda no cliente; setState precisa ficar fora do
    // corpo síncrono do efeito (mesma convenção de lib/useRelatorio.ts) para
    // não disparar a regra react-hooks/set-state-in-effect.
    Promise.resolve().then(() => {
      setSuportaEscuta(obterConstructor() !== null)
      setSuportaFala(typeof window !== 'undefined' && 'speechSynthesis' in window)
      try {
        const salvo = localStorage.getItem(CHAVE_AUTO_FALAR)
        if (salvo !== null) setAutoFalarState(salvo === '1')
      } catch { /* storage indisponível */ }
    })
  }, [])

  // A lista de vozes carrega de forma assíncrona em alguns navegadores.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    function escolher() {
      const vozes = window.speechSynthesis.getVoices()
      vozRef.current = vozes.find(v => v.lang === 'pt-BR') ?? vozes.find(v => v.lang?.startsWith('pt')) ?? null
    }
    escolher()
    window.speechSynthesis.onvoiceschanged = escolher
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [])

  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      liberarMicrofone()
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  const setAutoFalar = useCallback((valor: boolean) => {
    setAutoFalarState(valor)
    try { localStorage.setItem(CHAVE_AUTO_FALAR, valor ? '1' : '0') } catch { /* storage indisponível */ }
  }, [])

  const pararFala = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    setFalando(false)
  }, [])

  const falar = useCallback((texto: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const limpo = paraFala(texto)
    if (!limpo) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(limpo)
    utter.lang = 'pt-BR'
    if (vozRef.current) utter.voice = vozRef.current
    utter.onstart = () => setFalando(true)
    utter.onend = () => setFalando(false)
    utter.onerror = () => setFalando(false)
    window.speechSynthesis.speak(utter)
  }, [])

  const pararEscuta = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const iniciarEscuta = useCallback((opcoes: OpcoesEscuta) => {
    const Ctor = obterConstructor()
    if (!Ctor) {
      opcoes.onErro?.('Reconhecimento de voz não é suportado neste navegador.')
      return
    }
    recognitionRef.current?.abort()
    pararFala()
    // Sinaliza a escuta de fundo do "Hey Gestor" para parar imediatamente —
    // as duas não podem disputar o mesmo microfone ao mesmo tempo.
    ocuparMicrofone()

    const recognition = new Ctor()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    let transcricaoFinal = ''

    recognition.onresult = ev => {
      let parcial = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const resultado = ev.results[i]
        const texto = resultado[0].transcript
        if (resultado.isFinal) transcricaoFinal += texto
        else parcial += texto
      }
      opcoes.onParcial?.((transcricaoFinal + parcial).trim())
    }

    recognition.onerror = ev => {
      const mensagem = ev.error === 'not-allowed' || ev.error === 'permission-denied'
        ? 'Permissão de microfone negada.'
        : ev.error === 'no-speech'
          ? 'Não entendi, tente de novo.'
          : 'Falha no reconhecimento de voz.'
      opcoes.onErro?.(mensagem)
    }

    recognition.onend = () => {
      setOuvindo(false)
      // Só libera se esta ainda é a sessão ativa: um abort() para trocar de
      // sessão (início de uma nova escuta) não pode liberar o lock que a
      // sessão nova acabou de reivindicar.
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
        liberarMicrofone()
      }
      if (transcricaoFinal.trim()) opcoes.onResultado(transcricaoFinal.trim())
    }

    recognitionRef.current = recognition
    setOuvindo(true)
    recognition.start()
  }, [pararFala])

  return {
    suportaEscuta,
    suportaFala,
    ouvindo,
    falando,
    autoFalar,
    setAutoFalar,
    iniciarEscuta,
    pararEscuta,
    falar,
    pararFala,
  }
}
