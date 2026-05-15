'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ShoppingBasket, Plus, Minus, X, Check, Trash2, ChevronDown } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { useListaMercado, type ItemMercado } from '@/lib/useListaMercado'
import { formatBRL } from '@/lib/logger'

// ── Bottom sheet de preço ─────────────────────────────────────────────────

function BottomSheetPreco({
  item,
  onClose,
  onConfirmar,
}: {
  item: ItemMercado
  onClose: () => void
  onConfirmar: (preco: number | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [valor, setValor] = useState(item.preco_unit != null ? String(item.preco_unit) : '')

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150)
    return () => clearTimeout(t)
  }, [])

  function handleConfirmar() {
    const num = valor.replace(',', '.').trim()
    onConfirmar(num ? parseFloat(num) : null)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleConfirmar()
    if (e.key === 'Escape') onClose()
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-8">
          {/* Handle */}
          <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />

          <p className="text-xs text-gray-500 mb-1 font-medium">Preço unitário de</p>
          <p className="text-base font-semibold text-gray-900 mb-4 truncate">{item.nome}</p>

          <div className="relative mb-4">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">R$</span>
            <input
              ref={inputRef}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={valor}
              onChange={e => setValor(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="0,00"
              className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-900
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          <div className="flex gap-3">
            {item.preco_unit != null && (
              <button
                type="button"
                onClick={() => { onConfirmar(null); onClose() }}
                className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500
                           hover:bg-gray-50 transition-colors"
              >
                Remover
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600
                         hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              className="flex-1 py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold
                         hover:bg-primary-700 transition-colors"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Linha de item ─────────────────────────────────────────────────────────

function ItemRow({
  item,
  onToggle,
  onAlterarQtd,
  onEditarNome,
  onExcluir,
  onAbrirPreco,
}: {
  item: ItemMercado
  onToggle: (id: string) => void
  onAlterarQtd: (id: string, delta: number) => void
  onEditarNome: (id: string, nome: string) => void
  onExcluir: (id: string) => void
  onAbrirPreco: (item: ItemMercado) => void
}) {
  const [editandoNome, setEditandoNome] = useState(false)
  const [nomeLocal, setNomeLocal] = useState(item.nome)
  const inputNomeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setNomeLocal(item.nome) }, [item.nome])

  function ativarEdicao() {
    setEditandoNome(true)
    setTimeout(() => inputNomeRef.current?.focus(), 50)
  }

  function salvarNome() {
    setEditandoNome(false)
    if (nomeLocal.trim() && nomeLocal.trim() !== item.nome) {
      onEditarNome(item.id, nomeLocal.trim())
    } else {
      setNomeLocal(item.nome)
    }
  }

  const subtotal = item.quantidade * (item.preco_unit ?? 0)

  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)} disabled={editandoNome}>
      <div
        className={`flex items-center gap-3 px-4 py-3.5 bg-white border-b border-gray-50
                    transition-opacity duration-200 ${item.comprado ? 'opacity-50' : ''}`}
      >
        {/* Checkbox */}
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-label={item.comprado ? 'Desmarcar' : 'Marcar como comprado'}
          className={`flex-none w-6 h-6 rounded-full border-2 flex items-center justify-center
                      transition-all duration-150 active:scale-90
                      ${item.comprado
                        ? 'bg-green-500 border-green-500'
                        : 'border-gray-300 hover:border-primary-400'
                      }`}
        >
          {item.comprado && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </button>

        {/* Nome */}
        <div className="flex-1 min-w-0">
          {editandoNome ? (
            <input
              ref={inputNomeRef}
              type="text"
              value={nomeLocal}
              onChange={e => setNomeLocal(e.target.value)}
              onBlur={salvarNome}
              onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } if (e.key === 'Escape') { setNomeLocal(item.nome); setEditandoNome(false) } }}
              className="w-full text-sm font-medium text-gray-900 bg-transparent border-b border-primary-400
                         focus:outline-none py-0.5"
            />
          ) : (
            <button
              type="button"
              onClick={ativarEdicao}
              className={`text-left text-sm font-medium leading-snug truncate block w-full
                          ${item.comprado ? 'line-through text-gray-400' : 'text-gray-900'}`}
            >
              {item.nome}
            </button>
          )}
        </div>

        {/* Controles de quantidade */}
        <div className="flex items-center gap-1.5 flex-none">
          <button
            type="button"
            onClick={() => onAlterarQtd(item.id, -1)}
            disabled={item.quantidade <= 1}
            className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center
                       text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors active:scale-90"
            aria-label="Diminuir quantidade"
          >
            <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
          <span className="text-sm font-semibold text-gray-900 w-6 text-center tabular-nums">
            {item.quantidade}
          </span>
          <button
            type="button"
            onClick={() => onAlterarQtd(item.id, +1)}
            className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center
                       text-gray-600 hover:bg-gray-200 transition-colors active:scale-90"
            aria-label="Aumentar quantidade"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        </div>

        {/* Preço / subtotal */}
        <button
          type="button"
          onClick={() => onAbrirPreco(item)}
          className="flex-none text-right min-w-[60px]"
          aria-label="Definir preço"
        >
          {item.preco_unit != null ? (
            <div>
              <p className="text-xs text-gray-400 leading-none tabular-nums">
                {formatBRL(item.preco_unit)}/un
              </p>
              <p className="text-sm font-semibold text-gray-900 tabular-nums mt-0.5">
                {formatBRL(subtotal)}
              </p>
            </div>
          ) : (
            <span className="text-xs text-primary-500 font-medium">+ preço</span>
          )}
        </button>
      </div>
    </SwipeableItem>
  )
}

