'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { LucideIcon } from 'lucide-react'
import {
  Brain, Activity, CalendarDays, Store, TrendingUp, TrendingDown, Zap, ShieldCheck,
  AlertTriangle, ListChecks, Target, HelpCircle, Info, Layers, Coins, Minus,
  CalendarCheck, Receipt, ChevronDown, Sparkle, Scale, PieChart,
} from 'lucide-react'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import KpisRelatorio from '@/components/relatorios/KpisRelatorio'
import { formatBRL } from '@/lib/format'
import { formatarPercentual } from '@/lib/relatoriosFormat'
import { rotuloMesIso } from '@/lib/comportamento/documento'
import {
  corDaRampa,
  graficoCategorias,
  graficoPlano,
  graficoReceitaGasto,
  graficoSaldo,
  type TemaGrafico,
} from '@/lib/comportamento/graficos'
import type {
  AnaliseIA, Comparativo, LancamentoFatura, MesFoco, MetricasComportamento, Nivel,
} from '@/lib/comportamento/tipos'

// Chart.js só é baixado quando há um resultado para desenhar.
const GraficoComportamento = dynamic(() => import('./GraficoComportamento'), {
  ssr: false,
  loading: () => <div className="h-[200px] rounded-2xl skeleton" />,
})

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

// ─── Diagnóstico (topo) ──────────────────────────────────────────────────────

