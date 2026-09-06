'use client'

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { formatarVariacao } from '@/lib/relatoriosFormat'

export interface KpiRelatorio {
  label: string
  /** Valor já formatado (moeda, percentual, contagem…). */
  valor: string
  /**
   * Variação percentual contra o período de comparação. `null` = sem base
   * (o período anterior estava zerado), o que a UI mostra como "sem base".
   */
  variacao?: number | null
  /** Texto do que está sendo comparado — "vs. mês anterior". */
  comparacao?: string
  /** `false` quando subir é ruim (despesas). Padrão: subir é bom. */
  subirEhBom?: boolean
  /** Linha de contexto abaixo do valor. */
  detalhe?: string
  /** Cor do valor — usada para saldo negativo, por exemplo. */
  corValor?: string
}

function CorpoVariacao({ kpi }: { kpi: KpiRelatorio }) {
  if (kpi.variacao === undefined) return null

  if (kpi.variacao === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
        <Minus className="w-3 h-3" strokeWidth={2.4} />
        sem base {kpi.comparacao ?? ''}
      </span>
    )
  }

  const subiu = kpi.variacao > 0
  const neutro = Math.abs(kpi.variacao) < 0.05
  const bom = kpi.subirEhBom === false ? !subiu : subiu
  const cor = neutro ? 'text-gray-400' : bom ? 'text-green-600' : 'text-red-500'
  const Icone = neutro ? Minus : subiu ? ArrowUpRight : ArrowDownRight

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${cor}`}>
      <Icone className="w-3 h-3" strokeWidth={2.4} />
      {formatarVariacao(kpi.variacao)}
      {kpi.comparacao && <span className="font-normal text-gray-400">{kpi.comparacao}</span>}
    </span>
  )
}

/** Faixa de indicadores no topo de um relatório — o "resumo executivo" da tela. */
export default function KpisRelatorio({ kpis }: { kpis: KpiRelatorio[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {kpis.map(kpi => (
        <div
          key={kpi.label}
          className="bg-white rounded-2xl shadow-card border border-gray-100 p-3.5 space-y-1"
        >
          <p className="text-[11px] font-semibold text-gray-500 tracking-tight leading-tight">{kpi.label}</p>
          <p className={`text-lg font-bold value-tight leading-tight ${kpi.corValor ?? 'text-gray-900'}`}>
            {kpi.valor}
          </p>
          <CorpoVariacao kpi={kpi} />
          {kpi.detalhe && <p className="text-[11px] text-gray-400 leading-snug">{kpi.detalhe}</p>}
        </div>
      ))}
    </div>
  )
}
