'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, ExternalLink, Unlink, RefreshCw } from 'lucide-react'

interface EstadoVinculo {
  configurado: boolean
  pendencias: string[]
  migracaoPendente: boolean
  numero: string | null
  vinculado?: boolean
  telefone?: string | null
  vinculadoEm?: string | null
  codigo?: string | null
  codigoExpiraEm?: string | null
  link?: string | null
}

function formatarNumero(n: string): string {
  if (n.startsWith('55') && (n.length === 12 || n.length === 13)) {
    const ddd = n.slice(2, 4)
    const resto = n.slice(4)
    return `+55 (${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`
  }
  return `+${n}`
}

/**
 * Conteúdo do card "Assessor no WhatsApp" (Configurações → Conta): gera o
 * código de vínculo, mostra o número conectado e permite desconectar.
 */
export default function WhatsAppVinculo() {
  const [estado, setEstado] = useState<EstadoVinculo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  /**
   * `silencioso`: consultas de fundo não mostram erro. Ao tocar em "Enviar
   * pelo WhatsApp" o app vai para segundo plano, o sistema suspende a página
   * e a consulta em andamento morre com "Failed to fetch" — isso não é uma
   * falha que a pessoa precise ver.
   */
  const carregar = useCallback(async (silencioso = false) => {
    try {
      const res = await fetch('/api/whatsapp/vinculo', { cache: 'no-store' })
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

  // Enquanto há código pendente, confere de tempos em tempos se o vínculo
  // já foi feito pelo WhatsApp — a tela vira "conectado" sozinha. Também
  // confere ao voltar para o app, que é quando a pessoa espera ver o resultado.
  useEffect(() => {
    if (!estado?.codigo || estado.vinculado) return
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
  }, [estado?.codigo, estado?.vinculado, carregar])

  async function gerarCodigo() {
    setOcupado(true)
    setErro(null)
    try {
      const res = await fetch('/api/whatsapp/vinculo', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao gerar código')
      setEstado(prev => prev ? { ...prev, ...json } : prev)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gerar código')
    } finally {
      setOcupado(false)
    }
  }

  async function desvincular() {
    if (!confirm('Desconectar este número? O assessor deixará de responder por lá.')) return
    setOcupado(true)
    setErro(null)
    try {
      const res = await fetch('/api/whatsapp/vinculo', { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Falha ao desvincular')
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao desvincular')
    } finally {
      setOcupado(false)
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* clipboard indisponível */ }
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
        Falta criar as tabelas do WhatsApp no banco: rode <code className="font-mono">supabase/migration_whatsapp.sql</code> no SQL Editor do Supabase.
      </p>
    )
  }

  if (!estado.configurado) {
    return (
      <div className="text-xs px-3.5 py-2.5 rounded-2xl border bg-amber-50 border-amber-100 text-amber-700 leading-relaxed">
        O servidor ainda não está conectado à WhatsApp Cloud API. Configure as variáveis de ambiente:
        <ul className="mt-1.5 space-y-0.5 font-mono">
          {estado.pendencias.map(p => <li key={p}>• {p}</li>)}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {erro && (
        <p className="text-xs px-3.5 py-2.5 rounded-2xl border bg-red-50 border-red-100 text-red-600">{erro}</p>
      )}

      {estado.vinculado ? (
        <>
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-sm font-medium bg-green-50 border border-green-100 text-green-700">
            <span className="w-2 h-2 rounded-full shrink-0 bg-green-500" />
            <span className="flex-1">Conectado a {estado.telefone ?? 'um número'}</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Mande mensagens de texto ou áudio para{' '}
            {estado.numero ? <strong className="text-gray-600">{formatarNumero(estado.numero)}</strong> : 'o número do assessor'}.
            Perguntas na primeira pessoa (&quot;quanto eu gastei?&quot;) usam os seus dados. Envie <em>nova conversa</em> para
            mudar de assunto.
          </p>
          <div className="flex gap-2">
            {estado.numero && (
              <a
                href={`https://wa.me/${estado.numero}`}
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
      ) : estado.codigo ? (
        <>
          <p className="text-xs text-gray-500 leading-relaxed">
            Envie a mensagem abaixo pelo WhatsApp{estado.numero ? <> para <strong>{formatarNumero(estado.numero)}</strong></> : ''}.
            O código vale por 15 minutos e só pode ser usado uma vez.
          </p>
          <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl bg-gray-50 border border-gray-200">
            <code className="flex-1 font-mono text-base font-semibold tracking-wider text-gray-800">
              vincular {estado.codigo}
            </code>
            <button
              onClick={() => copiar(`vincular ${estado.codigo}`)}
              className="p-2 rounded-xl hover:bg-gray-200 text-gray-500 transition-colors"
              title="Copiar"
            >
              {copiado ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            {estado.link && (
              <a
                href={estado.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] shadow-sm"
              >
                <ExternalLink className="w-4 h-4" />
                Enviar pelo WhatsApp
              </a>
            )}
            <button
              onClick={gerarCodigo}
              disabled={ocupado}
              className="flex items-center justify-center gap-2 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50"
              title="Gerar outro código"
            >
              <RefreshCw className={`w-4 h-4 ${ocupado ? 'animate-spin' : ''}`} />
              Novo código
            </button>
          </div>
          <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Aguardando a mensagem chegar…
          </p>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500 leading-relaxed">
            Converse com o assessor financeiro pelo WhatsApp, por texto ou áudio: consulte gastos, faturas e contas a
            vencer, ou lance pagamentos e despesas (sempre com a sua confirmação). Para conectar o seu número, gere um
            código e envie pelo WhatsApp.
          </p>
          <button
            onClick={gerarCodigo}
            disabled={ocupado}
            className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50 shadow-sm"
          >
            {ocupado ? 'Gerando…' : 'Gerar código de conexão'}
          </button>
        </>
      )}
    </div>
  )
}
