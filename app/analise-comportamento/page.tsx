'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Brain, Sparkles, Loader2, Check, AlertTriangle, FileDown, Copy, RefreshCw, ChevronDown,
  CalendarDays, Store, Layers, Target,
} from 'lucide-react'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import { BlocosAnalise, BlocosMetricas, Diagnostico } from '@/components/comportamento/ResultadoComportamento'
import { lerSSE } from '@/lib/sseStream'
import { copiarTexto, documentoParaMarkdown, exportarRelatorioPdf } from '@/lib/relatorioDocumento'
import { montarDocumentoAnalise, rotuloEscopo } from '@/lib/comportamento/documento'
import { salvarAnalise, useAnalisesSalvas } from '@/lib/comportamento/historico'
import {
  JANELAS_ANALISE,
  OBJETIVOS_ANALISE,
  type EscopoAnalise,
  type JanelaAnalise,
  type MetricasComportamento,
  type ObjetivoAnalise,
  type ParametrosAnalise,
  type ResultadoAnalise,
} from '@/lib/comportamento/tipos'

const OPCOES_JANELA = JANELAS_ANALISE.map(m => ({ valor: m, label: `${m} meses` }))
const OPCOES_ESCOPO: { valor: EscopoAnalise; label: string }[] = [
  { valor: 'casal', label: 'Casal' },
  { valor: 'Matheus', label: 'Matheus' },
  { valor: 'Jeniffer', label: 'Jeniffer' },
]
const LIMITE_CONTEXTO = 400

const ETAPAS = [
  'Lendo todo o seu histórico financeiro',
  'Calculando seus padrões de comportamento',
  'O analista está estudando seus dados',
]

/** Análises mais antigas que isso ganham um aviso de "dados desatualizados". */
const DIAS_ANALISE_ANTIGA = 30

type Fase = 'parado' | 'analisando' | 'erro'

function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

// ─── Formulário do pedido ────────────────────────────────────────────────────

