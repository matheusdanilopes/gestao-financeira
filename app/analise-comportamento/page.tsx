'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, AlertTriangle, FileDown, Copy, RefreshCw, ChevronDown, Sparkles } from 'lucide-react'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import { RoboAvatar } from '@/components/chat/RoboAvatar'
import { VerDetalhes } from '@/components/comportamento/ResultadoComportamento'
import {
  ConversarComFin, Descobertas, Dicas, ProximoMesSimples, RecadoFin, SaudeSimples, SeloConferencia,
} from '@/components/comportamento/AnaliseFin'
import { lerSSE } from '@/lib/sseStream'
import { copiarTexto, documentoParaMarkdown } from '@/lib/relatorioDocumento'
import { montarDocumentoAnalise, rotuloEscopo } from '@/lib/comportamento/documento'
import { salvarAnalise, useAnalisesSalvas } from '@/lib/comportamento/historico'
import {
  ETAPAS_ANALISE,
  JANELAS_ANALISE,
  type EscopoAnalise,
  type JanelaAnalise,
  type MetricasComportamento,
  type ParametrosAnalise,
  type ResultadoAnalise,
  rotuloJanela,
} from '@/lib/comportamento/tipos'
import PageHeader, { PAGE_HEADER_PILL } from '@/components/PageHeader'

const OPCOES_JANELA = JANELAS_ANALISE.map(m => ({ valor: m, label: rotuloJanela(m) }))
const OPCOES_ESCOPO: { valor: EscopoAnalise; label: string }[] = [
  { valor: 'casal', label: 'Casal' },
  { valor: 'Matheus', label: 'Matheus' },
  { valor: 'Jeniffer', label: 'Jeniffer' },
]

/** Análises mais antigas que isso ganham um aviso de "dados desatualizados". */
const DIAS_ANALISE_ANTIGA = 30

type Fase = 'parado' | 'analisando' | 'erro'

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

// ─── Pedido ──────────────────────────────────────────────────────────────────

