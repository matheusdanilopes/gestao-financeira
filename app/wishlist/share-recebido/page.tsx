'use client'

import { useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

function ShareRecebidoContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const id = searchParams.get('id')
  const statusParam = searchParams.get('status')
  const stepParam = searchParams.get('step')
  const isErro = statusParam === 'erro' || !id
  const closingRef = useRef(false)

  useEffect(() => {
    if (isErro) {
      setTimeout(() => router.replace('/wishlist'), 4000)
      return
    }

    // Dispara analyze IMEDIATAMENTE — sem esperar auth para não bloquear o gatilho
    fetch('/api/share-receiver/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(28000),
    }).catch(() => {})

    // Atualiza criado_por em paralelo (melhor esforço, não bloqueia o analyze)
    supabase.auth.getUser()
      .then(({ data: { user } }) => {
        if (!user?.email || !id) return
        Promise.resolve(
          supabase.from('wishlist_items')
            .update({ criado_por: user.email, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('criado_por', 'conjunto')
        ).catch(() => {})
      })
      .catch(() => {})

    // Redireciona para wishlist após 3s, sem aguardar resultado da IA
    const timer = setTimeout(() => {
      if (closingRef.current) return
      closingRef.current = true
      router.replace(`/wishlist?highlight=${id}&ordem=mais-novo`)
    }, 3000)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isErro])

  if (isErro) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950 px-6">
        <div className="flex flex-col items-center gap-8 text-white text-center">
          <div className="w-24 h-24 rounded-3xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <AlertCircle className="w-11 h-11 text-red-400" strokeWidth={1.5} />
          </div>
          <div className="space-y-3">
            <p className="text-2xl font-bold tracking-tight">Não foi possível salvar</p>
            <p className="text-sm text-violet-300/80 max-w-xs leading-relaxed">
              Verifique sua conexão e tente novamente.
            </p>
            {stepParam && (
              <p className="text-xs text-red-400/70 font-mono bg-red-500/10 px-3 py-1.5 rounded-xl">erro: {stepParam}</p>
            )}
          </div>
          <p className="text-xs text-violet-500/70">Fechando automaticamente...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950 px-6">
      <div className="flex flex-col items-center gap-8 text-white text-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-3xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center animate-in zoom-in duration-500">
            <CheckCircle2 className="w-11 h-11 text-emerald-400" strokeWidth={1.5} />
          </div>
          <div className="absolute -inset-2 rounded-3xl border border-emerald-400/20 animate-ping" />
        </div>
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <p className="text-3xl font-bold tracking-tight">Produto Capturado!</p>
          <p className="text-sm text-violet-300/80 leading-relaxed">Identificando com IA em segundo plano...</p>
          <p className="text-xs text-emerald-400 font-semibold">✓ Adicionado à sua Wishlist</p>
        </div>
        <p className="text-xs text-violet-500/60 animate-in fade-in delay-500 duration-700">
          Abrindo wishlist em instantes...
        </p>
      </div>
    </div>
  )
}

export default function ShareRecebidoPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950">
          <div className="w-14 h-14 rounded-2xl bg-white/8 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
          </div>
        </div>
      }
    >
      <ShareRecebidoContent />
    </Suspense>
  )
}
