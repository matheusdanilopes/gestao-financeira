'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { LucideIcon } from 'lucide-react'
import {
  Brain, Activity, CalendarDays, Store, TrendingUp, TrendingDown, Zap, ShieldCheck,
  AlertTriangle, ListChecks, HelpCircle, Info, Layers, Coins, Minus,
  CalendarCheck, Receipt, ChevronDown, Sparkle, Scale, PieChart,
  Wallet, PiggyBank, Repeat, ShoppingBag, Gauge, Calculator, BarChart3, MessageSquareText,
} from 'lucide-react'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import { formatBRL } from '@/lib/format'
import { formatarPercentual } from '@/lib/relatoriosFormat'
import { rotuloMesIso } from '@/lib/comportamento/documento'
import {
  corDaRampa,
  graficoCategorias,
  graficoReceitaGasto,
  graficoSaldo,
  type TemaGrafico,
} from '@/lib/comportamento/graficos'
import { PESOS_SAUDE, destaqueCurto } from '@/lib/comportamento/tipos'
import type {
  AnaliseIA, Comparativo, FixoVariavel, LancamentoFatura, MesFoco, MetricasComportamento, Nivel, ProximoMes,
} from '@/lib/comportamento/tipos'

// Chart.js só é baixado quando há um resultado para desenhar.
const GraficoComportamento = dynamic(() => import('./GraficoComportamento'), {
  ssr: false,
  loading: () => <div className="h-[200px] rounded-2xl skeleton" />,
})

const BRL_INTEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
/** "R$ 1.235" — nas tabelas da conta, onde os centavos só ocupam espaço. */
const brlInteiro = (v: number) => BRL_INTEIRO.format(Number.isFinite(v) ? v : 0)
const NUM_INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
/** "1.235" — nas tabelas de 5 colunas, onde nem o "R$" cabe numa tela de celular. */
const numInteiro = (v: number) => NUM_INTEIRO.format(Number.isFinite(v) ? v : 0)

const mesCurto = (mes: string) => rotuloMesIso(mes).replace(/\/\d{2}(\d{2})$/, '/$1')

// ─── Peças ───────────────────────────────────────────────────────────────────

