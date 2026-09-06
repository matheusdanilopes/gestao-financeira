'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft, FileDown, FileSpreadsheet, RefreshCw, AlertTriangle,
  Sparkles, Check, FileJson, FileText,
} from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import type { StatusRelatorio } from '@/lib/useRelatorio'
import {
  copiarTexto,
  documentoParaMarkdown,
  exportarRelatorioCsv,
  exportarRelatorioJson,
  exportarRelatorioMarkdown,
  exportarRelatorioPdf,
  type DocumentoRelatorio,
} from '@/lib/relatorioDocumento'

export type { StatusRelatorio } from '@/lib/useRelatorio'

interface RelatorioShellProps {
  titulo: string
  /** Ícone do estado de erro. */
  IconeErro: LucideIcon
  status: StatusRelatorio
  /** Recarga em andamento sobre dados já exibidos — gira o ícone de atualizar. */
  atualizando?: boolean
  onRecarregar: () => void
  /** Monta o documento exportado. `null` enquanto os dados não chegaram. */
  montarDocumento: () => DocumentoRelatorio | null
  /** Seletores de período/escopo — ficam grudados no topo junto do título. */
  filtros?: React.ReactNode
  /** Falhas parciais: o relatório abre, mas parte dos dados não veio. */
  avisos?: string[]
  children: React.ReactNode
}

