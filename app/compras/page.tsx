'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ChevronLeft, ChevronRight, Pencil, Trash2, X, ShoppingBag } from 'lucide-react'
import { addMonths, subMonths, format, startOfMonth, isToday, isYesterday, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import BottomNav from '@/components/BottomNav'
import { log, numericOnly } from '@/lib/logger'
import { useMes } from '@/components/MesProvider'

const CATEGORIAS = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet', 'Outros',
]

const CATEGORIA_CORES: Record<string, string> = {
  Alimentação: 'bg-orange-100 text-orange-700',
  Mercado:     'bg-green-100 text-green-700',
  Transporte:  'bg-sky-100 text-sky-700',
  Saúde:       'bg-red-100 text-red-700',
  Lazer:       'bg-purple-100 text-purple-700',
  Educação:    'bg-indigo-100 text-indigo-700',
  Moradia:     'bg-yellow-100 text-yellow-800',
  Vestuário:   'bg-pink-100 text-pink-700',
  Tecnologia:  'bg-cyan-100 text-cyan-700',
  Serviços:    'bg-teal-100 text-teal-700',
  Viagem:      'bg-blue-100 text-blue-700',
  Pet:         'bg-lime-100 text-lime-700',
  Outros:      'bg-gray-100 text-gray-600',
}

type Compra = {
  hash_linha: string
  data_compra: string | null
  data: string | null
  descricao: string
  valor: number
  responsavel: string
  parcela_atual: number | null
  total_parcelas: number | null
  categoria: string | null
}

type FormEditar = {
  descricao: string
  valor: string
  responsavel: string
  categoria: string
  data_compra: string
}

function dataEfetiva(c: Compra): string {
  return ((c.data_compra || c.data || '')).toString().substring(0, 10)
}

function formatarCabecalhoData(dateKey: string): string {
  if (!dateKey || dateKey.length < 10) return dateKey
  try {
    const d = parseISO(dateKey)
    if (isToday(d)) return 'Hoje'
    if (isYesterday(d)) return 'Ontem'
    return format(d, "EEEE',' dd 'de' MMMM", { locale: ptBR })
  } catch {
    return dateKey
  }
}

function dataParaInput(dataStr: string | null): string {
  if (!dataStr) return format(new Date(), 'yyyy-MM-dd')
  return dataStr.toString().substring(0, 10)
}

function Avatar({ responsavel }: { responsavel: string }) {
  if (responsavel === 'Matheus')
    return <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">M</span>
  if (responsavel === 'Jeniffer')
    return <span className="flex-shrink-0 w-7 h-7 rounded-full bg-pink-100 text-pink-700 text-xs font-bold flex items-center justify-center">J</span>
  return <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center">?</span>
}

