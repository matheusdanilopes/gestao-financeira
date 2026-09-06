'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Search, FileSearch } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import {
  GRUPOS_RELATORIOS,
  RELATORIOS_DISPONIVEIS,
  type RelatorioDisponivel,
} from '@/lib/relatoriosItems'

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function CardRelatorio({ relatorio }: { relatorio: RelatorioDisponivel }) {
  const { href, titulo, descricao, Icon, iconBg, iconColor, periodo, responde } = relatorio

  return (
    <Link
      href={href}
      className="card-3d flex items-start gap-4 bg-white rounded-3xl shadow-card p-4
                 border border-gray-100 transition-colors
                 hover:border-gray-200 hover:shadow-card-hover
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <div className={`w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
        <Icon className={`w-6 h-6 ${iconColor}`} strokeWidth={1.8} />
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900 text-sm tracking-tight">{titulo}</p>
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-lg px-1.5 py-0.5">
            {periodo}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-snug">{descricao}</p>
        <ul className="flex flex-wrap gap-1">
          {responde.map(pergunta => (
            <li
              key={pergunta}
              className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-1.5 py-0.5"
            >
              {pergunta}
            </li>
          ))}
        </ul>
      </div>

      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-4" />
    </Link>
  )
}

export default function RelatoriosPage() {
  const [termo, setTermo] = useState('')

  const filtrados = useMemo(() => {
    const alvo = normalizar(termo.trim())
    if (!alvo) return RELATORIOS_DISPONIVEIS
    return RELATORIOS_DISPONIVEIS.filter(r =>
      normalizar([r.titulo, r.descricao, r.periodo, ...r.responde].join(' ')).includes(alvo),
    )
  }, [termo])

  const grupos = useMemo(
    () =>
      GRUPOS_RELATORIOS.map(grupo => ({
        ...grupo,
        itens: filtrados.filter(r => r.grupo === grupo.chave),
      })).filter(g => g.itens.length > 0),
    [filtrados],
  )

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight mb-3">Relatórios</h1>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={termo}
            onChange={e => setTermo(e.target.value)}
            placeholder="Buscar por relatório ou pergunta…"
            aria-label="Buscar relatório"
            className="w-full pl-10 pr-3 py-2.5 rounded-2xl bg-white border border-gray-100 shadow-card
                       text-sm text-gray-700 placeholder:text-gray-400
                       focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>
      </div>

      <div className="page-content mt-4 space-y-5">
        {grupos.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-card border border-gray-100">
            <EmptyState
              icon={FileSearch}
              title="Nenhum relatório encontrado"
              description={`Nada corresponde a "${termo}". Tente buscar por "cartão", "categoria" ou "ano".`}
            />
          </div>
        ) : (
          grupos.map(grupo => (
            <section key={grupo.chave} className="space-y-2">
              <div className="px-1">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">{grupo.titulo}</h2>
                <p className="text-[11px] text-gray-400 leading-snug">{grupo.descricao}</p>
              </div>
              {grupo.itens.map(relatorio => (
                <CardRelatorio key={relatorio.href} relatorio={relatorio} />
              ))}
            </section>
          ))
        )}

        <p className="text-[11px] text-gray-400 leading-snug px-1 pb-1">
          Todo relatório pode ser baixado em PDF ou CSV e copiado em Markdown para colar em uma IA — o botão
          &ldquo;Copiar para IA&rdquo; fica no fim de cada tela.
        </p>
      </div>
    </div>
  )
}