// ── Rodapé com total ──────────────────────────────────────────────────────

function TotalRodape({
  total,
  compradosCount,
  onLimpar,
}: {
  total: number
  compradosCount: number
  onLimpar: () => void
}) {
  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-2 pointer-events-none">
      <div className="max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-float border border-gray-100 px-4 py-3 flex items-center gap-4 pointer-events-auto">
          {compradosCount > 0 && (
            <button
              type="button"
              onClick={onLimpar}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-500
                         hover:text-red-600 transition-colors py-1"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
              Limpar ({compradosCount})
            </button>
          )}
          <div className="flex-1 flex items-center justify-end gap-2">
            <span className="text-xs text-gray-500 font-medium">Total</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">{formatBRL(total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────

export default function ListaMercadoPage() {
  const { itens, total, adicionar, alterarQuantidade, definirPreco, editarNome, toggleComprado, excluir, limparComprados } = useListaMercado()

  const [novoNome, setNovoNome] = useState('')
  const [itemPreco, setItemPreco] = useState<ItemMercado | null>(null)
  const inputAddRef = useRef<HTMLInputElement>(null)

  const comprados = itens.filter(i => i.comprado)
  const pendentes = itens.filter(i => !i.comprado)

  async function handleAdicionar(e: React.FormEvent) {
    e.preventDefault()
    if (!novoNome.trim()) return
    await adicionar(novoNome)
    setNovoNome('')
    inputAddRef.current?.focus()
  }

  // Wrappers que passam snapshot do estado atual (evita closure stale)
  const handleToggle = useCallback((id: string) => toggleComprado(id, itens), [toggleComprado, itens])
  const handleQtd    = useCallback((id: string, d: number) => alterarQuantidade(id, d, itens), [alterarQuantidade, itens])
  const handleLimpar = useCallback(() => limparComprados(itens), [limparComprados, itens])

  return (
    <div className="min-h-screen pb-40">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
            <ShoppingBasket className="w-5 h-5 text-green-600" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none">Lista de Mercado</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {pendentes.length} {pendentes.length === 1 ? 'item pendente' : 'itens pendentes'}
              {comprados.length > 0 && ` · ${comprados.length} comprado${comprados.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Input de adição */}
        <form onSubmit={handleAdicionar} className="flex gap-2">
          <input
            ref={inputAddRef}
            type="text"
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            placeholder="Adicionar item…"
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                       placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!novoNome.trim()}
            aria-label="Adicionar item"
            className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white
                       disabled:opacity-40 hover:bg-primary-700 transition-colors active:scale-95
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <Plus className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </form>
      </div>

      {/* Lista */}
      {itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <ShoppingBasket className="w-8 h-8 text-green-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-1">Lista vazia</p>
          <p className="text-xs text-gray-400">
            Adicione os itens que precisa comprar
          </p>
        </div>
      ) : (
        <div className="bg-white mt-2 rounded-2xl mx-4 overflow-hidden shadow-sm border border-gray-100">
          {/* Pendentes */}
          {pendentes.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onToggle={handleToggle}
              onAlterarQtd={handleQtd}
              onEditarNome={editarNome}
              onExcluir={excluir}
              onAbrirPreco={setItemPreco}
            />
          ))}

          {/* Comprados — seção separada */}
          {comprados.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-t border-b border-gray-100">
                <Check className="w-3.5 h-3.5 text-green-500" strokeWidth={2.5} />
                <span className="text-xs font-semibold text-gray-500">
                  Comprados ({comprados.length})
                </span>
              </div>
              {comprados.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={handleToggle}
                  onAlterarQtd={handleQtd}
                  onEditarNome={editarNome}
                  onExcluir={excluir}
                  onAbrirPreco={setItemPreco}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Bottom sheet de preço */}
      {itemPreco && (
        <BottomSheetPreco
          item={itemPreco}
          onClose={() => setItemPreco(null)}
          onConfirmar={preco => definirPreco(itemPreco.id, preco)}
        />
      )}

      {/* Rodapé com total */}
      <TotalRodape
        total={total}
        compradosCount={comprados.length}
        onLimpar={handleLimpar}
      />
    </div>
  )
}
