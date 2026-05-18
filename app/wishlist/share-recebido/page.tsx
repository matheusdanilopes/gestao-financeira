'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, AlertCircle, Loader2, ShoppingBag } from 'lucide-react'

type FinalStatus = 'identificado' | 'nao_identificado' | 'erro'

function ShareRecebidoContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const id = searchParams.get('id')
  const statusParam = searchParams.get('status') as FinalStatus | null

  // A rota já entrega o status final na URL — não há polling necessário
  const status: FinalStatus = statusParam === 'identificado'
    ? 'identificado'
    : statusParam === 'nao_identificado'
      ? 'nao_identificado'
      : 'erro'

  const closingRef = useRef(false)

  const fechar = (delay = 3000) => {
    if (closingRef.current) return
    closingRef.current = true
    const destino = id
      ? `/wishlist?highlight=${id}&ordem=mais-novo`
      : '/wishlist'
    setTimeout(() => router.replace(destino), delay)
  }

  useEffect(() => {
    fechar(status === 'identificado' ? 3000 : 4000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'identificado') {
    const nome = searchParams.get('nome')
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
            {nome && <p className="text-lg text-violet-200 font-medium px-4">{nome}</p>}
            <p className="text-sm text-emerald-400">✓ Adicionado à sua Wishlist</p>
          </div>
          <p className="text-xs text-violet-500 animate-in fade-in delay-1000 duration-700">
            Fechando automaticamente...
          </p>
        </div>
      </div>
    )
  }

  if (status === 'nao_identificado') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950 px-6">
        <div className="flex flex-col items-center gap-8 text-white text-center">
          <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center">
            <ShoppingBag className="w-12 h-12 text-amber-400" />
          </div>
          <div className="space-y-3">
            <p className="text-2xl font-bold tracking-tight">Produto Capturado!</p>
            <p className="text-sm text-violet-300 max-w-xs leading-relaxed">
              Recebemos sua imagem, mas ela será processada em instantes.
            </p>
            <p className="text-xs text-amber-400">Salvo na sua Wishlist como "Produto compartilhado".</p>
          </div>
          <p className="text-xs text-violet-500">Fechando automaticamente...</p>
        </div>
      </div>
    )
  }

  // erro
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
        </div>
        <p className="text-xs text-violet-500">Fechando automaticamente...</p>
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
