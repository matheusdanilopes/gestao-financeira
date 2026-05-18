'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { CheckCircle2, AlertCircle, Loader2, ShoppingBag } from 'lucide-react'

type AiStatus = 'loading' | 'identificado' | 'nao_identificado' | 'pendente' | 'erro'

// Intervalo e limite do polling
const POLL_INTERVAL_MS = 2000
const MAX_POLL_MS = 22000

function ShareRecebidoContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = searchParams.get('id')
  const statusParam = searchParams.get('status')

  const [status, setStatus] = useState<AiStatus>(statusParam === 'erro' ? 'erro' : 'loading')
  const [nomeProduto, setNomeProduto] = useState<string | null>(null)
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
    if (!id || statusParam === 'erro') {
      fechar(statusParam === 'erro' ? 4000 : 0)
      return
    }

    const deadline = Date.now() + MAX_POLL_MS
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const { data } = await supabase
          .from('wishlist_items')
          .select('ai_status, nome')
          .eq('id', id)
          .single()

        if (data && data.ai_status !== 'pendente') {
          setStatus(data.ai_status as AiStatus)
          if (data.nome && data.nome !== 'Produto compartilhado') setNomeProduto(data.nome)
          fechar()
          return
        }
      } catch {
        // ignora erros transitórios de rede
      }

      if (Date.now() >= deadline) {
        setStatus('nao_identificado')
        fechar(4000)
        return
      }

      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    // Aguarda 1s antes do primeiro poll para dar tempo ao after() iniciar
    timer = setTimeout(poll, 1000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, statusParam])

  if (status === 'loading') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950 px-6">
        <div className="flex flex-col items-center gap-8 text-white text-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
              <ShoppingBag className="w-12 h-12 text-violet-300" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center shadow-lg">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-2xl font-bold tracking-tight">Analisando produto</p>
            <p className="text-sm text-violet-300">Identificando com IA...</p>
          </div>
          <div className="flex gap-2 mt-2">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-violet-400 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (status === 'identificado') {
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
            {nomeProduto && (
              <p className="text-lg text-violet-200 font-medium px-4">{nomeProduto}</p>
            )}
            <p className="text-sm text-emerald-400">✓ Adicionado à sua Wishlist</p>
          </div>
          <p className="text-xs text-violet-500 animate-in fade-in delay-1000 duration-700">
            Fechando automaticamente...
          </p>
        </div>
      </div>
    )
  }

  // nao_identificado | pendente | erro
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950 px-6">
      <div className="flex flex-col items-center gap-8 text-white text-center">
        <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center">
          <AlertCircle className="w-12 h-12 text-amber-400" />
        </div>
        <div className="space-y-3">
          <p className="text-2xl font-bold tracking-tight">Imagem Recebida</p>
          <p className="text-sm text-violet-300 max-w-xs leading-relaxed">
            Recebemos sua imagem, mas ela será processada em instantes.
          </p>
          <p className="text-xs text-amber-400">O produto foi salvo na sua Wishlist.</p>
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
