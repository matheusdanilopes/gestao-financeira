'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ShoppingBasket, History, ChevronDown, ChevronUp,
  Calendar, Package, RefreshCw, Inbox, Filter,
} from 'lucide-react'
import { SwipeableItem } from '@/components/SwipeableItem'
import { useHistoricoCompras, type RegistroCompra } from '@/lib/useHistoricoCompras'
import { formatBRL } from '@/lib/logger'
import { format, subDays, startOfMonth, startOfYear, isAfter, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Filtros de período ────────────────────────────────────────────────────────

type Periodo = '7d' | '30d' | 'mes' | 'ano' | 'tudo'

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: '7d',   label: 'Últimos 7 dias' },
  { id: '30d',  label: 'Últimos 30 dias' },
  { id: 'mes',  label: 'Este mês' },
  { id: 'ano',  label: 'Este ano' },
  { id: 'tudo', label: 'Tudo' },
]

function filtrarPorPeriodo(historico: RegistroCompra[], periodo: Periodo): RegistroCompra[] {
  if (periodo === 'tudo') return historico
  const agora = new Date()
  let desde: Date
  if (periodo === '7d')  desde = subDays(agora, 7)
  else if (periodo === '30d') desde = subDays(agora, 30)
  else if (periodo === 'mes') desde = startOfMonth(agora)
  else desde = startOfYear(agora)
  return historico.filter(r => isAfter(parseISO(r.data_hora), desde))
}

// ── Card de registro ──────────────────────────────────────────────────────────

function CardRegistro({ registro, onExcluir }: { registro: RegistroCompra; onExcluir: (id: string) => void }) {
  const [expandido, setExpandido] = useState(false)

  const dataFormatada = format(parseISO(registro.data_hora), "dd 'de' MMMM", { locale: ptBR })
  const horaFormatada = format(parseISO(registro.data_hora), 'HH:mm', { locale: ptBR })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <SwipeableItem onDelete={() => onExcluir(registro.id)} requireConfirmation>
      <div>
      {/* Cabeçalho do card */}
      <button
        type="button"
        onClick={() => setExpandido(v => !v)}
        className="w-full flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition-colors text-left active:bg-gray-50"
      >
        {/* Ícone */}
        <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center flex-none">
          <ShoppingBasket className="w-5 h-5 text-emerald-600" strokeWidth={1.8} />
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-gray-900">{dataFormatada}</p>
            <span className="text-[11px] text-gray-400 font-medium">{horaFormatada}</span>
          </div>
          <div className="flex items-center gap-2.5 mt-0.5">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Package className="w-3 h-3" strokeWidth={2} />
              {registro.itens_count} {registro.itens_count === 1 ? 'item' : 'itens'}
            </span>
            {registro.usuario && (
              <span className="text-[10px] text-gray-400 truncate">{registro.usuario.split('@')[0]}</span>
            )}
          </div>
        </div>

        {/* Total + expand */}
        <div className="flex items-center gap-2 flex-none">
          <p className="text-base font-bold text-gray-900 num">
            {formatBRL(registro.valor_total)}
          </p>
          {expandido
            ? <ChevronUp className="w-4 h-4 text-gray-400 flex-none" strokeWidth={2} />
            : <ChevronDown className="w-4 h-4 text-gray-400 flex-none" strokeWidth={2} />
          }
        </div>
      </button>

      {/* Detalhes expandidos */}
      {expandido && registro.itens.length > 0 && (
        <div className="border-t border-gray-50 divide-y divide-gray-50">
          {registro.itens.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm text-gray-800 font-semibold truncate">{item.nome}</p>
                <p className="text-[11px] text-gray-400 num">
                  {item.quantidade}× {item.preco_unit != null ? formatBRL(item.preco_unit) : 'sem preço'}
                </p>
              </div>
              {item.preco_unit != null && (
                <p className="text-sm font-bold text-gray-700 num flex-none">
                  {formatBRL(item.quantidade * item.preco_unit)}
                </p>
              )}
            </div>
          ))}

          {/* Subtotal dos itens */}
          <div className="flex items-center justify-between px-4 py-3.5 bg-emerald-50 border-t border-emerald-100">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Total pago</span>
            <span className="text-base font-bold text-emerald-700 num">
              {formatBRL(registro.valor_total)}
            </span>
          </div>
        </div>
      )}
      </div>
      </SwipeableItem>
    </div>
  )
}

