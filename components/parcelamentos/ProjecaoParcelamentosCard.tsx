'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { format, startOfMonth } from 'date-fns'
import { TrendingUp, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { InfoPopover } from '@/components/InfoPopover'
import { buscarCartaoLabels, CARTAO_LABELS_PADRAO, type CartaoLabels } from '@/lib/cartaoLabels'
import { RESPONSAVEL_STYLE } from '@/lib/responsavelStyle'
import type { RelatorioCartoes } from '@/lib/relatorioCartoes'
import { formatarMes } from '@/lib/relatoriosFormat'

const GraficoProjecao = dynamic(() => import('@/components/GraficoProjecao'), {
  ssr: false,
  loading: () => <div className="h-56 md:h-64 skeleton rounded-2xl" />,
})
const DrawerDetalhes = dynamic(() => import('@/components/DrawerDetalhes'), { ssr: false })


interface Props {
  mesAtual: Date
  relatorio: RelatorioCartoes | null
}

interface DetalhesPonto {
  serie: string
  mes: string
  valor: number
  itens: Record<string, unknown>[]
}

export default function ProjecaoParcelamentosCard({ mesAtual, relatorio }: Props) {
  const [cartaoLabels, setCartaoLabels] = useState<CartaoLabels>(CARTAO_LABELS_PADRAO)
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<DetalhesPonto | null>(null)

  useEffect(() => {
    let cancelado = false
    const mesReferencia = format(startOfMonth(mesAtual), 'yyyy-MM-dd')
    buscarCartaoLabels(supabase, mesReferencia).then(labels => {
      if (!cancelado) setCartaoLabels(labels)
    })
    return () => { cancelado = true }
  }, [mesAtual])

  const livreEm = useMemo(() => {
    if (!relatorio) return null
    const porPessoa: Record<'Matheus' | 'Jeniffer', Date | null> = { Matheus: null, Jeniffer: null }
    for (const p of relatorio.parcelamentosAbertos) {
      if (p.responsavel !== 'Matheus' && p.responsavel !== 'Jeniffer') continue
      const atual = porPessoa[p.responsavel]
      if (!atual || p.mesTermino > atual) porPessoa[p.responsavel] = p.mesTermino
    }
    return { porPessoa }
  }, [relatorio])

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex-1 flex items-center gap-1.5">
          Projeção de Parcelamentos
          <InfoPopover texto="Total de parcelas previstas mês a mês, por pessoa, a partir das compras parceladas já registradas — até o último mês em que ainda houver alguma parcela em aberto. Toque duas vezes em um ponto do gráfico para ver os detalhes do mês." />
        </h2>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 ml-10">Até a última parcela em aberto · Toque duas vezes no mês para ver detalhes</p>

      <GraficoProjecao
        mesInicio={mesAtual}
        onPontoClicado={(serie, mes, valor, itens) => {
          setDetalhesPonto({ serie, mes, valor, itens })
          setDrawerAberto(true)
        }}
      />

      {livreEm && (livreEm.porPessoa.Matheus || livreEm.porPessoa.Jeniffer) && (
        <div className="grid grid-cols-2 gap-2 mt-4">
          {(['Matheus', 'Jeniffer'] as const).map(resp => {
            const data = livreEm.porPessoa[resp]
            const { texto, iconBg } = RESPONSAVEL_STYLE[resp]
            return (
              <div key={resp} className={`rounded-2xl p-3 ${iconBg}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${texto}`}>{resp} livre em</p>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-0.5">
                  {data ? formatarMes(data) : 'Já está livre'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      <Link
        href="/relatorios/cartoes"
        className="tap-scale mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 py-1"
      >
        Ver relatório completo <ArrowRight className="w-3.5 h-3.5" />
      </Link>

      <DrawerDetalhes
        aberto={drawerAberto}
        onClose={() => setDrawerAberto(false)}
        dados={detalhesPonto}
        cartaoLabels={{ ...cartaoLabels }}
      />
    </div>
  )
}