function BotaoExportar({
  onClick, disabled, ocupado, Icon, children, cor,
}: {
  onClick: () => void
  disabled: boolean
  ocupado: boolean
  Icon: LucideIcon
  children: React.ReactNode
  cor: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-3 rounded-2xl font-semibold text-sm
                  flex items-center justify-center gap-2
                  transition-all duration-150 ease-spring
                  shadow-sm hover:shadow-card-md
                  active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
                  ${cor}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${ocupado ? 'animate-pulse' : ''}`} />
      {children}
    </button>
  )
}

/**
 * Casca comum das telas de relatório: cabeçalho fixo com voltar/atualizar,
 * área de filtros, estados de carregando/erro e as ações de exportação.
 *
 * Cada relatório só precisa entregar o conteúdo e uma função que monta o
 * `DocumentoRelatorio` — PDF e CSV saem iguais em todos eles.
 */
export default function RelatorioShell({
  titulo, IconeErro, status, atualizando = false, onRecarregar, montarDocumento, filtros, avisos, children,
}: RelatorioShellProps) {
  const router = useRouter()
  const [gerando, setGerando] = useState<'pdf' | 'csv' | 'md' | 'json' | null>(null)
  const [erroExport, setErroExport] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function exportar(formato: 'pdf' | 'csv' | 'md' | 'json') {
    if (gerando) return
    const documento = montarDocumento()
    if (!documento) return
    setGerando(formato)
    setErroExport(null)
    try {
      if (formato === 'pdf') await exportarRelatorioPdf(documento)
      else if (formato === 'csv') await exportarRelatorioCsv(documento)
      else if (formato === 'md') exportarRelatorioMarkdown(documento)
      else exportarRelatorioJson(documento)
    } catch (err) {
      console.error('[relatorios] Falha ao exportar:', err)
      setErroExport('Não foi possível gerar o arquivo. Tente novamente.')
    } finally {
      setGerando(null)
    }
  }

  /** Markdown na área de transferência: é o formato que outra IA lê melhor. */
  async function copiarParaIA() {
    const documento = montarDocumento()
    if (!documento) return
    setErroExport(null)
    const ok = await copiarTexto(documentoParaMarkdown(documento))
    if (!ok) {
      setErroExport('O navegador bloqueou a cópia. Baixe o arquivo .md e anexe na conversa com a IA.')
      return
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  const desabilitado = status !== 'ready' || atualizando || gerando !== null

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => router.push('/relatorios')}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors flex-none"
            aria-label="Voltar para Relatórios"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" strokeWidth={2} />
          </button>
          <h1 className="text-xl font-bold text-gray-900 flex-1 min-w-0 truncate tracking-tight">{titulo}</h1>
          <button
            type="button"
            onClick={onRecarregar}
            disabled={status === 'loading' || atualizando}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100
                       transition-colors flex-none disabled:opacity-40"
            aria-label="Atualizar dados do relatório"
          >
            <RefreshCw
              className={`w-4 h-4 text-gray-600 ${status === 'loading' || atualizando ? 'animate-spin' : ''}`}
              strokeWidth={2}
            />
          </button>
        </div>
        {filtros}
      </div>

      <div className="page-content space-y-3">
        {status === 'loading' && (
          <div className="space-y-3 animate-pulse">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white rounded-2xl shadow-card border border-gray-100 p-3.5 space-y-2">
                  <div className="h-2.5 bg-gray-100 rounded-full w-16" />
                  <div className="h-5 bg-gray-100 rounded-full w-24" />
                </div>
              ))}
            </div>
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
                <div className="h-4 bg-gray-100 rounded-full w-32" />
                <div className="h-3 bg-gray-100 rounded-full w-full" />
                <div className="h-16 bg-gray-100 rounded-2xl" />
              </div>
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="bg-white rounded-3xl shadow-card border border-gray-100">
            <EmptyState
              icon={IconeErro}
              title="Não foi possível carregar o relatório"
              description="Verifique sua conexão e tente novamente."
              action={
                <button
                  onClick={onRecarregar}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors"
                >
                  Tentar novamente
                </button>
              }
            />
          </div>
        )}

        {status === 'ready' && avisos && avisos.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-amber-800">
                O relatório está incompleto — parte dos dados não pôde ser carregada:
              </p>
              {avisos.map((aviso, idx) => (
                <p key={idx} className="text-xs text-amber-700">{aviso}</p>
              ))}
            </div>
          </div>
        )}

        {status === 'ready' && children}

        {erroExport && (
          <p className="text-xs text-red-500 text-center" role="alert">{erroExport}</p>
        )}

        <div className="flex gap-2.5 pt-1">
          <BotaoExportar
            onClick={() => exportar('pdf')}
            disabled={desabilitado}
            ocupado={gerando === 'pdf'}
            Icon={FileDown}
            cor="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-400"
          >
            {gerando === 'pdf' ? 'Gerando PDF…' : 'Baixar PDF'}
          </BotaoExportar>
          <BotaoExportar
            onClick={() => exportar('csv')}
            disabled={desabilitado}
            ocupado={gerando === 'csv'}
            Icon={FileSpreadsheet}
            cor="bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-400"
          >
            {gerando === 'csv' ? 'Gerando CSV…' : 'Baixar CSV'}
          </BotaoExportar>
        </div>

        {/* Saídas para levar o relatório a outra IA: Markdown é o formato que
            os modelos leem melhor; JSON serve para processar por código. */}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={copiarParaIA}
            disabled={desabilitado}
            className="flex-1 py-3 rounded-2xl font-semibold text-sm
                       flex items-center justify-center gap-2
                       bg-primary-50 text-primary-700 hover:bg-primary-100
                       border border-primary-100
                       transition-all duration-150 ease-spring active:scale-[0.97]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400"
          >
            {copiado
              ? <><Check className="w-4 h-4 shrink-0" /> Copiado!</>
              : <><Sparkles className="w-4 h-4 shrink-0" /> Copiar para IA</>}
          </button>
          <button
            type="button"
            onClick={() => exportar('md')}
            disabled={desabilitado}
            className="px-4 py-3 rounded-2xl font-semibold text-sm text-gray-600
                       bg-white border border-gray-200 hover:bg-gray-50
                       transition-all duration-150 ease-spring active:scale-[0.97]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-300
                       flex items-center gap-1.5"
            aria-label="Baixar em Markdown"
          >
            <FileText className="w-4 h-4 shrink-0" /> .md
          </button>
          <button
            type="button"
            onClick={() => exportar('json')}
            disabled={desabilitado}
            className="px-4 py-3 rounded-2xl font-semibold text-sm text-gray-600
                       bg-white border border-gray-200 hover:bg-gray-50
                       transition-all duration-150 ease-spring active:scale-[0.97]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-300
                       flex items-center gap-1.5"
            aria-label="Baixar em JSON"
          >
            <FileJson className="w-4 h-4 shrink-0" /> .json
          </button>
        </div>

        <p className="text-[11px] text-gray-400 text-center leading-snug px-2">
          &ldquo;Copiar para IA&rdquo; copia o relatório inteiro em Markdown — cole direto no ChatGPT, Claude ou Gemini
          para pedir análises. O arquivo já vai com a metodologia de cada seção.
        </p>
      </div>
    </div>
  )
}
