'use client'

import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Brain, Activity, CalendarDays, Store, TrendingUp, TrendingDown, Zap, ShieldCheck,
  AlertTriangle, ListChecks, Target, HelpCircle, Info, Layers, Coins, Minus,
  CalendarCheck, Receipt, ChevronDown, Sparkle,
} from 'lucide-react'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import KpisRelatorio from '@/components/relatorios/KpisRelatorio'
import { formatBRL } from '@/lib/format'
import { formatarPercentual } from '@/lib/relatoriosFormat'
import { rotuloMesIso } from '@/lib/comportamento/documento'
import type {
  AnaliseIA, Comparativo, FatiaTempo, LancamentoFatura, MesFoco, MetricasComportamento, Nivel,
} from '@/lib/comportamento/tipos'

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

function rotuloNota(nota: number): string {
  if (nota >= 85) return 'Excelente'
  if (nota >= 70) return 'Saudável'
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
const ROTULO_NIVEL: Record<Nivel, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }

function Chip({ children, classe }: { children: React.ReactNode; classe: string }) {
  return (
    <span className={`text-[10px] font-semibold rounded-lg px-1.5 py-0.5 border whitespace-nowrap ${classe}`}>
      {children}
    </span>
  )
}

function Evidencia({ texto }: { texto: string }) {
  if (!texto) return null
  return (
    <p className="text-[11px] text-gray-500 leading-snug bg-gray-50 border border-gray-100 rounded-xl px-2.5 py-1.5">
      <span className="font-semibold text-gray-600">Evidência: </span>{texto}
    </p>
  )
}