export function Cartao({
  titulo, Icon, corIcone, corFundo, children, subtitulo,
}: {
  titulo: string
  Icon: LucideIcon
  corIcone: string
  corFundo: string
  subtitulo?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl ${corFundo} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${corIcone}`} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-gray-900 tracking-tight leading-tight">{titulo}</h2>
          {subtitulo && <p className="text-[11px] text-gray-400 leading-snug">{subtitulo}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

/** "Como calculei": a conta por trás de um número, aberta só quando pedida. */
function ComoCalculei({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl bg-gray-50 border border-gray-100">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-1.5 px-3 py-2
                          text-[11px] font-semibold text-primary-700 rounded-2xl
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
        <Calculator className="w-3.5 h-3.5" strokeWidth={2} />
        Como calculei
        <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 space-y-2 text-[11px] text-gray-600 leading-snug">{children}</div>
    </details>
  )
}

/** Uma conta em linhas: + receita, − despesas, = resultado. */
function Conta({ linhas }: {
  linhas: Array<{ rotulo: string; detalhe?: string; valor: number; sinal: '+' | '−' | '='; cor?: string }>
}) {
  return (
    <ul className="space-y-1">
      {linhas.map(l => (
        <li
          key={l.rotulo}
          className={`flex items-baseline justify-between gap-2 ${l.sinal === '=' ? 'border-t border-gray-100 pt-1' : ''}`}
        >
          <span className={`text-xs min-w-0 ${l.sinal === '=' ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
            {l.rotulo}{l.detalhe && <span className="text-[10px] text-gray-400"> · {l.detalhe}</span>}
          </span>
          <span className={`text-xs num shrink-0 ${l.sinal === '=' ? 'font-bold' : 'font-semibold'} ${l.cor ?? (l.sinal === '−' ? 'text-gray-500' : 'text-gray-900')}`}>
            {l.sinal === '=' ? '' : `${l.sinal} `}{formatBRL(l.valor)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Seção que abre e fecha; o conteúdo (e os gráficos) só monta quando aberta. */
function Recolhivel({ titulo, subtitulo, Icon, children }: {
  titulo: string
  subtitulo: string
  Icon: LucideIcon
  children: React.ReactNode
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        className="w-full bg-white rounded-3xl shadow-card border border-gray-100 p-4 flex items-center gap-3 text-left
                   hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-gray-600" strokeWidth={1.8} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 tracking-tight leading-tight">{titulo}</p>
          <p className="text-[11px] text-gray-400 leading-snug">{subtitulo}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && children}
    </>
  )
}

function corNota(nota: number): { texto: string; traco: string; barra: string } {
  if (nota >= 75) return { texto: 'text-green-600', traco: '#16a34a', barra: 'bg-green-500' }
  if (nota >= 50) return { texto: 'text-amber-600', traco: '#d97706', barra: 'bg-amber-500' }
  return { texto: 'text-red-500', traco: '#ef4444', barra: 'bg-red-500' }
}

export function rotuloNota(nota: number): string {
  if (nota >= 85) return 'Excelente'
  if (nota >= 75) return 'Saudável'
  if (nota >= 50) return 'Atenção'
  if (nota >= 30) return 'Frágil'
  return 'Crítica'
}

export function AnelNota({ nota, tamanho = 96 }: { nota: number; tamanho?: number }) {
  const raio = 42
  const circ = 2 * Math.PI * raio
  const cor = corNota(nota)
  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={raio} fill="none" stroke="currentColor" strokeWidth="9" className="text-gray-100" />
        <circle
          cx="50" cy="50" r={raio} fill="none" stroke={cor.traco} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - nota / 100)}
          style={{ transition: 'stroke-dashoffset 900ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold num leading-none ${cor.texto}`}>{nota}</span>
        <span className="text-[10px] text-gray-400 mt-0.5">de 100</span>
      </div>
    </div>
  )
}

const ESTILO_NIVEL: Record<Nivel, string> = {
  alta: 'bg-red-50 text-red-600 border-red-100',
  media: 'bg-amber-50 text-amber-700 border-amber-100',
  baixa: 'bg-gray-50 text-gray-500 border-gray-100',
}

function Chip({ children, classe }: { children: React.ReactNode; classe: string }) {
  return (
    <span className={`text-[10px] font-semibold rounded-lg px-1.5 py-0.5 border whitespace-nowrap ${classe}`}>
      {children}
    </span>
  )
}

// ─── Diagnóstico (topo): nota com cada indicador à vista ─────────────────────

export function Diagnostico({
  analise: a, metricas: m, notaAnterior,
}: {
  analise: AnaliseIA
  metricas: MetricasComportamento
  notaAnterior: number | null
}) {
  const nota = m.saude.nota
  const delta = notaAnterior === null ? null : nota - notaAnterior
  const indicadores = m.saude.indicadores.map(i => ({ ...i, peso: PESOS_SAUDE[i.chave] ?? 0 }))
  const pesoTotal = indicadores.reduce((s, i) => s + i.peso, 0)
  const pontos = indicadores.reduce((s, i) => s + i.nota * i.peso, 0)

  return (
    <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-4">
      <div className="flex items-center gap-4">
        <AnelNota nota={nota} />
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            Saúde financeira · <span className={corNota(nota).texto}>{rotuloNota(nota)}</span>
          </p>
          {delta !== null && (
            <p className={`text-[11px] font-semibold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {delta === 0 ? 'Igual à análise anterior' : `${delta > 0 ? '+' : ''}${delta} pontos desde a anterior`}
            </p>
          )}
          <p className="text-sm font-bold text-gray-900 leading-snug">{a.manchete}</p>
        </div>
      </div>

      {a.resumo && (
        <p className="text-xs text-gray-600 leading-relaxed">
          <span className="font-semibold text-violet-700">{a.perfil.nome}.</span> {a.resumo.replace(/\n+/g, ' ')}
        </p>
      )}

      {indicadores.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700">O que forma a nota</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
            {indicadores.map(i => (
              <li key={i.chave} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-gray-800 truncate">{i.nome}</span>
                  <span className={`text-xs font-bold num shrink-0 ${corNota(i.nota).texto}`}>{i.nota}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full ${corNota(i.nota).barra}`} style={{ width: `${Math.max(2, i.nota)}%` }} />
                </div>
                <p className="text-[11px] text-gray-500 leading-snug">
                  {i.medida} <span className="text-gray-400">· ideal: {i.referencia}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pesoTotal > 0 && (
        <ComoCalculei>
          <p>
            A nota é calculada pelo app, não pela IA: os mesmos dados sempre dão a mesma nota. Cada indicador
            vale 100 quando atinge o ideal e cai até 0 conforme se afasta dele. A nota geral é a média ponderada:
          </p>
          <table className="w-full num">
            <thead>
              <tr className="text-[10px] text-gray-400 text-right">
                <th className="text-left font-medium py-0.5">Indicador</th>
                <th className="font-medium">Nota</th>
                <th className="font-medium">Peso</th>
                <th className="font-medium">Pontos</th>
              </tr>
            </thead>
            <tbody>
              {indicadores.map(i => (
                <tr key={i.chave} className="text-right border-t border-gray-100">
                  <td className="text-left py-0.5 pr-2">{i.nome}</td>
                  <td>{i.nota}</td>
                  <td>× {i.peso}</td>
                  <td>{i.nota * i.peso}</td>
                </tr>
              ))}
              <tr className="text-right border-t border-gray-200 font-semibold text-gray-900">
                <td className="text-left py-0.5">Total</td>
                <td />
                <td>{pesoTotal}</td>
                <td>{pontos}</td>
              </tr>
            </tbody>
          </table>
          <p className="font-semibold text-gray-900 num">
            {pontos} ÷ {pesoTotal} = {(pontos / pesoTotal).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
            {pontos % pesoTotal !== 0 && <> ≈ {nota}</>}
          </p>
          <p className="text-gray-400">
            Indicadores sem dado no app ficam de fora (por exemplo, reserva e investimento só contam para quem registra
            investimentos).
          </p>
        </ComoCalculei>
      )}
    </section>
  )
}

// ─── Números do período: médias com a tabela mês a mês ───────────────────────

function NumerosPeriodo({ m }: { m: MetricasComportamento }) {
  const s = m.resumo
  const meses = m.mensal.filter(x => !x.parcial)
  const temReceita = meses.some(x => x.receita > 0)
  const receitaTotal = meses.reduce((t, x) => t + x.receita, 0)
  const gastoTotal = meses.reduce((t, x) => t + x.gastoTotal, 0)
  const media = (f: (x: typeof meses[number]) => number) => (meses.length ? meses.reduce((t, x) => t + f(x), 0) / meses.length : 0)
  const n = meses.length
  const intervalo = n > 0 ? `${mesCurto(meses[0].mes)} a ${mesCurto(meses[n - 1].mes)}` : ''

  const kpis: Array<{ rotulo: string; valor: string; detalhe?: string; cor?: string }> = [
    { rotulo: 'Receita por mês', valor: formatBRL(s.receitaMedia) },
    { rotulo: 'Gasto por mês', valor: formatBRL(s.gastoMedio), detalhe: 'cartão + contas' },
    ...(temReceita
      ? [
          {
            rotulo: s.saldoMedio >= 0 ? 'Sobra por mês' : 'Falta por mês',
            valor: formatBRL(Math.abs(s.saldoMedio)),
            detalhe: s.taxaPoupancaMedia === null ? undefined : `${formatarPercentual(s.taxaPoupancaMedia, 0)} da receita`,
            cor: s.saldoMedio < 0 ? 'text-red-500' : 'text-green-600',
          },
          {
            rotulo: 'Meses no vermelho',
            valor: `${s.mesesNoVermelho} de ${n}`,
            detalhe: 'gasto maior que a receita',
            cor: s.mesesNoVermelho > 0 ? 'text-red-500' : 'text-gray-900',
          },
        ]
      : []),
  ]
  const t = s.tendenciaGastoPct

  return (
    <Cartao
      titulo="Seus números"
      Icon={Activity}
      corIcone="text-sky-600"
      corFundo="bg-sky-50"
      subtitulo={`Média de ${n} ${n === 1 ? 'mês fechado' : 'meses fechados'}${intervalo ? ` (${intervalo})` : ''}`}
    >
      <div className="grid grid-cols-2 gap-2">
        {kpis.map(k => (
          <div key={k.rotulo} className="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-0.5">
            <p className="text-[11px] font-semibold text-gray-500 leading-tight">{k.rotulo}</p>
            <p className={`text-base font-bold num leading-tight ${k.cor ?? 'text-gray-900'}`}>{k.valor}</p>
            {k.detalhe && <p className="text-[10px] text-gray-400 leading-snug">{k.detalhe}</p>}
          </div>
        ))}
      </div>

      {t !== null && (
        <p className={`text-[11px] leading-snug flex items-center gap-1 ${Math.abs(t) < 5 ? 'text-gray-500' : t > 0 ? 'text-red-500' : 'text-green-600'}`}>
          {Math.abs(t) < 5 ? <Minus className="w-3 h-3" /> : t > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(t) < 5
            ? 'Gasto estável: os últimos 3 meses ficaram perto dos 3 anteriores.'
            : `Gasto dos últimos 3 meses ${t > 0 ? 'subiu' : 'caiu'} ${formatarPercentual(Math.abs(t), 0)} em relação aos 3 anteriores.`}
        </p>
      )}

      <ComoCalculei>
        <p>Mês a mês, em R$, com a mesma conta do Dashboard — dá para conferir cada linha no app:</p>
        <div className="overflow-x-auto">
          <table className="w-full num text-[10.5px]">
            <thead>
              <tr className="text-[10px] text-gray-400 text-right">
                <th className="text-left font-medium py-0.5">Mês</th>
                <th className="font-medium">Receita</th>
                <th className="font-medium">Cartão</th>
                <th className="font-medium">Contas</th>
                <th className="font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {meses.map(x => (
                <tr key={x.mes} className="text-right border-t border-gray-100">
                  <td className="text-left py-0.5">{mesCurto(x.mes)}</td>
                  <td>{numInteiro(x.receita)}</td>
                  <td>{numInteiro(x.gastoCartao)}</td>
                  <td>{numInteiro(x.contas)}</td>
                  <td className={x.saldo < 0 ? 'text-red-500 font-semibold' : 'text-gray-900'}>{numInteiro(x.saldo)}</td>
                </tr>
              ))}
              <tr className="text-right border-t border-gray-200 font-semibold text-gray-900">
                <td className="text-left py-0.5">Média</td>
                <td>{numInteiro(media(x => x.receita))}</td>
                <td>{numInteiro(media(x => x.gastoCartao))}</td>
                <td>{numInteiro(media(x => x.contas))}</td>
                <td className={s.saldoMedio < 0 ? 'text-red-500' : ''}>{numInteiro(media(x => x.saldo))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="list-disc pl-4 space-y-1">
          <li><b>Cartão</b> = valor pago da fatura do mês; sem pagamento marcado, a soma das compras dela.</li>
          <li><b>Contas</b> = despesas do planejamento (sem a linha da fatura, que já está em Cartão).</li>
          <li><b>Receita</b> = a recebida; num mês sem a marcação de recebido, a prevista.</li>
          <li><b>Saldo</b> = receita − cartão − contas. Gasto por mês = cartão + contas.</li>
          {temReceita && s.taxaPoupancaMedia !== null && (
            <li>
              <b>% da receita</b> = saldo somado ÷ receita somada = {brlInteiro(receitaTotal - gastoTotal)} ÷ {brlInteiro(receitaTotal)} = {formatarPercentual(s.taxaPoupancaMedia, 1)}.
            </li>
          )}
          <li>O mês atual ainda está em andamento e fica fora das médias.</li>
        </ul>
      </ComoCalculei>
    </Cartao>
  )
}

// ─── Mês em foco (modo "último mês") ─────────────────────────────────────────

function Variacao({ c, subirEhBom = false }: { c: Comparativo; subirEhBom?: boolean }) {
  const v = c.variacaoPct
  if (v === null) return <span className="text-[11px] text-gray-400">novo</span>
  const neutro = Math.abs(v) < 5
  const bom = subirEhBom ? v > 0 : v < 0
  const cor = neutro ? 'text-gray-400' : bom ? 'text-green-600' : 'text-red-500'
  const Icone = neutro ? Minus : v > 0 ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold num ${cor}`}>
      <Icone className="w-3 h-3" strokeWidth={2.4} />
      {v > 0 ? '+' : ''}{formatarPercentual(v, 0)}
    </span>
  )
}

/** Uma métrica do mês contra o normal: duas barras finas (mês × média). */
function BarraComparativo({ rotulo, c, maximo, subirEhBom }: {
  rotulo: string
  c: Comparativo
  maximo: number
  subirEhBom?: boolean
}) {
  const escala = (v: number) => `${Math.max(1.5, (Math.abs(v) / Math.max(maximo, 1)) * 100)}%`
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-gray-700 truncate">{rotulo}</span>
        <span className="flex items-baseline gap-2 shrink-0">
          <span className="text-xs font-bold text-gray-900 num">{formatBRL(c.atual)}</span>
          <Variacao c={c} subirEhBom={subirEhBom} />
        </span>
      </div>
      <div className="space-y-0.5">
        <div className="h-1.5 rounded-full bg-primary-500" style={{ width: escala(c.atual) }} />
        <div className="h-1.5 rounded-full bg-gray-200" style={{ width: escala(c.base) }} />
      </div>
      <p className="text-[10px] text-gray-400 num">normal: {formatBRL(c.base)}</p>
    </li>
  )
}

function ListaLancamentos({ lancamentos }: { lancamentos: LancamentoFatura[] }) {
  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | LancamentoFatura['tipo']>('todos')
  const visiveis = useMemo(
    () => lancamentos.filter(l => filtro === 'todos' || l.tipo === filtro),
    [lancamentos, filtro],
  )
  const qtdNovas = lancamentos.filter(l => l.tipo === 'compra_nova').length
  const totalVisivel = visiveis.reduce((s, l) => s + l.valor, 0)

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-2 text-xs font-semibold text-gray-600 py-1"
      >
        <Receipt className="w-3.5 h-3.5 text-gray-400" />
        <span className="flex-1 text-left">
          Ver os {lancamentos.length} lançamentos ({qtdNovas} compras novas, {lancamentos.length - qtdNovas} {lancamentos.length - qtdNovas === 1 ? 'parcela' : 'parcelas'})
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <>
          <div className="flex gap-1">
            {([['todos', 'Todos'], ['compra_nova', 'Compras novas'], ['parcela_em_andamento', 'Parcelas']] as const).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFiltro(v)}
                aria-pressed={filtro === v}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border
                            ${filtro === v ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-500 border-gray-200'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {visiveis.map((l, i) => (
              <li key={`${l.data}-${l.descricao}-${i}`} className="py-1.5 flex items-center gap-2">
                <span className="text-[10px] text-gray-400 num w-10 shrink-0">{l.data.slice(8, 10)}/{l.data.slice(5, 7)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-800 truncate">{l.descricao}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {l.categoria} · {l.responsavel}
                    {l.parcela ? ` · ${l.parcela}` : ''}
                  </p>
                </div>
                <span className="text-xs font-semibold text-gray-900 num shrink-0">{formatBRL(l.valor)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-500 flex justify-between num">
            <span>Soma das linhas acima</span>
            <span className="font-semibold text-gray-900">{formatBRL(totalVisivel)}</span>
          </p>
        </>
      )}
    </div>
  )
}

export function BlocoMesFoco({ mesFoco: f }: { mesFoco: MesFoco }) {
  const linhas: Array<{ rotulo: string; c: Comparativo; subirEhBom?: boolean }> = [
    ...(f.receita ? [{ rotulo: 'Receita', c: f.receita, subirEhBom: true }] : []),
    { rotulo: 'Faturas do cartão', c: f.faturas },
    { rotulo: 'Contas do planejamento', c: f.contas },
    { rotulo: 'Compras novas no mês', c: f.compras.valor },
    { rotulo: 'Microgastos (até R$ 50)', c: f.microgastos.valor },
  ]
  const maximo = Math.max(...linhas.flatMap(l => [Math.abs(l.c.atual), Math.abs(l.c.base)]))
  const qtdBase = f.compras.quantidade.base.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

  return (
    <Cartao
      titulo={`${rotuloMesIso(f.mes)} vs. seu normal`}
      Icon={CalendarCheck}
      corIcone="text-primary-600"
      corFundo="bg-primary-50"
      subtitulo={`Barra azul: o mês · cinza: média de ${f.mesesBase} ${f.mesesBase === 1 ? 'mês anterior' : 'meses anteriores'}`}
    >
      {f.saldo && f.receita && (
        <div className={`rounded-2xl border p-3 ${f.saldo.atual < 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
          <Conta linhas={[
            { rotulo: 'Receita', valor: f.receita.atual, sinal: '+' },
            { rotulo: 'Faturas do cartão', valor: f.faturas.atual, sinal: '−' },
            { rotulo: 'Contas', valor: f.contas.atual, sinal: '−' },
            {
              rotulo: f.saldo.atual < 0 ? 'Faltou no mês' : 'Sobrou no mês',
              valor: Math.abs(f.saldo.atual),
              sinal: '=',
              cor: f.saldo.atual < 0 ? 'text-red-600' : 'text-green-700',
            },
          ]} />
        </div>
      )}

      <ul className="space-y-3">
        {linhas.map(l => <BarraComparativo key={l.rotulo} maximo={maximo} {...l} />)}
      </ul>

      <div className="flex flex-wrap gap-1.5">
        <Chip classe="bg-gray-50 text-gray-600 border-gray-100">
          {f.compras.quantidade.atual} compras novas (normal {qtdBase})
        </Chip>
        <Chip classe="bg-gray-50 text-gray-600 border-gray-100">
          {f.novosParcelamentos.quantidade.atual} novos parcelamentos
        </Chip>
      </div>

      {f.novidades.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-1.5 leading-snug">
          <Sparkle className="w-3 h-3 inline -mt-0.5 mr-1" />
          Novo neste mês: {f.novidades.join(' · ')}
        </p>
      )}

      <ComoCalculei>
        <ul className="list-disc pl-4 space-y-1">
          <li><b>Faturas do cartão</b>: as faturas pagas em {rotuloMesIso(f.mes)}, pelo valor pago — é o que sai do saldo.</li>
          <li>
            Dessas faturas, {formatBRL(f.parcelasEmAndamento.valor.atual)} são <b>parcelas de compras antigas</b>{' '}
            ({f.parcelasEmAndamento.quantidade} {f.parcelasEmAndamento.quantidade === 1 ? 'parcela' : 'parcelas'} 2/N em diante).
          </li>
          <li>
            <b>Compras novas</b> usam o valor cheio da compra: uma compra de 10× R$ 100 conta R$ 1.000 no mês em que foi feita.
            Por isso esse número não soma com o das faturas — ele mostra quanto você decidiu gastar no mês.
          </li>
          <li><b>Normal</b> = média dos {f.mesesBase} meses anteriores com movimento no app.</li>
        </ul>
      </ComoCalculei>

      <ListaLancamentos lancamentos={f.lancamentos} />
    </Cartao>
  )
}

