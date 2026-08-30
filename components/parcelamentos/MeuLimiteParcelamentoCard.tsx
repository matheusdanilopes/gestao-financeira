'use client'

import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { nomeDoUsuario } from '@/lib/notificacoes'
import { formatBRL } from '@/lib/format'
import { RESPONSAVEL_STYLE, type Responsavel } from '@/lib/responsavelStyle'

export type ResumoLimitePorPessoa = Record<Responsavel, { limite: number; gasto: number }>

interface Props {
  resumo: ResumoLimitePorPessoa | null
}

// Card de destaque no topo da tela: quanto do limite mensal de parcelamentos
// o usuário logado (Matheus/Jeniffer, deduzido do e-mail — mesmo heurístico de
// lib/notificacoes.ts) já comprometeu no mês selecionado.
export default function MeuLimiteParcelamentoCard({ resumo }: Props) {
  const [responsavel, setResponsavel] = useState<Responsavel | null>(null)

  useEffect(() => {
    let cancelado = false
    async function init() {
      if (AUTH_DISABLED) {
        if (!cancelado) setResponsavel('Matheus')
        return
      }
      const { data: { session } } = await supabase.auth.getSession()
      const email = session?.user?.email
      if (!email || cancelado) return
      setResponsavel(nomeDoUsuario(email) === 'Jeniffer' ? 'Jeniffer' : 'Matheus')
    }
    init()
    return () => { cancelado = true }
  }, [])

  if (!responsavel || !resumo) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-5 animate-pulse" aria-hidden="true">
        <div className="h-3 w-40 bg-gray-100 dark:bg-white/[0.06] rounded-full mb-4" />
        <div className="h-10 w-24 bg-gray-100 dark:bg-white/[0.06] rounded-xl mb-4" />
        <div className="h-2 w-full bg-gray-100 dark:bg-white/[0.06] rounded-full" />
      </div>
    )
  }

  const { limite, gasto } = resumo[responsavel]
  const { texto, iconBg } = RESPONSAVEL_STYLE[responsavel]
  const pct = limite > 0 ? (gasto / limite) * 100 : 0
  const corTexto = pct >= 100 ? 'text-red-600 dark:text-red-400' : pct >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
  const corBarra = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-5 content-enter">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-9 h-9 rounded-2xl ${iconBg} flex items-center justify-center shrink-0`}>
          <Gauge className={`w-4.5 h-4.5 ${texto}`} />
        </div>
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Seu limite de parcelamentos · {responsavel}
        </p>
      </div>

      {limite > 0 ? (
        <>
          <p
            key={`${responsavel}-${Math.round(pct)}`}
            className={`text-5xl font-bold num value-tight value-update ${corTexto}`}
          >
            {Math.round(Math.min(pct, 999))}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 num">
            {formatBRL(gasto)} <span className="text-gray-400 dark:text-gray-500">de {formatBRL(limite)} utilizados</span>
          </p>
          <div
            className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mt-3"
            role="progressbar"
            aria-valuenow={Math.round(Math.min(pct, 100))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Limite de parcelamentos utilizado por ${responsavel}: ${Math.round(Math.min(pct, 100))}%`}
          >
            <div
              key={`${responsavel}-barra-${Math.round(pct)}`}
              className={`h-full rounded-full bar-enter ${corBarra}`}
              style={{ '--bar-w': `${Math.min(pct, 100)}%` } as React.CSSProperties}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Você ainda não definiu um limite mensal. Configure abaixo, em &quot;Limites por pessoa&quot;, para acompanhar seu progresso.
        </p>
      )}
    </div>
  )
}
