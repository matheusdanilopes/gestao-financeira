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

    // Dispara análise IA com o email do usuário logado para associar o item corretamente
    supabase.auth.getUser().then(({ data: { user } }) => {
      fetch('/api/share-receiver/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, criado_por: user?.email ?? null }),
      }).catch(() => {})
    })

    // Fecha para wishlist após 3s, sem esperar o resultado da IA
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
          <div className="w-24 h-24 rounded-full bg-red-500/20 border-2 border-red-400 flex items-center justify-center">
            <AlertCircle className="w-12 h-12 text-red-400" />
          </div>
          <div className="space-y-3">
            <p className="text-2xl font-bold tracking-tight">Não foi possível salvar</p>
            <p className="text-sm text-violet-300 max-w-xs leading-relaxed">
              Verifique sua conexão e tente novamente.
            </p>
            {stepParam && (
              <p className="text-xs text-red-400 font-mono">erro: {stepParam}</p>
            )}
          </div>
          <p className="text-xs text-violet-500">Fechando automaticamente...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950 px-6">
      <div className="flex flex-col items-center gap-8 text-white text-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center animate-in zoom-in duration-500">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
          </div>
          <div className="absolute -inset-1 rounded-full border-2 border-emerald-400/30 animate-ping" />
        </div>
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <p className="text-3xl font-bold tracking-tight">Produto Capturado!</p>
          <p className="text-sm text-violet-300">Identificando com IA em segundo plano...</p>
          <p className="text-xs text-emerald-400">✓ Adicionado à sua Wishlist</p>
        </div>
        <p className="text-xs text-violet-500 animate-in fade-in delay-500 duration-700">
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
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        </div>
      }
    >
      <ShareRecebidoContent />
    </Suspense>
  )
}