// ─── Próximo mês: quanto sobra ───────────────────────────────────────────────

const ROTULO_CONTAS_PROXIMO_MES: Record<ProximoMes['contasFonte'], string> = {
  planejadas: 'lançadas no planejamento',
  media: 'média das recorrentes',
  planejadas_e_media: 'lançadas + recorrentes ainda não lançadas',
}

export function BlocoProximoMes({ p }: { p: ProximoMes }) {
  const sobra = p.folga >= 0
  const [ano, mes] = p.mes.split('-').map(Number)
  const diasMes = new Date(ano, mes, 0).getDate()
  return (
    <Cartao
      titulo={`${rotuloMesIso(p.mes)}: quanto vai sobrar`}
      Icon={Wallet}
      corIcone="text-primary-600"
      corFundo="bg-primary-50"
      subtitulo="Previsão se vocês gastarem como num mês típico"
    >
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold num ${sobra ? 'text-green-600' : 'text-red-500'}`}>
          {formatBRL(Math.abs(p.folga))}
        </span>
        <span className="text-xs text-gray-500">{sobra ? 'devem sobrar' : 'devem faltar'}</span>
      </div>

      <Conta linhas={[
        { rotulo: 'Receita', detalhe: p.receitaFonte === 'planejada' ? 'planejada' : 'média', valor: p.receita, sinal: '+' },
        { rotulo: 'Contas', valor: p.contas, sinal: '−' },
        { rotulo: 'Parcelas já contratadas', valor: p.parcelas, sinal: '−' },
        ...(p.assinaturas > 0 ? [{ rotulo: 'Assinaturas', valor: p.assinaturas, sinal: '−' as const }] : []),
        { rotulo: 'Livre para o mês', valor: p.margemLivre, sinal: '=', cor: p.margemLivre < 0 ? 'text-red-500' : undefined },
        { rotulo: 'Gasto típico em compras novas e extras', valor: p.variavelHabitual, sinal: '−' },
        { rotulo: sobra ? 'Sobra prevista' : 'Falta prevista', valor: Math.abs(p.folga), sinal: '=', cor: sobra ? 'text-green-700' : 'text-red-600' },
      ]} />

      <p className="text-[11px] text-gray-600 leading-snug rounded-2xl bg-gray-50 border border-gray-100 px-3 py-2">
        {p.margemLivre > 0
          ? <>Para não fechar no vermelho: até <b className="num">{formatBRL(p.tetoSemanal)}</b> por semana em compras novas e extras.</>
          : 'As contas e parcelas já passam da receita: qualquer compra nova aumenta o saldo negativo.'}
      </p>

      <ComoCalculei>
        <ul className="list-disc pl-4 space-y-1">
          <li><b>Receita</b>: {p.receitaFonte === 'planejada' ? 'as receitas já lançadas no planejamento do mês' : 'a média dos meses fechados (o mês ainda não tem receita planejada)'}.</li>
          <li><b>Contas</b>: {ROTULO_CONTAS_PROXIMO_MES[p.contasFonte]}.</li>
          <li>
            <b>Parcelas já contratadas</b>: parcelas 2/N em diante de compras já feitas que caem na fatura do mês,
            incluindo as já lançadas na fatura aberta. A 1ª parcela de uma compra nova entra no gasto típico.
          </li>
          {p.assinaturas > 0 && <li><b>Assinaturas</b>: as ativas no app.</li>}
          <li>
            <b>Gasto típico</b>: média mensal das compras novas no cartão (sem as assinaturas, já descontadas acima),
            da diferença entre fatura paga e compras (estornos, juros){p.contasFonte === 'media' ? ' e das contas fora da rotina' : ''} —
            o que costuma se decidir no dia a dia.
          </li>
          {p.margemLivre > 0 && (
            <li className="num">
              <b>Limite por semana</b> = livre para o mês ÷ semanas do mês = {formatBRL(p.margemLivre)} ÷ {(diasMes / 7).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.
            </li>
          )}
        </ul>
      </ComoCalculei>
    </Cartao>
  )
}

// ─── Leitura da IA ───────────────────────────────────────────────────────────

export function Padroes({ analise: a }: { analise: AnaliseIA }) {
  if (a.padroes.length === 0) return null
  return (
    <Cartao titulo="O que os dados mostram" Icon={Brain} corIcone="text-violet-600" corFundo="bg-violet-50"
      subtitulo="Leitura da IA a partir dos números calculados pelo app">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {a.padroes.map(p => {
          const cor = p.impacto === 'negativo' ? 'text-red-500' : p.impacto === 'positivo' ? 'text-green-600' : 'text-gray-700'
          return (
            <li key={p.titulo} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-1">
              <div className="flex items-start gap-2">
                {/* Análises salvas antes do campo "destaque" não o têm. */}
                <p className={`flex-1 text-xl font-bold num leading-none ${cor}`}>{destaqueCurto(p.destaque) || '•'}</p>
                {p.relevancia === 'alta' && <Chip classe={ESTILO_NIVEL.alta}>Prioridade</Chip>}
              </div>
              <p className="text-xs font-semibold text-gray-900 leading-snug">{p.titulo}</p>
              <p className="text-[11px] text-gray-500 leading-snug">{p.descricao}</p>
            </li>
          )
        })}
      </ul>
    </Cartao>
  )
}

export function PlanoDeAcao({ analise: a }: { analise: AnaliseIA }) {
  const economiaTotal = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)
  if (a.planoDeAcao.length === 0) return null
  return (
    <Cartao titulo="Plano de ação" Icon={ListChecks} corIcone="text-primary-600" corFundo="bg-primary-50"
      subtitulo={economiaTotal > 0 ? undefined : 'Sugestões da IA a partir dos seus números'}>
      {economiaTotal > 0 && (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold text-green-600 num">{formatBRL(economiaTotal)}</span>
          <span className="text-xs text-gray-500">por mês, se seguir o plano · {formatBRL(economiaTotal * 12)} por ano</span>
        </div>
      )}
      <ol className="space-y-2.5">
        {a.planoDeAcao.map((p, i) => (
          <li key={p.acao} className="flex gap-2.5">
            <span className="w-5 h-5 rounded-md bg-primary-50 text-primary-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 leading-snug">{p.acao}</p>
              <p className="text-[11px] text-gray-500 leading-snug">{p.porque}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{p.prazo}</p>
            </div>
            {p.economiaMensal > 0 && (
              <span className="text-xs font-semibold text-green-600 num shrink-0 mt-0.5">−{formatBRL(p.economiaMensal)}/mês</span>
            )}
          </li>
        ))}
      </ol>

      {a.metas.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-semibold text-gray-700">Metas para acompanhar</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {a.metas.map(meta => (
              <div key={meta.meta} className="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-0.5">
                <p className="text-base font-bold text-sky-600 leading-tight">{meta.alvo}</p>
                <p className="text-xs font-semibold text-gray-800 leading-snug">{meta.meta}</p>
                <p className="text-[10px] text-gray-400">{meta.indicador} · {meta.prazo}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {economiaTotal > 0 && (
        <ComoCalculei>
          <p>
            A economia de cada ação é uma estimativa da IA a partir da média mensal do gasto que ela ataca. O app
            confere: ações sobre a mesma categoria não passam do que ela gasta por mês, e o total não passa de metade
            do gasto que se decide no dia a dia.
            {a.economiaAjustada && ' Nesta análise as estimativas da IA passavam desses limites e foram reduzidas.'}
          </p>
        </ComoCalculei>
      )}
    </Cartao>
  )
}

// ─── Mapa de calor: dia da semana × fase do mês ──────────────────────────────

function MapaCalor({ m }: { m: MetricasComportamento }) {
  const mapa = m.quando.mapaCalor
  if (!mapa) return <p className="text-xs text-gray-400">Gere uma nova análise para ver o mapa de calor.</p>
  const maximo = Math.max(...mapa.quantidade.flat(), 1)
  const totalDia = mapa.quantidade.map(l => l.reduce((a, b) => a + b, 0))
  const totalFase = mapa.fases.map((_, j) => mapa.quantidade.reduce((a, l) => a + l[j], 0))
  const maxDia = Math.max(...totalDia, 1)

  return (
    <div className="space-y-2">
      <div className="grid gap-1" style={{ gridTemplateColumns: `2.25rem repeat(${mapa.fases.length}, minmax(0, 1fr)) 3rem` }}>
        <span />
        {mapa.fases.map(f => (
          <span key={f} className="text-[9px] text-gray-400 text-center leading-tight">{f}</span>
        ))}
        <span />
        {mapa.dias.map((dia, i) => (
          <div key={dia} className="contents">
            <span className="text-[10px] font-medium text-gray-500 self-center">{dia}</span>
            {mapa.quantidade[i].map((q, j) => {
              const cor = corDaRampa(q, maximo)
              const escuro = q / maximo > 0.5
              return (
                <span
                  key={j}
                  title={`${dia}, dias ${mapa.fases[j]}: ${q} compras · ${formatBRL(mapa.valor[i][j])}`}
                  className={`h-7 rounded-md flex items-center justify-center text-[10px] font-semibold num
                              ${cor ? '' : 'bg-gray-50'} ${escuro ? 'text-white' : 'text-gray-600'}`}
                  style={cor ? { backgroundColor: cor } : undefined}
                >
                  {q > 0 ? q : ''}
                </span>
              )
            })}
            <span className="self-center flex items-center gap-1">
              <span className="h-1.5 rounded-full bg-primary-300" style={{ width: `${(totalDia[i] / maxDia) * 100}%` }} />
              <span className="text-[9px] text-gray-400 num">{totalDia[i]}</span>
            </span>
          </div>
        ))}
        <span />
        {totalFase.map((t, j) => (
          <span key={j} className="text-[9px] text-gray-400 text-center num">{t}</span>
        ))}
        <span />
      </div>
      <p className="text-[11px] text-gray-400 leading-snug">
        Quantidade de compras novas por dia da semana (linhas) e dias do mês (colunas). Parcelas de compras antigas
        ficam de fora. Mais escuro = mais compras.
      </p>
    </div>
  )
}

// ─── Detalhes (recolhidos) ───────────────────────────────────────────────────

function BlocoFixoVariavel({ fv, gastoMedio }: { fv: FixoVariavel; gastoMedio: number }) {
  const total = fv.fixo.total + fv.variavel.total
  if (total <= 0) return null
  const partes = [
    { rotulo: 'Contas recorrentes', valor: fv.fixo.contas, fixo: true },
    { rotulo: 'Parcelas de compras antigas', valor: fv.fixo.parcelas, fixo: true },
    { rotulo: 'Assinaturas', valor: fv.fixo.assinaturas, fixo: true },
    { rotulo: 'Compras novas no cartão', valor: fv.variavel.cartao, fixo: false },
    { rotulo: 'Diferença fatura paga × compras', valor: fv.variavel.ajusteFatura ?? 0, fixo: false },
    { rotulo: 'Contas fora da rotina', valor: fv.variavel.contas, fixo: false },
  ].filter(x => Math.abs(x.valor) >= 1)
  return (
    <Cartao
      titulo="Fixo × variável"
      Icon={Repeat}
      corIcone="text-violet-600"
      corFundo="bg-violet-50"
      subtitulo={`Por mês: ${formatarPercentual(fv.pctFixo, 0)} do gasto já vem comprometido`}
    >
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100" aria-hidden="true">
        <div className="bg-violet-500" style={{ width: `${(fv.fixo.total / total) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(fv.variavel.total / total) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[11px] font-semibold">
        <span className="text-violet-700">Fixo {formatBRL(fv.fixo.total)}</span>
        <span className="text-amber-700">Variável {formatBRL(fv.variavel.total)}</span>
      </div>
      <ul className="space-y-1">
        {partes.map(x => (
          <li key={x.rotulo} className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${x.fixo ? 'bg-violet-500' : 'bg-amber-400'}`} />
            <span className="flex-1 min-w-0 text-xs text-gray-600 truncate">{x.rotulo}</span>
            <span className="text-xs font-semibold text-gray-900 num shrink-0">{formatBRL(x.valor)}</span>
          </li>
        ))}
      </ul>
      <ComoCalculei>
        <p className="num">
          Fixo {formatBRL(fv.fixo.total)} + variável {formatBRL(fv.variavel.total)} = <b>{formatBRL(total)}</b>, o mesmo
          gasto por mês de &ldquo;Seus números&rdquo; ({formatBRL(gastoMedio)}).
        </p>
        <ul className="list-disc pl-4 space-y-1">
          <li><b>Fixo</b> não se decide no mês: contas que aparecem em pelo menos 60% dos meses, parcelas 2/N em diante e assinaturas.</li>
          <li><b>Variável</b> se decide no dia a dia: compras novas (à vista ou 1ª parcela, pelo valor da parcela) e contas avulsas.</li>
          <li>
            <b>Diferença fatura paga × compras</b>: a fatura paga raramente é igual à soma das compras lançadas (estornos,
            juros, IOF, pagamento a mais ou a menos). Negativa = pagou menos do que as compras somavam.
          </li>
        </ul>
      </ComoCalculei>
    </Cartao>
  )
}

function BlocoReserva({ m }: { m: MetricasComportamento }) {
  const inv = m.investimentos
  const meses = inv.mesesDeReserva ?? null
  const temAportes = inv.pctDaReceita !== null && (inv.saldoInformado !== null || inv.totalAportado > 0)
  if (meses === null && !temAportes) return null
  return (
    <Cartao titulo="Reserva e investimento" Icon={PiggyBank} corIcone="text-emerald-600" corFundo="bg-emerald-50"
      subtitulo="Pelos investimentos registrados no app">
      {meses !== null && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-gray-600">Reserva cobre</span>
            <span className={`text-lg font-bold num ${meses >= 6 ? 'text-green-600' : meses >= 3 ? 'text-amber-600' : 'text-red-500'}`}>
              {meses.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} {meses === 1 ? 'mês' : 'meses'}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(2, (meses / 6) * 100))}%` }} />
          </div>
          <p className="text-[11px] text-gray-400 num">
            {formatBRL(inv.saldoInformado ?? 0)} investidos ÷ gasto de {formatBRL(m.resumo.gastoMedio)} por mês · ideal: 6 meses
          </p>
        </div>
      )}
      {temAportes && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-gray-600">Investe por mês</span>
          <span className="text-right">
            <span className={`text-lg font-bold num ${inv.pctDaReceita! >= 10 ? 'text-green-600' : 'text-amber-600'}`}>
              {formatarPercentual(inv.pctDaReceita!, 0)}
            </span>
            <span className="block text-[11px] text-gray-400 num">
              {formatBRL(inv.mediaMensal)} ÷ receita de {formatBRL(m.resumo.receitaMedia)} · ideal: 10%
            </span>
          </span>
        </div>
      )}
    </Cartao>
  )
}