function PainelPedido({
  parametros, onChange, onAnalisar, ocupado, compacto,
}: {
  parametros: ParametrosAnalise
  onChange: (p: ParametrosAnalise) => void
  onAnalisar: () => void
  ocupado: boolean
  compacto: boolean
}) {
  return (
    <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-4">
      {!compacto && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
              <Brain className="w-5 h-5 text-violet-600" strokeWidth={1.8} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 tracking-tight leading-tight">Seu analista financeiro pessoal</h2>
              <p className="text-xs text-gray-500 leading-snug">
                Estuda seus dados a fundo e explica os padrões por trás do seu dinheiro.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { Icon: CalendarDays, texto: 'Dias, semanas e fases do mês em que você mais gasta' },
              { Icon: Store, texto: 'Lugares e categorias que puxam o orçamento' },
              { Icon: Layers, texto: 'Parcelas, microgastos e compras por impulso' },
              { Icon: Target, texto: 'Plano de ação e metas com economia estimada' },
            ].map(({ Icon, texto }) => (
              <div key={texto} className="flex items-start gap-2 rounded-2xl bg-gray-50 border border-gray-100 p-2.5">
                <Icon className="w-3.5 h-3.5 text-violet-500 shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-[11px] text-gray-600 leading-snug">{texto}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">Período analisado</p>
        <SeletorOpcoes
          opcoes={OPCOES_JANELA}
          valor={parametros.janela}
          onChange={v => onChange({ ...parametros, janela: v as JanelaAnalise })}
          ariaLabel="Período analisado"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">De quem</p>
        <SeletorOpcoes
          opcoes={OPCOES_ESCOPO}
          valor={parametros.escopo}
          onChange={v => onChange({ ...parametros, escopo: v })}
          ariaLabel="Escopo da análise"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">O que você quer conquistar</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Objetivo">
          {OBJETIVOS_ANALISE.map(o => {
            const ativo = parametros.objetivo === o.chave
            return (
              <button
                key={o.chave}
                type="button"
                onClick={() => onChange({ ...parametros, objetivo: o.chave as ObjetivoAnalise })}
                aria-pressed={ativo}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-150 tap-scale
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300
                            ${ativo
                              ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="contexto-analise" className="text-xs font-semibold text-gray-700">
          Algo que o analista deve saber? <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <textarea
          id="contexto-analise"
          value={parametros.contexto ?? ''}
          onChange={e => onChange({ ...parametros, contexto: e.target.value.slice(0, LIMITE_CONTEXTO) })}
          rows={2}
          placeholder="Ex.: queremos trocar de carro no fim de 2027; sinto que gasto demais com delivery."
          className="w-full px-3 py-2.5 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-gray-700
                     placeholder:text-gray-400 resize-none
                     focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
      </div>

      <button
        type="button"
        onClick={onAnalisar}
        disabled={ocupado}
        className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white
                   bg-gradient-to-r from-violet-600 to-primary-600 shadow-sm hover:shadow-card-md
                   flex items-center justify-center gap-2 transition-all duration-150 ease-spring
                   active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-400"
      >
        {ocupado
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Analisando…</>
          : <><Sparkles className="w-4 h-4" /> Analisar meu comportamento</>}
      </button>
      <p className="text-[11px] text-gray-400 text-center leading-snug">
        A análise só roda quando você pede. Ela lê todo o período escolhido e leva cerca de 1 minuto.
      </p>
    </section>
  )
}

// ─── Progresso ───────────────────────────────────────────────────────────────

function Progresso({ etapa, segundos }: { etapa: number; segundos: number }) {
  return (
    <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
          <Brain className="w-4 h-4 text-violet-600 animate-pulse" strokeWidth={1.8} />
        </div>
        <h2 className="font-bold text-gray-900 tracking-tight flex-1">Analisando…</h2>
        <span className="text-xs text-gray-400 num">{segundos}s</span>
      </div>
      <ol className="space-y-2">
        {ETAPAS.map((texto, i) => {
          const feito = i < etapa
          const atual = i === etapa
          return (
            <li key={texto} className="flex items-center gap-2.5">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0
                            ${feito ? 'bg-green-500' : atual ? 'bg-violet-100' : 'bg-gray-100'}`}
              >
                {feito
                  ? <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  : atual
                    ? <Loader2 className="w-3 h-3 text-violet-600 animate-spin" />
                    : null}
              </span>
              <span className={`text-xs ${atual ? 'font-semibold text-gray-800' : feito ? 'text-gray-500' : 'text-gray-400'}`}>
                {texto}
              </span>
            </li>
          )
        })}
      </ol>
      {etapa >= 2 && (
        <p className="text-[11px] text-gray-400 leading-snug">
          Enquanto o analista escreve, os números que ele está lendo já aparecem abaixo.
        </p>
      )}
    </section>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function AnaliseComportamentoPage() {
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
        throw new Error(res.status === 401 ? 'Sua sessão expirou. Entre de novo para analisar.' : corpo?.error ?? 'Não foi possível iniciar a análise.')
      }

      for await (const evento of lerSSE(res.body)) {
        if (evento.tipo === 'status') {
          const idx = ETAPAS.indexOf(String(evento.dados.texto ?? ''))
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
    try { await exportarRelatorioPdf(montarDocumentoAnalise(ultima)) }
    catch (err) { console.error('[analise-comportamento] PDF:', err) }
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
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight truncate">Análise de comportamento</h1>
            <p className="text-[11px] text-gray-400 leading-snug truncate">
              {ultima
                ? `Última análise: ${formatarDataHora(ultima.geradaEm)} · ${ultima.parametros.janela} meses · ${rotuloEscopo(ultima.parametros.escopo)}`
                : 'Padrões de comportamento para melhorar sua saúde financeira'}
            </p>
          </div>
          {ultima && !analisando && (
            <button
              type="button"
              onClick={() => setMostrarPedido(v => !v)}
              aria-expanded={mostrarPedido}
              className="shrink-0 px-3 py-2 rounded-xl bg-primary-50 text-primary-700 border border-primary-100
                         text-xs font-semibold flex items-center gap-1.5 hover:bg-primary-100 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span className="sm:hidden">Nova</span>
              <span className="hidden sm:inline">Nova análise</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mostrarPedido ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      <div className="page-content space-y-3">
        {analisando && <Progresso etapa={etapa} segundos={segundos} />}

        {fase === 'erro' && erro && (
          <div className="bg-red-50 border border-red-100 rounded-3xl p-4 flex gap-3" role="alert">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-red-600">A análise não foi concluída</p>
              <p className="text-xs text-red-500">{erro}</p>
            </div>
          </div>
        )}

        {!analisando && mostrarFormulario && (
          <PainelPedido
            parametros={parametros}
            onChange={setParametros}
            onAnalisar={analisar}
            ocupado={analisando}
            compacto={!!ultima}
          />
        )}

        {analisando && previa && <BlocosMetricas metricas={previa} />}

        {!analisando && ultima && (
          <>
            {diasDesde(ultima.geradaEm) >= DIAS_ANALISE_ANTIGA && !mostrarPedido && (
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-3.5 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-xs text-amber-700 leading-snug">
                  Esta análise tem {diasDesde(ultima.geradaEm)} dias — seus dados mudaram desde então. Toque em
                  &ldquo;Nova análise&rdquo; para atualizar.
                </p>
              </div>
            )}

            <Diagnostico analise={ultima.analise} metricas={ultima.metricas} notaAnterior={anterior?.nota ?? null} />
            <BlocosAnalise analise={ultima.analise} metricas={ultima.metricas} />

            <div className="pt-1 space-y-1.5">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">Os números por trás da análise</p>
            </div>
            <BlocosMetricas metricas={ultima.metricas} />

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={baixarPdf}
                disabled={exportando}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2
                           bg-red-600 text-white hover:bg-red-700 shadow-sm transition-all duration-150 ease-spring
                           active:scale-[0.97] disabled:opacity-50"
              >
                <FileDown className={`w-4 h-4 ${exportando ? 'animate-pulse' : ''}`} />
                {exportando ? 'Gerando PDF…' : 'Baixar PDF'}
              </button>
              <button
                type="button"
                onClick={copiar}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2
                           bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-100
                           transition-all duration-150 ease-spring active:scale-[0.97]"
              >
                {copiado ? <><Check className="w-4 h-4" /> Copiado!</> : <><Copy className="w-4 h-4" /> Copiar texto</>}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 text-center leading-snug px-2">
              Os números são calculados pelo app; a interpretação é feita por IA a partir deles. A última análise
              fica salva neste aparelho.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