function CategoriaBadge({ categoria }: { categoria: string | null }) {
  if (!categoria) return null
  const cor = CATEGORIA_CORES[categoria] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cor}`}>
      {categoria}
    </span>
  )
}

export default function ComprasPage() {
  const { mesAtual: mesGlobal, setMesAtual } = useMes()
  const mesAtual = addMonths(mesGlobal, 1)
  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM')

  const [compras, setCompras] = useState<Compra[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroDia, setFiltroDia] = useState('')

  const [modalEditar, setModalEditar] = useState<Compra | null>(null)
  const [modalExcluir, setModalExcluir] = useState<Compra | null>(null)
  const [formEditar, setFormEditar] = useState<FormEditar>({
    descricao: '', valor: '', responsavel: 'Matheus', categoria: '', data_compra: '',
  })
  const [salvando, setSalvando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  const mesAtualKey = format(startOfMonth(mesAtual), 'yyyy-MM')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregarCompras() }, [mesAtualKey])

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  async function carregarCompras() {
    setLoading(true)
    const mesRef = format(startOfMonth(mesAtual), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', mesRef)
      .order('data', { ascending: false })
    setCompras(data || [])
    setLoading(false)
  }

  function abrirEditar(c: Compra) {
    setFormEditar({
      descricao: c.descricao,
      valor: String(c.valor),
      responsavel: c.responsavel,
      categoria: c.categoria || '',
      data_compra: dataParaInput(c.data_compra || c.data),
    })
    setModalEditar(c)
  }

  async function salvarEdicao() {
    if (!modalEditar) return
    const valor = parseFloat(formEditar.valor.replace(',', '.'))
    if (!formEditar.descricao.trim() || isNaN(valor) || valor <= 0) return

    setSalvando(true)
    const { error } = await supabase
      .from('transacoes_nubank')
      .update({
        descricao: formEditar.descricao.trim(),
        valor,
        responsavel: formEditar.responsavel,
        categoria: formEditar.categoria || null,
        data_compra: formEditar.data_compra,
      })
      .eq('hash_linha', modalEditar.hash_linha)

    setSalvando(false)
    if (error) { showToast('Erro ao salvar', 'erro'); return }

    log('editar', 'transacoes_nubank',
      `Editado: ${formEditar.descricao.trim()} — R$ ${valor.toFixed(2)} (${formEditar.responsavel})`,
      valor,
      modalEditar.valor
    )
    showToast('Compra atualizada!')
    setModalEditar(null)
    carregarCompras()
  }

  async function confirmarExclusao() {
    if (!modalExcluir) return
    setSalvando(true)
    const { error } = await supabase
      .from('transacoes_nubank')
      .delete()
      .eq('hash_linha', modalExcluir.hash_linha)

    setSalvando(false)
    if (error) { showToast('Erro ao excluir', 'erro'); return }

    log('excluir', 'transacoes_nubank',
      `Excluído: ${modalExcluir.descricao} — R$ ${modalExcluir.valor.toFixed(2)} (${modalExcluir.responsavel})`,
      modalExcluir.valor
    )
    showToast('Compra excluída')
    setModalExcluir(null)
    carregarCompras()
  }

  const filtrosAtivos = !!filtroResponsavel || !!filtroDescricao || !!filtroValorMin || !!filtroDia

  function limparFiltros() {
    setFiltroResponsavel('')
    setFiltroDescricao('')
    setFiltroValorMin('')
    setFiltroDia('')
  }

  const comprasFiltradas = useMemo(() => {
    return compras.filter((c) => {
      const dataStr = dataEfetiva(c)
      const diaCompra = dataStr ? Number(dataStr.substring(8, 10)) : null
      return (
        (!filtroResponsavel || c.responsavel === filtroResponsavel) &&
        (!filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())) &&
        (!filtroValorMin || c.valor >= Number(filtroValorMin)) &&
        (!filtroDia || diaCompra === Number(filtroDia))
      )
    })
  }, [compras, filtroResponsavel, filtroDescricao, filtroValorMin, filtroDia])

  const grupos = useMemo(() => {
    const map = new Map<string, Compra[]>()
    for (const c of comprasFiltradas) {
      const key = dataEfetiva(c) || 'sem-data'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [comprasFiltradas])

  const total = useMemo(() => comprasFiltradas.reduce((acc, c) => acc + c.valor, 0), [comprasFiltradas])
  const totalMatheus = useMemo(() => comprasFiltradas.filter(c => c.responsavel === 'Matheus').reduce((acc, c) => acc + c.valor, 0), [comprasFiltradas])
  const totalJeniffer = useMemo(() => comprasFiltradas.filter(c => c.responsavel === 'Jeniffer').reduce((acc, c) => acc + c.valor, 0), [comprasFiltradas])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg ${
          toast.tipo === 'ok' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <h1 className="text-2xl font-bold mb-4">Compras do Cartão</h1>

      {/* Navegação de mês */}
      <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-4">
        <button
          onClick={() => setMesAtual(subMonths(mesGlobal, 1))}
          className="p-2 hover:bg-gray-100 rounded-full transition"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div className="text-center flex-1">
          <span className="text-lg font-semibold capitalize">
            {format(mesAtual, 'MMMM yyyy', { locale: ptBR })}
          </span>
          {!isMesAtual && (
            <div>
              <button
                onClick={() => setMesAtual(new Date())}
                className="text-xs text-blue-500 hover:underline"
              >
                Voltar ao mês atual
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => setMesAtual(addMonths(mesGlobal, 1))}
          className="p-2 hover:bg-gray-100 rounded-full transition"
        >
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Filtro de responsável como pills */}
      <div className="flex gap-2 mb-3">
        {(['', 'Matheus', 'Jeniffer'] as const).map((r) => {
          const label = r === '' ? 'Todos' : r
          const isActive = filtroResponsavel === r
          const activeStyle = r === 'Matheus'
            ? 'bg-blue-600 text-white'
            : r === 'Jeniffer'
              ? 'bg-pink-500 text-white'
              : 'bg-gray-800 text-white'
          return (
            <button
              key={r}
              onClick={() => setFiltroResponsavel(r)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition ${
                isActive ? activeStyle : 'bg-white border border-gray-200 text-gray-500'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Filtros secundários */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-3 grid grid-cols-2 gap-2">
        <input
          type="text"
          className="bg-gray-50 rounded-lg p-2 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="Buscar por descrição…"
          value={filtroDescricao}
          onChange={(e) => setFiltroDescricao(e.target.value)}
        />
        <input
          type="text"
          inputMode="decimal"
          className="bg-gray-50 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="Valor mínimo"
          value={filtroValorMin}
          onChange={(e) => setFiltroValorMin(numericOnly(e.target.value))}
        />
        <input
          type="number"
          min="1"
          max="31"
          className="bg-gray-50 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="Dia"
          value={filtroDia}
          onChange={(e) => setFiltroDia(e.target.value)}
        />
        {filtrosAtivos && (
          <button onClick={limparFiltros} className="col-span-2 text-sm text-red-500 hover:text-red-700 py-1 font-medium">
            Limpar filtros
          </button>
        )}
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-[11px] text-gray-400 mb-0.5">Total</p>
          <p className="text-base font-bold text-gray-800">R$ {total.toFixed(2)}</p>
          <p className="text-[10px] text-gray-400">{comprasFiltradas.length} compras</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-3 text-center">
          <p className="text-[11px] text-blue-400 mb-0.5">Matheus</p>
          <p className="text-base font-bold text-blue-700">R$ {totalMatheus.toFixed(2)}</p>
          <p className="text-[10px] text-blue-400">{comprasFiltradas.filter(c => c.responsavel === 'Matheus').length}x</p>
        </div>
        <div className="bg-pink-50 rounded-xl border border-pink-100 p-3 text-center">
          <p className="text-[11px] text-pink-400 mb-0.5">Jeniffer</p>
          <p className="text-base font-bold text-pink-600">R$ {totalJeniffer.toFixed(2)}</p>
          <p className="text-[10px] text-pink-400">{comprasFiltradas.filter(c => c.responsavel === 'Jeniffer').length}x</p>
        </div>
      </div>

      {/* Lista agrupada por data */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="p-4 flex items-center gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-2.5 bg-gray-100 rounded w-1/2" />
              </div>
              <div className="h-4 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
      ) : grupos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <ShoppingBag className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-sm text-gray-400">Nenhuma compra encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(([dateKey, items]) => {
            const subtotal = items.reduce((acc, c) => acc + c.valor, 0)
            return (
              <div key={dateKey} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-500 capitalize">
                    {formatarCabecalhoData(dateKey)}
                  </span>
                  <span className="text-xs font-semibold text-gray-700">
                    R$ {subtotal.toFixed(2)}
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {items.map((c) => {
                    const isParcelado = c.parcela_atual && c.total_parcelas
                    return (
                      <div
                        key={c.hash_linha}
                        className={`px-3 py-3.5 flex items-center gap-3 ${
                          c.responsavel === 'Matheus'
                            ? 'border-l-4 border-l-blue-400'
                            : c.responsavel === 'Jeniffer'
                              ? 'border-l-4 border-l-pink-400'
                              : 'border-l-4 border-l-gray-200'
                        }`}
                      >
                        <Avatar responsavel={c.responsavel} />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate leading-tight">
                            {c.descricao}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {c.categoria && <CategoriaBadge categoria={c.categoria} />}
                            {isParcelado && (
                              <span className="inline-block text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                                {c.parcela_atual}/{c.total_parcelas}x
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-gray-800">R$ {c.valor.toFixed(2)}</p>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => abrirEditar(c)}
                            className="p-2 rounded-xl text-blue-400 hover:bg-blue-50 active:bg-blue-100 transition"
                            aria-label="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setModalExcluir(c)}
                            className="p-2 rounded-xl text-red-400 hover:bg-red-50 active:bg-red-100 transition"
                            aria-label="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: editar compra */}
      {modalEditar && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">Editar Compra</h3>
              <button onClick={() => setModalEditar(null)} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Descrição</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={formEditar.descricao}
                  onChange={(e) => setFormEditar(f => ({ ...f, descricao: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="0,00"
                  value={formEditar.valor}
                  onChange={(e) => setFormEditar(f => ({ ...f, valor: numericOnly(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Responsável</label>
                <div className="flex gap-2">
                  {['Matheus', 'Jeniffer'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormEditar(f => ({ ...f, responsavel: r }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition border ${
                        formEditar.responsavel === r
                          ? r === 'Matheus'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-pink-500 text-white border-pink-500'
                          : 'bg-white text-gray-500 border-gray-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Categoria</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  value={formEditar.categoria}
                  onChange={(e) => setFormEditar(f => ({ ...f, categoria: e.target.value }))}
                >
                  <option value="">Sem categoria</option>
                  {CATEGORIAS.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Data da compra</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={formEditar.data_compra}
                  onChange={(e) => setFormEditar(f => ({ ...f, data_compra: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setModalEditar(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={salvando}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: excluir compra */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-center mb-1">Excluir compra?</h3>
            <p className="text-sm text-gray-500 text-center mb-1">
              <span className="font-semibold text-gray-800">{modalExcluir.descricao}</span>
            </p>
            <p className="text-sm text-gray-400 text-center mb-6">
              R$ {modalExcluir.valor.toFixed(2)} · {modalExcluir.responsavel}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setModalExcluir(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarExclusao}
                disabled={salvando}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-50 transition"
              >
                {salvando ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