// ── Agrupamento por mês ───────────────────────────────────────────────────────

function agruparPorMes(registros: RegistroCompra[]): Map<string, RegistroCompra[]> {
  const grupos = new Map<string, RegistroCompra[]>()
  for (const r of registros) {
    const chave = format(parseISO(r.data_hora), 'MMMM yyyy', { locale: ptBR })
    if (!grupos.has(chave)) grupos.set(chave, [])
    grupos.get(chave)!.push(r)
  }
  return grupos
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function HistoricoComprasPage() {
  const router = useRouter()
  const { historico, loading, error, buscar, excluir } = useHistoricoCompras()
  const [periodo, setPeriodo] = useState<Periodo>('30d')
  const [filtroAberto, setFiltroAberto] = useState(false)

  useEffect(() => {
    buscar()
  }, [buscar])

  const handleRefresh = useCallback(() => {
    buscar()
  }, [buscar])

  const filtrado = filtrarPorPeriodo(historico, periodo)
  const grupos = agruparPorMes(filtrado)
  const totalPeriodo = filtrado.reduce((s, r) => s + r.valor_total, 0)
  const periodoLabel = PERIODOS.find(p => p.id === periodo)?.label ?? ''

  return (
    <div className="min-h-screen pb-24 page-enter">
      {/* Header */}
      <div className="sticky top-0 z-10 sticky-header border-b border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors flex-none"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" strokeWidth={2} />
          </button>

          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center flex-none">
              <History className="w-4 h-4 text-green-600" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-gray-900 leading-none">Histórico de Compras</h1>
              {filtrado.length > 0 && !loading && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {filtrado.length} {filtrado.length === 1 ? 'compra' : 'compras'} · {formatBRL(totalPeriodo)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-none">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setFiltroAberto(v => !v)}
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl transition-colors
                          ${filtroAberto ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Filter className="w-3.5 h-3.5" strokeWidth={2} />
              {periodoLabel}
            </button>
          </div>
        </div>

        {/* Filtro de período */}
        {filtroAberto && (
          <div className="mt-3 flex flex-wrap gap-2">
            {PERIODOS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setPeriodo(p.id); setFiltroAberto(false) }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors
                            ${periodo === p.id
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conteúdo */}
      <div className="px-4 py-4">
        {loading && historico.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-gray-300 animate-spin" />
            </div>
            <p className="text-sm text-gray-400">Carregando histórico…</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 gap-4 text-center px-8">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-red-300" />
            </div>
            <p className="text-sm text-red-500 font-medium leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs text-primary-600 font-semibold px-4 py-2.5 rounded-xl bg-primary-50 hover:bg-primary-100 transition-colors active:scale-[0.97]"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && filtrado.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-8 gap-4">
            <div className="w-16 h-16 rounded-3xl bg-gray-50 flex items-center justify-center">
              <Inbox className="w-7 h-7 text-gray-200" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Nenhuma compra encontrada</p>
              <p className="text-xs text-gray-400 leading-relaxed max-w-[220px] mx-auto">
                {periodo === 'tudo'
                  ? 'Finalize uma compra na lista de mercado para registrá-la aqui.'
                  : `Sem compras no período selecionado. Tente um período mais amplo.`
                }
              </p>
            </div>
            {periodo !== 'tudo' && (
              <button
                type="button"
                onClick={() => setPeriodo('tudo')}
                className="text-xs text-primary-600 font-semibold px-4 py-2.5 rounded-xl bg-primary-50 hover:bg-primary-100 transition-colors active:scale-[0.97]"
              >
                Ver todas as compras
              </button>
            )}
          </div>
        )}

        {/* Timeline por mês */}
        {!error && Array.from(grupos.entries()).map(([mes, registros]) => (
          <div key={mes} className="mb-6">
            {/* Label do mês */}
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-3.5 h-3.5 text-gray-400 flex-none" strokeWidth={2} />
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{mes}</p>
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-500 font-bold num">
                {formatBRL(registros.reduce((s, r) => s + r.valor_total, 0))}
              </span>
            </div>

            {/* Cards do mês */}
            <div className="flex flex-col gap-3">
              {registros.map(r => (
                <CardRegistro key={r.id} registro={r} onExcluir={excluir} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