export function Diagnostico({
  analise: a, metricas: m, notaAnterior,
}: {
  analise: AnaliseIA
  metricas: MetricasComportamento
  notaAnterior: number | null
}) {
  const nota = m.saude.nota
  const delta = notaAnterior === null ? null : nota - notaAnterior

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

      <div className="rounded-2xl bg-violet-50 border border-violet-100 p-3 space-y-1.5">
        <p className="text-sm font-bold text-gray-900">{a.perfil.nome}</p>
        <p className="text-xs text-gray-600 leading-snug">{a.perfil.descricao}</p>
        {a.perfil.tracos.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {a.perfil.tracos.map(t => (
              <span key={t} className="text-[10px] font-semibold text-violet-700 bg-white border border-violet-100 rounded-lg px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {a.resumo && <p className="text-xs text-gray-600 leading-relaxed">{a.resumo.replace(/\n+/g, ' ')}</p>}

      {m.saude.indicadores.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {m.saude.indicadores.map(i => (
            <li key={i.chave} className="space-y-1" title={`${i.medida} · referência: ${i.referencia}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium text-gray-600 truncate">{i.nome}</span>
                <span className={`text-[11px] font-bold num shrink-0 ${corNota(i.nota).texto}`}>{i.nota}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${corNota(i.nota).barra}`} style={{ width: `${Math.max(2, i.nota)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Padrões: um número grande por cartão ────────────────────────────────────

export function Padroes({ analise: a }: { analise: AnaliseIA }) {
  return (
    <Cartao titulo="O que os dados mostram" Icon={Brain} corIcone="text-violet-600" corFundo="bg-violet-50">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {a.padroes.map(p => {
          const cor = p.impacto === 'negativo' ? 'text-red-500' : p.impacto === 'positivo' ? 'text-green-600' : 'text-gray-700'
          return (
            <li key={p.titulo} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-1">
              <div className="flex items-start gap-2">
                {/* Análises salvas antes do campo "destaque" não o têm. */}
                <p className={`flex-1 text-xl font-bold num leading-none ${cor}`}>{p.destaque || '•'}</p>
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
    <li className="space-y-1" title={`${rotulo}: ${formatBRL(c.atual)} no mês · normal ${formatBRL(c.base)}`}>
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
          {lancamentos.length} lançamentos ({qtdNovas} compras novas, {lancamentos.length - qtdNovas} parcelas)
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
        </>
      )}
    </div>
  )
}

export function BlocoMesFoco({ mesFoco: f }: { mesFoco: MesFoco }) {
  const linhas: Array<{ rotulo: string; c: Comparativo; subirEhBom?: boolean }> = [
    { rotulo: 'Total das faturas', c: f.faturas },
    { rotulo: 'Compras novas (valor cheio)', c: f.compras.valor },
    { rotulo: 'Parcelas de compras antigas', c: f.parcelasEmAndamento.valor },
    { rotulo: 'Contas do planejamento', c: f.contas },
    ...(f.receita ? [{ rotulo: 'Receita', c: f.receita, subirEhBom: true }] : []),
    { rotulo: 'Microgastos (até R$ 50)', c: f.microgastos.valor },
  ]
  const maximo = Math.max(...linhas.flatMap(l => [Math.abs(l.c.atual), Math.abs(l.c.base)]))

  return (
    <Cartao
      titulo={`${rotuloMesIso(f.mes)} vs. seu normal`}
      Icon={CalendarCheck}
      corIcone="text-primary-600"
      corFundo="bg-primary-50"
      subtitulo={`Barra azul: o mês · cinza: média de ${f.mesesBase} ${f.mesesBase === 1 ? 'mês anterior' : 'meses anteriores'}`}
    >
      <ul className="space-y-3">
        {linhas.map(l => <BarraComparativo key={l.rotulo} maximo={maximo} {...l} />)}
      </ul>

      <div className="flex flex-wrap gap-1.5">
        <Chip classe="bg-gray-50 text-gray-600 border-gray-100">
          {f.compras.quantidade.atual} compras novas (normal {f.compras.quantidade.base.toLocaleString('pt-BR', { maximumFractionDigits: 0 })})
        </Chip>
        <Chip classe="bg-gray-50 text-gray-600 border-gray-100">
          {f.novosParcelamentos.quantidade.atual} novos parcelamentos
        </Chip>
        {f.saldo && (
          <Chip classe={f.saldo.atual < 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}>
            Saldo {formatBRL(f.saldo.atual)}
          </Chip>
        )}
      </div>

      {f.novidades.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-1.5 leading-snug">
          <Sparkle className="w-3 h-3 inline -mt-0.5 mr-1" />
          Novo neste mês: {f.novidades.join(' · ')}
        </p>
      )}

      <ListaLancamentos lancamentos={f.lancamentos} />
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
        Compras novas por dia da semana × fase do mês (sem parcelas em andamento). Mais escuro = mais compras.
      </p>
    </div>
  )
}

// ─── Gráficos e números ──────────────────────────────────────────────────────

export function BlocosMetricas({ metricas: m }: { metricas: MetricasComportamento }) {
  const s = m.resumo
  const montarReceita = useMemo(() => (t: TemaGrafico) => graficoReceitaGasto(m, t), [m])
  const montarSaldo = useMemo(() => (t: TemaGrafico) => graficoSaldo(m, t), [m])
  const montarCategorias = useMemo(() => (t: TemaGrafico) => graficoCategorias(m, t), [m])
  const temReceita = m.mensal.some(x => !x.parcial && x.receita > 0)

  return (
    <>
      {m.mesFoco && <BlocoMesFoco mesFoco={m.mesFoco} />}

      <KpisRelatorio
        kpis={[
          { label: 'Receita média', valor: formatBRL(s.receitaMedia) },
          {
            label: 'Gasto médio',
            valor: formatBRL(s.gastoMedio),
            variacao: s.tendenciaGastoPct ?? undefined,
            comparacao: 'últ. 3 meses',
            subirEhBom: false,
          },
          {
            label: 'Taxa de poupança',
            valor: s.taxaPoupancaMedia === null ? '—' : formatarPercentual(s.taxaPoupancaMedia),
            corValor: s.taxaPoupancaMedia !== null && s.taxaPoupancaMedia < 0 ? 'text-red-500' : undefined,
            detalhe: `${s.mesesNoVermelho} ${s.mesesNoVermelho === 1 ? 'mês' : 'meses'} no vermelho`,
          },
          {
            label: 'Microgastos/mês',
            valor: formatBRL(m.ticket.microgastos.mediaMensal),
            detalhe: `compras até ${formatBRL(m.ticket.microgastos.limite)}`,
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Receita × gasto" Icon={Activity} corIcone="text-sky-600" corFundo="bg-sky-50">
          <GraficoComportamento montar={montarReceita} descricao="Receita e gasto total de cada mês fechado" />
        </Cartao>
        {temReceita && (
          <Cartao titulo="Quanto sobrou" Icon={Scale} corIcone="text-sky-600" corFundo="bg-sky-50"
            subtitulo="Saldo do mês: azul sobrou, vermelho faltou">
            <GraficoComportamento montar={montarSaldo} descricao="Saldo de cada mês, receita menos gasto" />
          </Cartao>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Quando você compra" Icon={CalendarDays} corIcone="text-violet-600" corFundo="bg-violet-50">
          <MapaCalor m={m} />
        </Cartao>
        <Cartao titulo="Categorias: agora × normal" Icon={PieChart} corIcone="text-rose-600" corFundo="bg-red-50"
          subtitulo={m.mesFoco ? 'Compras novas do mês × média dos anteriores' : 'Últimos 3 meses × meses anteriores (média mensal)'}>
          <GraficoComportamento montar={montarCategorias} altura={260} descricao="Gasto por categoria agora comparado com o normal" />
        </Cartao>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Cartao titulo="Onde você mais volta" Icon={Store} corIcone="text-orange-600" corFundo="bg-orange-50">
          {m.estabelecimentos.length === 0 ? (
            <p className="text-xs text-gray-400">Sem lugares recorrentes.</p>
          ) : (
            <ul className="space-y-1.5">
              {m.estabelecimentos.slice(0, 6).map(e => (
                <li key={e.nome} className="flex items-center gap-2" title={`${e.categoria} · ticket ${formatBRL(e.ticketMedio)}`}>
                  <span className="w-8 text-xs font-bold text-orange-600 num shrink-0">{e.quantidade}×</span>
                  <span className="flex-1 min-w-0 text-xs text-gray-800 truncate">{e.nome}</span>
                  <span className="text-xs font-semibold text-gray-900 num shrink-0">{formatBRL(e.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Tamanho das compras" Icon={Coins} corIcone="text-emerald-600" corFundo="bg-emerald-50"
          subtitulo={`Mediana ${formatBRL(m.ticket.ticketMediano)}`}>
          <ul className="space-y-2">
            {m.ticket.faixas.map(f => (
              <li key={f.faixa} className="space-y-1" title={`${f.quantidade} compras · ${formatarPercentual(f.pctValor, 0)} do valor`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-gray-600">{f.faixa}</span>
                  <span className="text-[11px] text-gray-400 num">{f.quantidade} · {formatarPercentual(f.pctValor, 0)} do valor</span>
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
            ? `Próximo mês: ${formatarPercentual(m.parcelamentos.pctReceitaProximoMes, 0)} da receita`
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
    </>
  )
}

// ─── O que fazer ─────────────────────────────────────────────────────────────

export function BlocosAcao({ analise: a, metricas: m }: { analise: AnaliseIA; metricas: MetricasComportamento }) {
  const economiaTotal = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)
  const montarPlano = useMemo(() => (t: TemaGrafico) => graficoPlano(a, t), [a])
  const avisos = [...m.qualidade.avisos, ...a.limitacoes]

  return (
    <>
      <Cartao titulo="Plano de ação" Icon={ListChecks} corIcone="text-primary-600" corFundo="bg-primary-50">
        {economiaTotal > 0 && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-600 num">{formatBRL(economiaTotal)}</span>
              <span className="text-xs text-gray-500">por mês · {formatBRL(economiaTotal * 12)} por ano</span>
            </div>
            <GraficoComportamento
              montar={montarPlano}
              altura={Math.max(110, a.planoDeAcao.filter(p => p.economiaMensal > 0).length * 34 + 30)}
              descricao="Economia mensal estimada de cada ação"
            />
          </>
        )}
        <ol className="space-y-2">
          {a.planoDeAcao.map((p, i) => (
            <li key={p.acao} className="flex gap-2.5">
              <span className="w-5 h-5 rounded-md bg-primary-50 text-primary-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 leading-snug">{p.acao}</p>
                <p className="text-[11px] text-gray-500 leading-snug">{p.porque}</p>
              </div>
              <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">{p.prazo}</span>
            </li>
          ))}
        </ol>
      </Cartao>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {([
          { titulo: 'Gatilhos', Icon: Zap, cor: 'text-amber-600', fundo: 'bg-amber-50', itens: a.gatilhos },
          { titulo: 'Riscos', Icon: AlertTriangle, cor: 'text-red-500', fundo: 'bg-red-50', itens: a.riscos },
          { titulo: 'Pontos fortes', Icon: ShieldCheck, cor: 'text-green-600', fundo: 'bg-green-50', itens: a.pontosFortes },
        ] as const).filter(b => b.itens.length > 0).map(b => (
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

      {a.metas.length > 0 && (
        <Cartao titulo="Metas" Icon={Target} corIcone="text-sky-600" corFundo="bg-sky-50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {a.metas.map(meta => (
              <div key={meta.meta} className="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-0.5" title={`Acompanhe: ${meta.indicador}`}>
                <p className="text-base font-bold text-sky-600 leading-tight">{meta.alvo}</p>
                <p className="text-xs font-semibold text-gray-800 leading-snug">{meta.meta}</p>
                <p className="text-[10px] text-gray-400">{meta.prazo}</p>
              </div>
            ))}
          </div>
        </Cartao>
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

      {avisos.length > 0 && (
        <details className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 group">
          <summary className="flex items-center gap-2 text-xs font-semibold text-gray-500 cursor-pointer list-none">
            <Info className="w-3.5 h-3.5" /> Limites desta análise ({avisos.length})
            <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            {avisos.map(l => <li key={l} className="text-[11px] text-gray-500 leading-snug">{l}</li>)}
          </ul>
        </details>
      )}
    </>
  )
}
