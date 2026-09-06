'use client'

import { AlertTriangle, CheckCircle2, Info, TrendingDown, Lightbulb } from 'lucide-react'

export type TomDestaque = 'positivo' | 'atencao' | 'negativo' | 'neutro'

export interface Destaque {
  tom: TomDestaque
  titulo: string
  detalhe?: string
}

const ESTILO: Record<TomDestaque, { Icon: typeof Info; cor: string; fundo: string }> = {
  positivo: { Icon: CheckCircle2,   cor: 'text-green-600',  fundo: 'bg-green-50' },
  atencao:  { Icon: AlertTriangle,  cor: 'text-amber-600',  fundo: 'bg-amber-50' },
  negativo: { Icon: TrendingDown,   cor: 'text-red-500',    fundo: 'bg-red-50' },
  neutro:   { Icon: Info,           cor: 'text-sky-600',    fundo: 'bg-sky-50' },
}

/**
 * Leitura pronta dos números: o que mudou, o que estourou, o que sobrou.
 * É a diferença entre "aqui estão seus dados" e "aqui está o que eles dizem".
 */
export default function DestaquesRelatorio({ destaques }: { destaques: Destaque[] }) {
  if (destaques.length === 0) return null

  return (
    <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
          <Lightbulb className="w-4 h-4 text-primary-600" strokeWidth={1.8} />
        </div>
        <h2 className="font-bold text-gray-900 tracking-tight">Destaques do período</h2>
      </div>

      <ul className="space-y-2">
        {destaques.map((d, idx) => {
          const { Icon, cor, fundo } = ESTILO[d.tom]
          return (
            <li key={idx} className="flex gap-2.5 items-start">
              <span className={`w-6 h-6 rounded-lg ${fundo} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon className={`w-3.5 h-3.5 ${cor}`} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800 leading-snug">{d.titulo}</p>
                {d.detalhe && <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{d.detalhe}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
