'use client'

/**
 * "Hey Gestor" — ativa o microfone para uma pergunta sem tocar em nada, só
 * falando a palavra-chave.
 *
 * Isso NÃO é um microfone sempre ligado como um alto-falante dedicado: o
 * navegador só permite o reconhecimento de fala enquanto a aba está aberta e
 * visível, e o suspende assim que ela vai para segundo plano ou a tela
 * bloqueia — por isso o reavaliar() abaixo religa/desliga a escuta a cada
 * mudança de visibilidade em vez de assumir que ela roda para sempre.
 *
 * Reconhecimento contínuo (`continuous: true`) é reiniciado pelo próprio
 * navegador de tempos em tempos mesmo sem erro — o onend cuida de religar.
 */

import { useEffect, useRef } from 'react'
import { useHeyGestorAtivo } from './heyGestorStore'
import { microfoneOcupado, aoMudarMicrofone } from './voiceLock'

interface SpeechRecognitionResultLike {
  isFinal: boolean
  [index: number]: { transcript: string }
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultLike[]
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: Event) => void) | null
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

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const FRASES_GATILHO = ['hey gestor', 'ei gestor', 'e gestor', 'oi gestor', 'hei gestor', 'eai gestor', 'ai gestor']

/** "gestor" sozinho só conta numa frase curta — evita disparo por menção incidental ("liguei pro gestor do banco"). */
function contemPalavraChave(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9]+/g, ' ').trim()
  if (!t) return false
  if (FRASES_GATILHO.some(f => t.includes(f))) return true
  const palavras = t.split(' ').filter(Boolean)
  return palavras.includes('gestor') && palavras.length <= 3
}

/** Duração do cooldown após detectar a palavra-chave: tempo para a pergunta real ser capturada em /chat. */
const COOLDOWN_MS = 8_000
const INTERVALO_REAVALIACAO_MS = 1_000

export function useWakeWord(opcoes: { habilitado: boolean; onDetectado: () => void }): void {
  const { habilitado, onDetectado } = opcoes
  const onDetectadoRef = useRef(onDetectado)
  useEffect(() => { onDetectadoRef.current = onDetectado })

  const [heyGestorAtivo] = useHeyGestorAtivo()
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const emCooldownRef = useRef(false)

  useEffect(() => {
    const construtor = obterConstructor()
    if (!construtor || !habilitado || !heyGestorAtivo) return
    const ctor: SpeechRecognitionCtor = construtor

    let cancelado = false

    function podeEscutar(): boolean {
      return (
        !cancelado &&
        document.visibilityState === 'visible' &&
        !microfoneOcupado() &&
        !window.speechSynthesis?.speaking &&
        !emCooldownRef.current
      )
    }

    function iniciar(): void {
      if (recognitionRef.current || !podeEscutar()) return

      const recognition = new ctor()
      recognition.lang = 'pt-BR'
      recognition.continuous = true
      recognition.interimResults = false

      recognition.onresult = ev => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const resultado = ev.results[i]
          if (resultado.isFinal && contemPalavraChave(resultado[0].transcript)) {
            emCooldownRef.current = true
            recognitionRef.current?.stop()
            onDetectadoRef.current()
            setTimeout(() => { emCooldownRef.current = false }, COOLDOWN_MS)
            break
          }
        }
      }
      // Erros são frequentes e esperados em escuta contínua de fundo
      // ('no-speech', blips de rede): o onend cuida de tentar de novo.
      recognition.onerror = () => { recognitionRef.current = null }
      recognition.onend = () => {
        recognitionRef.current = null
        if (podeEscutar()) setTimeout(iniciar, 300)
      }

      recognitionRef.current = recognition
      try { recognition.start() } catch { recognitionRef.current = null }
    }

    function parar(): void {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }

    function reavaliar(): void {
      if (podeEscutar()) iniciar()
      else parar()
    }

    iniciar()

    document.addEventListener('visibilitychange', reavaliar)
    const desinscreverLock = aoMudarMicrofone(reavaliar)
    // speechSynthesis não emite evento global de início/fim de fala: um
    // polling leve é o único jeito de saber quando ela termina para retomar.
    const intervalo = window.setInterval(reavaliar, INTERVALO_REAVALIACAO_MS)

    return () => {
      cancelado = true
      document.removeEventListener('visibilitychange', reavaliar)
      desinscreverLock()
      window.clearInterval(intervalo)
      parar()
    }
  }, [habilitado, heyGestorAtivo])
}