/** Barras verticais de distribuição (dia da semana, fase do mês). */
function BarrasFatias({ fatias, referencia }: { fatias: FatiaTempo[]; referencia: number }) {
  const maior = Math.max(...fatias.map(f => f.pctValor), referencia, 1)
  return (
    <div className="space-y-1.5">
      <div className="relative flex items-end gap-1.5 h-24">
        <div
          className="absolute left-0 right-0 border-t border-dashed border-gray-300 pointer-events-none"
          style={{ bottom: `${(referencia / maior) * 100}%` }}
          aria-hidden="true"
        />
        {fatias.map(f => {
          const acima = f.pctValor > referencia * 1.25
          return (
            <div
              key={f.rotulo}
              className="flex-1 h-full flex flex-col justify-end items-center"
              title={`${f.rotulo}: ${formatarPercentual(f.pctValor, 0)} do valor · ${f.quantidade} compras · ticket ${formatBRL(f.ticketMedio)}`}
            >
              <span className={`text-[9px] font-semibold num mb-0.5 ${acima ? 'text-violet-600' : 'text-gray-400'}`}>
                {formatarPercentual(f.pctValor, 0)}
              </span>
              <span
                className={`w-full rounded-t-md ${acima ? 'bg-violet-500' : 'bg-violet-200'}`}
                style={{ height: `${Math.max(3, (f.pctValor / maior) * 100)}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1.5">
        {fatias.map(f => (
          <span key={f.rotulo} className="flex-1 text-center text-[9px] text-gray-400 leading-tight truncate">
            {f.rotulo.startsWith('Dias') ? f.rotulo.replace('Dias ', '') : f.rotulo.slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Mês em foco (modo "último mês") ─────────────────────────────────────────

/** "+12%" colorido: subir é ruim por padrão (gasto). */
function Variacao({ c, subirEhBom = false }: { c: Comparativo; subirEhBom?: boolean }) {
  const v = c.variacaoPct
  if (v === null) return <span className="text-[11px] text-gray-400">sem base</span>
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

function LinhaComparativo({
  rotulo, c, formato = 'moeda', subirEhBom,
}: {
  rotulo: string
  c: Comparativo
  formato?: 'moeda' | 'numero' | 'pct'
  subirEhBom?: boolean
}) {
  const fmt = (n: number) =>
    formato === 'moeda' ? formatBRL(n) : formato === 'pct' ? formatarPercentual(n, 0) : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return (
    <li className="py-2 flex items-center gap-3">
      <span className="flex-1 min-w-0 text-xs font-medium text-gray-700 truncate">{rotulo}</span>
      <div className="text-right shrink-0">
        <p className="text-xs font-bold text-gray-900 num">{fmt(c.atual)}</p>
        <p className="text-[10px] text-gray-400 num">normal {fmt(c.base)}</p>
      </div>
      <span className="w-12 text-right shrink-0"><Variacao c={c} subirEhBom={subirEhBom} /></span>
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
          {lancamentos.length} lançamentos enviados ao analista ({qtdNovas} compras novas,{' '}
          {lancamentos.length - qtdNovas} parcelas em andamento)
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
                    {l.tipo === 'parcela_em_andamento' ? ' · parcela em andamento' : ''}
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
  return (
    <Cartao
      titulo={`${rotuloMesIso(f.mes)} vs. seu normal`}
      Icon={CalendarCheck}
      corIcone="text-primary-600"
      corFundo="bg-primary-50"
      subtitulo={`Faturas pagas no mês, comparadas com a média de ${f.mesesBase} ${f.mesesBase === 1 ? 'mês anterior' : 'meses anteriores'}`}
    >
      <ul className="divide-y divide-gray-100">
        <LinhaComparativo rotulo="Total das faturas" c={f.faturas} />
        <LinhaComparativo rotulo="Compras novas (valor cheio)" c={f.compras.valor} />
        <LinhaComparativo rotulo="Quantidade de compras novas" c={f.compras.quantidade} formato="numero" />
        <LinhaComparativo rotulo="Parcelas de compras antigas" c={f.parcelasEmAndamento.valor} />
        <LinhaComparativo rotulo="Contas do planejamento" c={f.contas} />
        {f.receita && <LinhaComparativo rotulo="Receita" c={f.receita} subirEhBom />}
        {f.saldo && <LinhaComparativo rotulo="Saldo do mês" c={f.saldo} subirEhBom />}
        <LinhaComparativo rotulo="Microgastos" c={f.microgastos.valor} />
        <LinhaComparativo rotulo="Novos parcelamentos" c={f.novosParcelamentos.quantidade} formato="numero" />
      </ul>

      {f.categorias.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-700 pt-1">Por categoria (compras novas)</p>
          <ul className="divide-y divide-gray-100">
            {f.categorias.slice(0, 8).map(c => (
              <LinhaComparativo key={c.categoria} rotulo={c.categoria} c={c} />
            ))}
          </ul>
        </div>
      )}

      {f.novidades.length > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 space-y-1">
          <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
            <Sparkle className="w-3 h-3" /> Novidades neste mês
          </p>
          <p className="text-xs text-amber-700 leading-snug">{f.novidades.join(' · ')}</p>
        </div>
      )}

      <ListaLancamentos lancamentos={f.lancamentos} />
    </Cartao>
  )
}

// ─── Blocos de métricas (aparecem antes mesmo de a IA terminar) ──────────────

export function BlocosMetricas({ metricas: m }: { metricas: MetricasComportamento }) {
  const pontos = m.mensal.map(x => ({
    label: `${rotuloMesIso(x.mes)}${x.parcial ? ' (parcial)' : ''}`,
    valor: x.gastoTotal,
    destaque: false,
    projetado: x.parcial,
  }))
  const s = m.resumo

  return (
    <>
      {m.mesFoco && <BlocoMesFoco mesFoco={m.mesFoco} />}

      <KpisRelatorio
        kpis={[
          { label: 'Receita média', valor: formatBRL(s.receitaMedia), detalhe: m.mesFoco ? `${m.periodo.mesesFechados} meses fechados` : 'meses fechados' },
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
            detalhe: `${m.ticket.microgastos.quantidade} compras até ${formatBRL(m.ticket.microgastos.limite)}`,
          },
        ]}
      />

      <Cartao titulo="Gasto mês a mês" Icon={Activity} corIcone="text-sky-600" corFundo="bg-sky-50"
        subtitulo={`Oscilação de ${formatarPercentual(s.oscilacaoGastoPct, 0)} entre os meses`}>
        <GraficoBarrasMeses pontos={pontos} media={s.gastoMedio} />
      </Cartao>

      <Cartao titulo="Quando você gasta" Icon={CalendarDays} corIcone="text-violet-600" corFundo="bg-violet-50"
        subtitulo={`${m.qualidade.comprasAnalisadas} compras novas${m.mesFoco ? ` das faturas de ${rotuloMesIso(m.mesFoco.mes)}` : ''}, pela data da compra (sem parcelas em andamento)`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-700">Dia da semana</p>
            <BarrasFatias fatias={m.quando.diasSemana} referencia={100 / 7} />
            <p className="text-[11px] text-gray-400">
              Fim de semana: {formatarPercentual(m.quando.fimDeSemanaPctValor, 0)} do valor (uniforme seria 29%).
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-700">Fase do mês</p>
            <BarrasFatias fatias={m.quando.fasesDoMes} referencia={100 / 6} />
            {m.quando.semanaDoRecebimento && (
              <p className="text-[11px] text-gray-400">
                Até 6 dias após receber: {formatarPercentual(m.quando.semanaDoRecebimento.pctValor, 0)} do valor
                (esperado ~{m.quando.semanaDoRecebimento.esperadoPct}%).
              </p>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-400 leading-snug">
          Linha tracejada: como seria se o gasto fosse distribuído por igual. Barras escuras ficam bem acima disso.
        </p>
      </Cartao>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Onde você mais volta" Icon={Store} corIcone="text-orange-600" corFundo="bg-orange-50"
          subtitulo="Estabelecimentos por frequência de compra">
          {m.estabelecimentos.length === 0 ? (
            <p className="text-xs text-gray-400">Sem estabelecimentos recorrentes no período.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {m.estabelecimentos.slice(0, 8).map(e => (
                <li key={e.nome} className="py-2 flex items-center gap-3">
                  <span className="w-8 text-center text-xs font-bold text-orange-600 num shrink-0">{e.quantidade}×</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{e.nome}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {e.categoria} · ticket {formatBRL(e.ticketMedio)} · {e.mesesPresente} {e.mesesPresente === 1 ? 'mês' : 'meses'}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-gray-900 num shrink-0">{formatBRL(e.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Categorias em movimento" Icon={TrendingUp} corIcone="text-rose-600" corFundo="bg-red-50"
          subtitulo="Média dos últimos 3 meses vs. meses anteriores">
          {m.categorias.length === 0 ? (
            <p className="text-xs text-gray-400">Sem categorias no período.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {m.categorias.slice(0, 8).map(c => {
                const v = c.variacaoPct
                const Icone = v === null || Math.abs(v) < 5 ? Minus : v > 0 ? TrendingUp : TrendingDown
                const cor = v === null || Math.abs(v) < 5 ? 'text-gray-400' : v > 0 ? 'text-red-500' : 'text-green-600'
                return (
                  <li key={c.categoria} className="py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{c.categoria}</p>
                      <p className="text-[11px] text-gray-400">
                        {formatBRL(c.mediaMensal)}/mês · {formatarPercentual(c.pct, 0)} do total
                      </p>
                    </div>
                    <span className={`flex items-center gap-1 text-xs font-semibold num shrink-0 ${cor}`}>
                      <Icone className="w-3.5 h-3.5" strokeWidth={2.2} />
                      {v === null ? 'novo' : `${v > 0 ? '+' : ''}${formatarPercentual(v, 0)}`}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Cartao>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Tamanho das compras" Icon={Coins} corIcone="text-emerald-600" corFundo="bg-emerald-50"
          subtitulo={`Ticket médio ${formatBRL(m.ticket.ticketMedio)} · mediana ${formatBRL(m.ticket.ticketMediano)}`}>
          <ul className="space-y-2">
            {m.ticket.faixas.map(f => (
              <li key={f.faixa} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-gray-700">{f.faixa}</span>
                  <span className="text-[11px] text-gray-400 num">
                    {f.quantidade} compras ({formatarPercentual(f.pctQuantidade, 0)}) ·{' '}
                    <span className="font-semibold text-gray-700">{formatarPercentual(f.pctValor, 0)} do valor</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
                  <div className="h-full bg-emerald-300" style={{ width: `${f.pctQuantidade}%` }} title="% das compras" />
                </div>
              </li>
            ))}
          </ul>
        </Cartao>

        <Cartao titulo="Parcelas e compromissos" Icon={Layers} corIcone="text-teal-600" corFundo="bg-teal-50"
          subtitulo={`${m.parcelamentos.comprasParceladas} compras parceladas (${formatarPercentual(m.parcelamentos.pctComprasParceladas, 0)} das compras)`}>
          {m.parcelamentos.compromissoFuturo.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhuma parcela contratada para os próximos meses.</p>
          ) : (
            <>
              <GraficoBarrasMeses
                altura={72}
                pontos={m.parcelamentos.compromissoFuturo.map((c, i) => ({
                  label: rotuloMesIso(c.mes), valor: c.valor, destaque: i === 0,
                }))}
              />
              {m.parcelamentos.pctReceitaProximoMes !== null && (
                <p className="text-[11px] text-gray-400">
                  As parcelas do próximo mês já levam {formatarPercentual(m.parcelamentos.pctReceitaProximoMes, 0)} da receita média.
                </p>
              )}
            </>
          )}
        </Cartao>
      </div>
    </>
  )
}

// ─── Leitura do analista ─────────────────────────────────────────────────────

export function BlocosAnalise({ analise: a, metricas: m }: { analise: AnaliseIA; metricas: MetricasComportamento }) {
  const economiaTotal = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)

  return (
    <>
      <Cartao titulo="Padrões identificados" Icon={Brain} corIcone="text-violet-600" corFundo="bg-violet-50">
        <ul className="space-y-2.5">
          {a.padroes.map(p => (
            <li key={p.titulo} className="rounded-2xl border border-gray-100 p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                    p.impacto === 'negativo' ? 'bg-red-500' : p.impacto === 'positivo' ? 'bg-green-500' : 'bg-gray-300'}`}
                  aria-label={`Impacto ${p.impacto}`}
                />
                <p className="flex-1 text-sm font-semibold text-gray-900 leading-snug">{p.titulo}</p>
                <Chip classe={ESTILO_NIVEL[p.relevancia]}>{ROTULO_NIVEL[p.relevancia]}</Chip>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{p.descricao}</p>
              <Evidencia texto={p.evidencia} />
            </li>
          ))}
        </ul>
      </Cartao>

      {a.gatilhos.length > 0 && (
        <Cartao titulo="Gatilhos de gasto" Icon={Zap} corIcone="text-amber-600" corFundo="bg-amber-50"
          subtitulo="Situações que costumam disparar gasto">
          <ul className="space-y-2.5">
            {a.gatilhos.map(g => (
              <li key={g.titulo} className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">{g.titulo}</p>
                <p className="text-xs text-gray-600 leading-relaxed">{g.descricao}</p>
                <Evidencia texto={g.evidencia} />
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Cartao titulo="Pontos fortes" Icon={ShieldCheck} corIcone="text-green-600" corFundo="bg-green-50">
          <ul className="space-y-2">
            {a.pontosFortes.map(p => (
              <li key={p.titulo}>
                <p className="text-xs font-semibold text-gray-800">{p.titulo}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{p.descricao}</p>
              </li>
            ))}
          </ul>
        </Cartao>
        <Cartao titulo="Riscos" Icon={AlertTriangle} corIcone="text-red-500" corFundo="bg-red-50">
          <ul className="space-y-2">
            {a.riscos.map(r => (
              <li key={r.titulo}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-xs font-semibold text-gray-800">{r.titulo}</p>
                  <Chip classe={ESTILO_NIVEL[r.probabilidade]}>{ROTULO_NIVEL[r.probabilidade]}</Chip>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{r.descricao}</p>
              </li>
            ))}
          </ul>
        </Cartao>
      </div>

      <Cartao titulo="Plano de ação" Icon={ListChecks} corIcone="text-primary-600" corFundo="bg-primary-50"
        subtitulo={economiaTotal > 0 ? `Economia potencial estimada: ${formatBRL(economiaTotal)}/mês · ${formatBRL(economiaTotal * 12)}/ano` : undefined}>
        <ol className="space-y-2.5">
          {a.planoDeAcao.map((p, i) => (
            <li key={p.acao} className="flex gap-3 rounded-2xl border border-gray-100 p-3">
              <span className="w-6 h-6 rounded-lg bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-gray-900 leading-snug">{p.acao}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{p.porque}</p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {p.economiaMensal > 0 && (
                    <Chip classe="bg-green-50 text-green-700 border-green-100">−{formatBRL(p.economiaMensal)}/mês</Chip>
                  )}
                  <Chip classe="bg-gray-50 text-gray-500 border-gray-100">
                    {p.dificuldade === 'facil' ? 'Fácil' : p.dificuldade === 'media' ? 'Esforço médio' : 'Difícil'}
                  </Chip>
                  {p.prazo && <Chip classe="bg-gray-50 text-gray-500 border-gray-100">{p.prazo}</Chip>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Cartao>

      {a.metas.length > 0 && (
        <Cartao titulo="Metas sugeridas" Icon={Target} corIcone="text-sky-600" corFundo="bg-sky-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {a.metas.map(meta => (
              <div key={meta.meta} className="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-1">
                <p className="text-xs font-semibold text-gray-800 leading-snug">{meta.meta}</p>
                <p className="text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-600">{meta.alvo}</span>
                  {meta.prazo ? ` · ${meta.prazo}` : ''}
                </p>
                <p className="text-[11px] text-gray-400 leading-snug">Acompanhe: {meta.indicador}</p>
              </div>
            ))}
          </div>
        </Cartao>
      )}

      {a.perguntas.length > 0 && (
        <Cartao titulo="Para refletir" Icon={HelpCircle} corIcone="text-indigo-600" corFundo="bg-indigo-50">
          <ul className="space-y-1.5">
            {a.perguntas.map(q => (
              <li key={q} className="text-xs text-gray-600 leading-relaxed pl-3 border-l-2 border-indigo-200">{q}</li>
            ))}
          </ul>
        </Cartao>
      )}

      {(a.limitacoes.length > 0 || m.qualidade.avisos.length > 0) && (
        <Cartao titulo="Limites desta análise" Icon={Info} corIcone="text-gray-500" corFundo="bg-gray-100">
          <ul className="space-y-1 list-disc pl-4">
            {[...m.qualidade.avisos, ...a.limitacoes].map(l => (
              <li key={l} className="text-[11px] text-gray-500 leading-snug">{l}</li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  )
}

/** Cabeçalho do resultado: nota, manchete, perfil e resumo. */
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
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Saúde financeira</p>
          <p className={`text-lg font-bold leading-tight ${corNota(nota).texto}`}>{rotuloNota(nota)}</p>
          {delta !== null && (
            <p className={`text-[11px] font-semibold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {delta === 0 ? 'Igual à análise anterior' : `${delta > 0 ? '+' : ''}${delta} pontos desde a análise anterior`}
            </p>
          )}
          <p className="text-sm font-semibold text-gray-900 leading-snug">{a.manchete}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-violet-50 border border-violet-100 p-3 space-y-1.5">
        <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-wide">Seu perfil</p>
        <p className="text-sm font-bold text-gray-900">{a.perfil.nome}</p>
        <p className="text-xs text-gray-600 leading-relaxed">{a.perfil.descricao}</p>
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

      <div className="space-y-2">
        {a.resumo.split(/\n\s*\n/).filter(Boolean).map((par, i) => (
          <p key={i} className="text-xs text-gray-600 leading-relaxed">{par.trim()}</p>
        ))}
      </div>

      {m.saude.indicadores.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-xs font-semibold text-gray-700">O que compõe a nota</p>
          <ul className="space-y-2">
            {m.saude.indicadores.map(i => (
              <li key={i.chave} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-gray-700 truncate">{i.nome}</span>
                  <span className={`text-xs font-bold num shrink-0 ${corNota(i.nota).texto}`}>{i.nota}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full ${corNota(i.nota).barra}`} style={{ width: `${Math.max(2, i.nota)}%` }} />
                </div>
                <p className="text-[11px] text-gray-400">{i.medida} · referência: {i.referencia}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
