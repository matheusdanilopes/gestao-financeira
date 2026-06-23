'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { TrendingUp, Eye, EyeOff } from 'lucide-react'

const LOGIN_TIMEOUT_MS = 12000

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const router = useRouter()

  useEffect(() => {
    document.body.classList.add('on-login-page')
    return () => { document.body.classList.remove('on-login-page') }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErro('')

    try {
      if (AUTH_DISABLED) {
        router.replace('/dashboard')
        router.refresh()
        return
      }

      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
        setErro('Configuração do Supabase ausente no deploy (NEXT_PUBLIC_SUPABASE_URL).')
        setLoading(false)
        return
      }

      const loginPromise = supabase.auth.signInWithPassword({ email, password: senha })
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), LOGIN_TIMEOUT_MS)
      })

      const { data, error } = await Promise.race([loginPromise, timeoutPromise])

      if (error || !data.session) {
        setErro('Email ou senha incorretos')
        return
      }

      router.replace('/dashboard')
      router.refresh()
    } catch (_err) {
      setErro('Não foi possível concluir o login. Verifique sua conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-40 -right-40 w-[480px] h-[480px] rounded-full bg-primary-100 opacity-50 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-[480px] h-[480px] rounded-full bg-primary-100 opacity-40 blur-3xl" />
        {/* Terceiro blob sutil no centro */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary-100 opacity-20 blur-3xl" />
      </div>

      <div className="bg-white rounded-3xl shadow-card-md border border-gray-100 w-full max-w-sm p-8 relative page-enter">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-1">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center mb-3 shadow-md">
            <TrendingUp className="w-7 h-7 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Gestão Financeira</h1>
          <p className="text-sm text-gray-500">Matheus &amp; Jeniffer</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Campo email */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
              placeholder="seu@email.com"
              autoFocus
              required
              autoComplete="email"
            />
          </div>

          {/* Campo senha */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Senha
            </label>
            <div className="relative">
              <input
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full pl-4 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mensagem de erro */}
          {erro && (
            <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-full bg-red-400 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-white text-[9px] font-bold leading-none">!</span>
              </span>
              <p className="text-sm text-red-600">{erro}</p>
            </div>
          )}

          {/* Botão de submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-3.5 rounded-2xl font-semibold text-sm hover:bg-primary-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm hover:shadow-md mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Entrando…
              </span>
            ) : (
              'Entrar'
            )}
          </button>
        </form>

        {/* Rodapé discreto */}
        <p className="text-center text-[11px] text-gray-300 mt-6 tracking-wide">
          ACESSO RESTRITO
        </p>
      </div>
    </div>
  )
}