function Detalhes({ m }: { m: MetricasComportamento }) {
  const montarReceita = useMemo(() => (t: TemaGrafico) => graficoReceitaGasto(m, t), [m])
  const montarSaldo = useMemo(() => (t: TemaGrafico) => graficoSaldo(m, t), [m])
  const montarCategorias = useMemo(() => (t: TemaGrafico) => graficoCategorias(m, t), [m])
  const temReceita = m.mensal.some(x => !x.parcial && x.receita > 0)
  const estouram = m.planejamento.itensQueEstouram
  const assin = m.assinaturas
  const atipicas = m.comprasAtipicas

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Receita × gasto" Icon={Activity} corIcone="text-sky-600" corFundo="bg-sky-50"
          subtitulo="Mês a mês, os mesmos valores da tabela de “Seus números”">
          <GraficoComportamento montar={montarReceita} descricao="Receita e gasto total de cada mês fechado" />
        </Cartao>
        {temReceita && (
          <Cartao titulo="Quanto sobrou" Icon={Scale} corIcone="text-sky-600" corFundo="bg-sky-50"
            subtitulo="Receita − gasto: azul sobrou, vermelho faltou">
            <GraficoComportamento montar={montarSaldo} descricao="Saldo de cada mês, receita menos gasto" />
          </Cartao>
        )}
      </div>

      {(m.fixoVariavel || m.investimentos.mesesDeReserva != null || m.investimentos.pctDaReceita !== null) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {m.fixoVariavel && <BlocoFixoVariavel fv={m.fixoVariavel} gastoMedio={m.resumo.gastoMedio} />}
          <BlocoReserva m={m} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Categorias: agora × normal" Icon={PieChart} corIcone="text-rose-600" corFundo="bg-red-50"
          subtitulo={m.mesFoco
            ? 'Compras novas do mês (valor cheio) × média dos meses anteriores'
            : 'Cartão + contas por mês: últimos 3 meses × meses anteriores'}>
          <GraficoComportamento montar={montarCategorias} altura={260} descricao="Gasto por categoria agora comparado com o normal" />
        </Cartao>
        <Cartao titulo="Quando você compra" Icon={CalendarDays} corIcone="text-violet-600" corFundo="bg-violet-50">
          <MapaCalor m={m} />
        </Cartao>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Cartao titulo="Onde você mais volta" Icon={Store} corIcone="text-orange-600" corFundo="bg-orange-50"
          subtitulo="Nº de compras novas e valor cheio no período">
          {m.estabelecimentos.length === 0 ? (
            <p className="text-xs text-gray-400">Sem lugares recorrentes.</p>
          ) : (
            <ul className="space-y-1.5">
              {m.estabelecimentos.slice(0, 6).map(e => (
                <li key={e.nome} className="flex items-center gap-2">
                  <span className="w-8 text-xs font-bold text-orange-600 num shrink-0">{e.quantidade}×</span>
                  <span className="flex-1 min-w-0 text-xs text-gray-800 truncate">{e.nome}</span>
                  <span className="text-xs font-semibold text-gray-900 num shrink-0">{formatBRL(e.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Tamanho das compras" Icon={Coins} corIcone="text-emerald-600" corFundo="bg-emerald-50"
          subtitulo={`Compras novas pelo valor cheio · metade custa até ${formatBRL(m.ticket.ticketMediano)}`}>
          <ul className="space-y-2">
            {m.ticket.faixas.map(f => (
              <li key={f.faixa} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-gray-600">{f.faixa}</span>
                  <span className="text-[11px] text-gray-400 num">{f.quantidade} compras · {formatarPercentual(f.pctValor, 0)} do valor</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(1, f.pctQuantidade)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Cartao>

        <Cartao titulo="Parcelas já contratadas" Icon={Layers} corIcone="text-teal-600" corFundo="bg-teal-50"
          subtitulo={m.parcelamentos.pctReceitaProximoMes !== null
            ? `Próximo mês: ${formatarPercentual(m.parcelamentos.pctReceitaProximoMes, 0)} da receita média`
            : undefined}>
          {m.parcelamentos.compromissoFuturo.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhuma parcela para os próximos meses.</p>
          ) : (
            <GraficoBarrasMeses
              altura={84}
              pontos={m.parcelamentos.compromissoFuturo.map((c, i) => ({ label: rotuloMesIso(c.mes), valor: c.valor, destaque: i === 0 }))}
            />
          )}
        </Cartao>
      </div>

      {(estouram.length > 0 || assin.ativas > 0 || atipicas.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {estouram.length > 0 && (
            <Cartao titulo="Contas que estouram o previsto" Icon={Gauge} corIcone="text-red-500" corFundo="bg-red-50"
              subtitulo="Passam do previsto na maioria dos meses: ajuste o valor ou o hábito">
              <ul className="space-y-1.5">
                {estouram.map(i => (
                  <li key={i.item} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800 truncate">{i.item}</p>
                      <p className="text-[10px] text-gray-400">{i.mesesEstourados} de {i.mesesAvaliados} meses acima</p>
                    </div>
                    <span className="text-xs font-semibold text-red-500 num shrink-0">+{formatBRL(i.excessoMedio)}</span>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
          {assin.ativas > 0 && (
            <Cartao titulo="Assinaturas" Icon={Repeat} corIcone="text-sky-600" corFundo="bg-sky-50"
              subtitulo={`${assin.ativas} ativas · ${formatBRL(assin.custoMensal)}/mês${assin.pctDaReceita !== null ? ` · ${formatarPercentual(assin.pctDaReceita, 1)} da receita` : ''}`}>
              <ul className="space-y-1.5">
                {assin.maiores.map(a => (
                  <li key={a.nome} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 text-xs text-gray-800 truncate">{a.nome}</span>
                    <span className="text-xs font-semibold text-gray-900 num shrink-0">{formatBRL(a.valor)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-400">{formatBRL(assin.custoMensal * 12)} por ano</p>
            </Cartao>
          )}
          {atipicas.length > 0 && (
            <Cartao titulo="Compras fora do padrão" Icon={ShoppingBag} corIcone="text-orange-600" corFundo="bg-orange-50"
              subtitulo="4× ou mais o valor típico da categoria">
              <ul className="space-y-1.5">
                {atipicas.map((c, i) => (
                  <li key={`${c.data}-${c.descricao}-${i}`} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800 truncate">{c.descricao}</p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {(c.data ?? '').slice(8, 10)}/{(c.data ?? '').slice(5, 7)} · {c.categoria} · {c.vezesMediana.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× o típico
                        {c.parcelada ? ' · parcelada, valor cheio' : ''}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-gray-900 num shrink-0">{formatBRL(c.valor)}</span>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </div>
      )}
    </>
  )
}

function LeituraCompleta({ analise: a }: { analise: AnaliseIA }) {
  const blocos = ([
    { titulo: 'Gatilhos', Icon: Zap, cor: 'text-amber-600', fundo: 'bg-amber-50', itens: a.gatilhos },
    { titulo: 'Riscos', Icon: AlertTriangle, cor: 'text-red-500', fundo: 'bg-red-50', itens: a.riscos },
    { titulo: 'Pontos fortes', Icon: ShieldCheck, cor: 'text-green-600', fundo: 'bg-green-50', itens: a.pontosFortes },
  ] as const).filter(b => b.itens.length > 0)
  return (
    <>
      <p className="text-xs text-gray-600 leading-snug rounded-2xl bg-violet-50 border border-violet-100 px-3 py-2">
        <b className="text-violet-700">{a.perfil.nome}:</b> {a.perfil.descricao}
      </p>
      {blocos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {blocos.map(b => (
            <Cartao key={b.titulo} titulo={b.titulo} Icon={b.Icon} corIcone={b.cor} corFundo={b.fundo}>
              <ul className="space-y-2">
                {b.itens.map(item => (
                  <li key={item.titulo}>
                    <p className="text-xs font-semibold text-gray-800 leading-snug">{item.titulo}</p>
                    <p className="text-[11px] text-gray-500 leading-snug">{item.descricao}</p>
                  </li>
                ))}
              </ul>
            </Cartao>
          ))}
        </div>
      )}
      {a.perguntas.length > 0 && (
        <Cartao titulo="Para refletir" Icon={HelpCircle} corIcone="text-indigo-600" corFundo="bg-indigo-50">
          <ul className="space-y-1.5">
            {a.perguntas.map(q => (
              <li key={q} className="text-xs text-gray-600 leading-snug pl-3 border-l-2 border-indigo-200">{q}</li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  )
}

// ─── Composição ──────────────────────────────────────────────────────────────

/** Os números calculados pelo app (o que aparece já durante a análise). */
export function BlocosNumeros({ metricas: m }: { metricas: MetricasComportamento }) {
  return (
    <>
      {m.escopo !== 'casal' && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-3 py-2 leading-snug">
          <Info className="w-3 h-3 inline -mt-0.5 mr-1" />
          Visão de {m.escopo}: só os lançamentos com responsável {m.escopo} (o Conjunto fica de fora).
          O saldo do Dashboard e de Finanças é sempre do casal, por isso os números não batem com ele.
        </p>
      )}
      {m.mesFoco && <BlocoMesFoco mesFoco={m.mesFoco} />}
      <NumerosPeriodo m={m} />
      {/* Análises salvas antes deste bloco não têm o campo. */}
      {m.proximoMes && <BlocoProximoMes p={m.proximoMes} />}
    </>
  )
}

export function DetalhesRecolhidos({ metricas: m, analise: a }: { metricas: MetricasComportamento; analise?: AnaliseIA }) {
  return (
    <>
      <Recolhivel
        titulo="Seus gastos em detalhe"
        subtitulo="Gráficos, categorias, lugares, parcelas, assinaturas e compras fora do padrão"
        Icon={BarChart3}
      >
        <Detalhes m={m} />
      </Recolhivel>
      {a && (
        <Recolhivel
          titulo="Leitura completa da IA"
          subtitulo="Perfil, gatilhos, riscos, pontos fortes e perguntas"
          Icon={MessageSquareText}
        >
          <LeituraCompleta analise={a} />
        </Recolhivel>
      )}
    </>
  )
}

export function LimitesAnalise({ analise: a, metricas: m }: { analise: AnaliseIA; metricas: MetricasComportamento }) {
  const avisos = [...m.qualidade.avisos, ...a.limitacoes]
  if (avisos.length === 0) return null
  return (
    <details className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 group">
      <summary className="flex items-center gap-2 text-xs font-semibold text-gray-500 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <Info className="w-3.5 h-3.5" /> Limites desta análise ({avisos.length})
        <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-1 list-disc pl-4">
        {avisos.map(l => <li key={l} className="text-[11px] text-gray-500 leading-snug">{l}</li>)}
      </ul>
    </details>
  )
}
