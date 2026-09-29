'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Unlink, RefreshCw, Send } from 'lucide-react'

interface EstadoVinculo {
  configurado: boolean
  pendencias: string[]
  migracaoPendente: boolean
  erro?: string | null
  bot: string | null
  vinculado?: boolean
  telegramNome?: string | null
  vinculadoEm?: string | null
  codigoExpiraEm?: string | null
  link?: string | null
}

/**
 * Conteúdo do card "Assessor no Telegram" (Configurações → Conta): gera o
 * link de conexão (t.me/bot?start=CODIGO), mostra o Telegram conectado e
 * permite desconectar.
 */
export default function TelegramVinculo() {
  const [estado, setEstado] = useState<EstadoVinculo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /**
   * `silencioso`: consultas de fundo não mostram erro — ao abrir o Telegram o
   * app vai para segundo plano e a consulta em andamento morre com "Failed to
   * fetch", o que não é uma falha que a pessoa precise ver.
   */
  const carregar = useCallback(async (silencioso = false) => {
    try {
      const res = await fetch('/api/telegram/vinculo', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao carregar')
      setEstado(json)
      setErro(null)
    } catch (e) {
      if (!silencioso) setErro(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  // Enquanto há link pendente, confere se a conexão já foi feita pelo
  // Telegram — a tela vira "conectado" sozinha, inclusive ao voltar para o app.
  useEffect(() => {
    if (!estado?.link || estado.vinculado) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void carregar(true)
    }, 5000)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void carregar(true)
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [estado?.link, estado?.vinculado, carregar])

  async function gerarLink() {
    setOcupado(true)
    setErro(null)
    try {
      const res = await fetch('/api/telegram/vinculo', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao gerar o link')
      setEstado(prev => prev ? { ...prev, ...json } : prev)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gerar o link')
    } finally {
      setOcupado(false)
    }
  }

  async function desvincular() {
    if (!confirm('Desconectar este Telegram? O assessor deixará de responder por lá.')) return
    setOcupado(true)
    setErro(null)
    try {
      const res = await fetch('/api/telegram/vinculo', { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Falha ao desconectar')
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao desconectar')
    } finally {
      setOcupado(false)
    }
  }

  if (carregando) {
    return <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
  }

  if (!estado) {
    return <p className="text-xs px-3.5 py-2.5 rounded-2xl border bg-red-50 border-red-100 text-red-600">{erro}</p>
  }

  if (estado.migracaoPendente) {
    return (
      <p className="text-xs px-3.5 py-2.5 rounded-2xl border bg-amber-50 border-amber-100 text-amber-700 leading-relaxed">
        Falta criar as tabelas do Telegram no banco: rode <code className="font-mono">supabase/migration_telegram.sql</code> no SQL Editor do Supabase.
      </p>
    )
  }

  if (!estado.configurado) {
    return (
      <div className="text-xs px-3.5 py-2.5 rounded-2xl border bg-amber-50 border-amber-100 text-amber-700 leading-relaxed space-y-1.5">
        {estado.erro ? (
          <p>{estado.erro}</p>
        ) : (
          <>
            <p>
              Crie um bot no Telegram com o <strong>@BotFather</strong> (comando <code className="font-mono">/newbot</code>) e
              cadastre o token na Vercel. Faltam as variáveis de ambiente:
            </p>
            <ul className="space-y-0.5 font-mono">
              {estado.pendencias.map(p => <li key={p}>• {p}</li>)}
            </ul>
          </>
        )}
      </div>
    )
  }

  const botUrl = estado.bot ? `https://t.me/${estado.bot}` : null

  return (
    <div className="space-y-3">
      {erro && (
        <p className="text-xs px-3.5 py-2.5 rounded-2xl border bg-red-50 border-red-100 text-red-600">{erro}</p>
      )}
      {estado.erro && (
        <p className="text-xs px-3.5 py-2.5 rounded-2xl border bg-amber-50 border-amber-100 text-amber-700">{estado.erro}</p>
      )}

      {estado.vinculado ? (
        <>
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-sm font-medium bg-green-50 border border-green-100 text-green-700">
            <span className="w-2 h-2 rounded-full shrink-0 bg-green-500" />
            <span className="flex-1">Conectado{estado.telegramNome ? ` a ${estado.telegramNome}` : ''}</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Converse com <strong className="text-gray-600">@{estado.bot}</strong> por texto ou áudio. Perguntas na primeira
            pessoa (&quot;quanto eu gastei?&quot;) usam os seus dados. Envie <em>/nova</em> para mudar de assunto.
          </p>
          <div className="flex gap-2">
            {botUrl && (
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] border border-primary-200"
              >
                <ExternalLink className="w-4 h-4" />
                Abrir conversa
              </a>
            )}
            <button
              onClick={desvincular}
              disabled={ocupado}
              className="flex items-center justify-center gap-2 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50"
            >
              <Unlink className="w-4 h-4" />
              Desconectar
            </button>
          </div>
        </>
      ) : estado.link ? (
        <>
          <p className="text-xs text-gray-500 leading-relaxed">
            Toque em <strong>Abrir no Telegram</strong> e depois em <strong>Iniciar</strong> na conversa com o bot. O link
            vale por 15 minutos e só pode ser usado uma vez.
          </p>
          <div className="flex gap-2">
            <a
              href={estado.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] shadow-sm"
            >
              <Send className="w-4 h-4" />
              Abrir no Telegram
            </a>
            <button
              onClick={gerarLink}
              disabled={ocupado}
              className="flex items-center justify-center gap-2 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50"
              title="Gerar outro link"
            >
              <RefreshCw className={`w-4 h-4 ${ocupado ? 'animate-spin' : ''}`} />
              Novo link
            </button>
          </div>
          <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Aguardando você tocar em Iniciar no Telegram…
          </p>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500 leading-relaxed">
            Converse com o assessor financeiro pelo Telegram, por texto ou áudio: consulte gastos, faturas e contas a
            vencer, ou lance pagamentos e despesas — sempre com um toque em <strong>Confirmar</strong> antes de gravar.
          </p>
          <button
            onClick={gerarLink}
            disabled={ocupado}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50 shadow-sm"
          >
            <Send className="w-4 h-4" />
            {ocupado ? 'Gerando…' : 'Conectar Telegram'}
          </button>
        </>
      )}
    </div>
  )
}