function PainelPedido({
  parametros, onChange, onAnalisar, compacto,
}: {
  parametros: ParametrosAnalise
  onChange: (p: ParametrosAnalise) => void
  onAnalisar: () => void
  compacto: boolean
}) {
  return (
    <section className="bg-white rounded-3xl shadow-soft p-4 space-y-4">
      {!compacto && (
        <div className="flex items-start gap-3">
          <RoboAvatar tamanho={52} humor="feliz" titulo="Fin" className="shrink-0" />
          <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-primary-50 px-3.5 py-3 space-y-1">
            <p className="text-[15px] font-bold text-gray-900 leading-snug">Oi! Posso dar uma olhada nos seus gastos?</p>
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Eu leio suas faturas e contas, te conto para onde o dinheiro está indo e mostro onde dá para
              economizar — com o valor de cada dica.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">Qual período?</p>
        <SeletorOpcoes
          opcoes={OPCOES_JANELA}
          valor={parametros.janela}
          onChange={v => onChange({ ...parametros, janela: v as JanelaAnalise })}
          ariaLabel="Período analisado"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">De quem?</p>
        <SeletorOpcoes
          opcoes={OPCOES_ESCOPO}
          valor={parametros.escopo}
          onChange={v => onChange({ ...parametros, escopo: v })}
          ariaLabel="De quem são os gastos analisados"
        />
      </div>

      <button
        type="button"
        onClick={onAnalisar}
        className="w-full py-3.5 rounded-full font-semibold text-sm text-white bg-primary-600 flex items-center justify-center gap-2 transition-all duration-150 ease-spring active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400"
      >
        <Sparkles className="w-4 h-4" /> Pedir análise ao Fin
      </button>
      <p className="text-[11px] text-gray-400 text-center leading-snug">Leva cerca de 1 minuto.</p>
    </section>
  )
}

// ─── Progresso ───────────────────────────────────────────────────────────────

function Progresso({ etapa, segundos }: { etapa: number; segundos: number }) {
  return (
    <section className="bg-white rounded-3xl shadow-soft p-4 space-y-3" aria-live="polite">
      <div className="flex items-center gap-3">
        <RoboAvatar tamanho={44} humor="pensando" titulo="Fin pensando" className="shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-900 tracking-tight">O Fin está analisando…</h2>
          <p className="text-[11px] text-gray-400">Pode levar até 1 minuto. Não feche esta tela.</p>
        </div>
        <span className="text-xs text-gray-400 num">{segundos}s</span>
      </div>
      <ol className="space-y-2">
        {ETAPAS_ANALISE.map((texto, i) => {
          const feito = i < etapa
          const atual = i === etapa
          return (
            <li key={texto} className="flex items-center gap-2.5">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0
                            ${feito ? 'bg-green-500' : atual ? 'bg-primary-100' : 'bg-gray-100'}`}
              >
                {feito
                  ? <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  : atual
                    ? <Loader2 className="w-3 h-3 text-primary-600 animate-spin" />
                    : null}
              </span>
              <span className={`text-xs ${atual ? 'font-semibold text-gray-800' : feito ? 'text-gray-500' : 'text-gray-400'}`}>
                {texto}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function AnaliseDoFinPage() {
  const { ultima, historico } = useAnalisesSalvas()
  const [parametros, setParametros] = useState<ParametrosAnalise>({ janela: 12, escopo: 'casal', objetivo: 'entender' })
  const [fase, setFase] = useState<Fase>('parado')
  const [etapa, setEtapa] = useState(0)
  const [segundos, setSegundos] = useState(0)
  const [previa, setPrevia] = useState<MetricasComportamento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarPedido, setMostrarPedido] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Cronômetro só enquanto a análise roda.
  useEffect(() => {
    if (fase !== 'analisando') return
    const inicio = Date.now()
    const id = setInterval(() => setSegundos(Math.round((Date.now() - inicio) / 1000)), 1000)
    return () => clearInterval(id)
  }, [fase])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function analisar() {
    if (fase === 'analisando') return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setFase('analisando')
    setEtapa(0)
    setSegundos(0)
    setPrevia(null)
    setErro(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })

    let concluiu = false
    try {
      const res = await fetch('/api/analise-comportamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parametros),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const corpo = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(res.status === 401 ? 'Sua sessão expirou. Entre de novo para pedir a análise.' : corpo?.error ?? 'Não foi possível iniciar a análise.')
      }

      for await (const evento of lerSSE(res.body)) {
        if (evento.tipo === 'status') {
          const idx = (ETAPAS_ANALISE as readonly string[]).indexOf(String(evento.dados.texto ?? ''))
          if (idx >= 0) setEtapa(idx)
        } else if (evento.tipo === 'metricas') {
          setPrevia(evento.dados.metricas as MetricasComportamento)
        } else if (evento.tipo === 'done') {
          salvarAnalise(evento.dados.resultado as ResultadoAnalise)
          concluiu = true
        } else if (evento.tipo === 'error') {
          throw new Error(String(evento.dados.mensagem ?? 'A análise falhou.'))
        }
      }
      if (!concluiu) throw new Error('A conexão caiu antes de a análise terminar. Tente de novo.')
      setFase('parado')
      setMostrarPedido(false)
      setPrevia(null)
    } catch (err) {
      if (controller.signal.aborted) return
      setErro(err instanceof Error ? err.message : 'A análise falhou. Tente de novo.')
      setFase('erro')
    }
  }

  async function baixarPdf() {
    if (!ultima || exportando) return
    setExportando(true)
    try {
      // PDF visual (gráficos) carregado só quando pedido: arrasta jsPDF e Chart.js.
      const { exportarAnalisePdf } = await import('@/lib/comportamento/pdf')
      await exportarAnalisePdf(ultima)
    }
    catch (err) { console.error('[analise-fin] PDF:', err) }
    finally { setExportando(false) }
  }

  async function copiar() {
    if (!ultima) return
    const ok = await copiarTexto(documentoParaMarkdown(montarDocumentoAnalise(ultima)))
    if (ok) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    }
  }

  const analisando = fase === 'analisando'
  // Nota da análise anterior com o mesmo recorte — comparar 6 com 24 meses não diz nada.
  const anterior = ultima
    ? [...historico].reverse().find(h =>
        h.geradaEm !== ultima.geradaEm && h.janela === ultima.parametros.janela && h.escopo === ultima.parametros.escopo)
    : undefined
  const mostrarFormulario = !ultima || mostrarPedido || fase === 'erro'

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <PageHeader
        title="Análise do Fin"
        subtitle={
          <span className="block truncate">
            {ultima
              ? `${formatarData(ultima.geradaEm)} · ${rotuloJanela(ultima.parametros.janela)} · ${rotuloEscopo(ultima.parametros.escopo)}`
              : 'Para onde vai seu dinheiro e como fazer sobrar mais'}
          </span>
        }
        actions={ultima && !analisando ? (
          <button
            type="button"
            onClick={() => setMostrarPedido(v => !v)}
            aria-expanded={mostrarPedido}
            className={PAGE_HEADER_PILL}
          >
            <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} />
            <span className="sm:hidden">Nova</span>
            <span className="hidden sm:inline">Nova análise</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mostrarPedido ? 'rotate-180' : ''}`} />
          </button>
        ) : undefined}
      />

      <div className="page-content space-y-3">
        {analisando && <Progresso etapa={etapa} segundos={segundos} />}

        {fase === 'erro' && erro && (
          <div className="bg-red-50 rounded-3xl p-4 flex gap-3" role="alert">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-red-600">O Fin não conseguiu terminar a análise</p>
              <p className="text-xs text-red-500">{erro}</p>
            </div>
          </div>
        )}

        {!analisando && mostrarFormulario && (
          <PainelPedido
            parametros={parametros}
            onChange={setParametros}
            onAnalisar={analisar}
            compacto={!!ultima}
          />
        )}

        {/* Enquanto o Fin escreve, o número mais útil já aparece. */}
        {analisando && previa?.proximoMes && <ProximoMesSimples p={previa.proximoMes} />}

        {!analisando && ultima && (
          <>
            {diasDesde(ultima.geradaEm) >= DIAS_ANALISE_ANTIGA && !mostrarPedido && (
              <div className="bg-amber-50 rounded-3xl p-3.5 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-xs text-amber-700 leading-snug">
                  Esta análise tem {diasDesde(ultima.geradaEm)} dias — seus gastos mudaram desde então. Toque em
                  &ldquo;Nova&rdquo; para o Fin olhar de novo.
                </p>
              </div>
            )}

            <RecadoFin analise={ultima.analise} />
            <SaudeSimples metricas={ultima.metricas} notaAnterior={anterior?.nota ?? null} />
            {ultima.metricas.proximoMes && <ProximoMesSimples p={ultima.metricas.proximoMes} />}
            <Descobertas analise={ultima.analise} />
            <Dicas analise={ultima.analise} />
            <ConversarComFin />
            <SeloConferencia analise={ultima.analise} />

            <VerDetalhes metricas={ultima.metricas} analise={ultima.analise} />

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={baixarPdf}
                disabled={exportando}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2
                           bg-white text-gray-700 shadow-soft hover:bg-gray-50 transition-all duration-150 ease-spring
                           active:scale-[0.97] disabled:opacity-50"
              >
                <FileDown className={`w-4 h-4 ${exportando ? 'animate-pulse' : ''}`} />
                {exportando ? 'Gerando PDF…' : 'Baixar PDF'}
              </button>
              <button
                type="button"
                onClick={copiar}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 bg-white text-gray-700 shadow-soft hover:bg-gray-50 transition-all duration-150 ease-spring active:scale-[0.97]"
              >
                {copiado ? <><Check className="w-4 h-4" /> Copiado!</> : <><Copy className="w-4 h-4" /> Copiar texto</>}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 text-center leading-snug px-2">
              Os números e a economia das dicas são calculados pelo app; o Fin explica o que eles significam.
              A última análise fica salva neste aparelho.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
