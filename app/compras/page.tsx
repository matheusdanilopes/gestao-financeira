'use client'

import { useEffect, useMemo } from 'react'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ChevronLeft, ChevronRight, Pencil, Trash2, X } from 'lucide-react'
import { addMonths, subMonths, format, startOfMonth, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import BottomNav from '@/components/BottomNav'
import { log, numericOnly } from '@/lib/logger'
import { useMes } from '@/components/MesProvider'

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

function formatarData(dataStr: string): string {
  const raw = dataStr.substring(0, 10)
  if (!raw || raw.length < 10) return raw
  try {
    return format(parse(raw, 'yyyy-MM-dd', new Date()), 'dd/MM')
  } catch {
    return raw
  }
}

function borderColor(responsavel: string): string {
  if (responsavel === 'Matheus') return 'border-l-4 border-l-blue-400'
  if (responsavel === 'Jeniffer') return 'border-l-4 border-l-pink-400'
  return 'border-l-4 border-l-gray-200'
}

function dataParaInput(dataStr: string | null): string {
  if (!dataStr) return format(new Date(), 'yyyy-MM-dd')
  return dataStr.toString().substring(0, 10)
}

export default function ComprasPage() {
  // Compras usa sempre mês global + 1 (fatura do próximo mês)
  const { mesAtual: mesGlobal, setMesAtual } = useMes()
  const mesAtual = addMonths(mesGlobal, 1)
  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM')
  const [compras, setCompras] = useState<Compra[]>([])
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
    const mesRef = format(startOfMonth(mesAtual), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', mesRef)
      .order('data_compra', { ascending: false })
    setCompras(data || [])
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
        categoria: formEditar.categoria.trim() || null,
        data_compra: formEditar.data_compra,
      })
      .eq('hash_linha', modalEditar.hash_linha)

    setSalvando(false)
    if (error) { showToast('Erro ao salvar', 'erro'); return }

    log('editar', 'transacoes_nubank',
      `Editado: ${formEditar.descricao.trim()} — R$ ${valor.toFixed(2)} (${formEditar.responsavel})`,
      valor
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
      const dataStr = (c.data_compra || c.data || '').toString().substring(0, 10)
      const diaCompra = dataStr ? Number(dataStr.substring(8, 10)) : null
      const passaResponsavel = !filtroResponsavel || c.responsavel === filtroResponsavel
      const passaDescricao = !filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())
      const passaValor = !filtroValorMin || c.valor >= Number(filtroValorMin)
      const passaDia = !filtroDia || diaCompra === Number(filtroDia)
      return passaResponsavel && passaDescricao && passaValor && passaDia
    })
  }, [compras, filtroResponsavel, filtroDescricao, filtroValorMin, filtroDia])

  const total = useMemo(() => comprasFiltradas.reduce((acc, c) => acc + c.valor, 0), [comprasFiltradas])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg ${
          toast.tipo === 'ok' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <h1 className="text-2xl font-bold mb-4">Compras do Cartão</h1>

      {/* Navegação de mês */}
      <div className="flex items-center justify-between bg-white rounded-xl shadow p-3 mb-4">
        <button onClick={() => setMesAtual(subMonths(mesGlobal, 1))} className="p-2 hover:bg-gray-100 rounded-full">
          <ChevronLeft className="w-5 h-5" />
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
        <button onClick={() => setMesAtual(addMonths(mesGlobal, 1))} className="p-2 hover:bg-gray-100 rounded-full">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow p-3 mb-3 grid grid-cols-2 gap-2">
        <select className="bg-gray-50 rounded-lg p-2 text-sm" value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)}>
          <option value="">Responsável (todos)</option>
          <option value="Matheus">Matheus</option>
          <option value="Jeniffer">Jeniffer</option>
        </select>
        <input type="text" className="bg-gray-50 rounded-lg p-2 text-sm" placeholder="Descrição" value={filtroDescricao} onChange={(e) => setFiltroDescricao(e.target.value)} />
        <input type="text" inputMode="decimal" className="bg-gray-50 rounded-lg p-2 text-sm" placeholder="Valor mínimo" value={filtroValorMin} onChange={(e) => setFiltroValorMin(numericOnly(e.target.value))} />
        <input type="number" min="1" max="31" className="bg-gray-50 rounded-lg p-2 text-sm" placeholder="Dia" value={filtroDia} onChange={(e) => setFiltroDia(e.target.value)} />
        {filtrosAtivos && (
          <button onClick={limparFiltros} className="col-span-2 text-sm text-red-500 hover:text-red-700 py-1">
            Limpar filtros
          </button>
        )}
      </div>

      {/* Resumo */}
      <div className="bg-white rounded-xl shadow p-3 mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">Total filtrado no mês</p>
        <div className="text-right">
          <p className="text-lg font-bold text-blue-700">R$ {total.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{comprasFiltradas.length} compras</p>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl shadow divide-y overflow-hidden">
        {comprasFiltradas.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center gap-2">
            <p className="text-gray-300 text-4xl">🛒</p>
            <p className="text-sm text-gray-400">Nenhuma compra encontrada</p>
          </div>
        ) : (
          comprasFiltradas.map((c) => {
            const dataStr = (c.data_compra || c.data || '').toString()
            return (
              <div key={c.hash_linha} className={`p-3 flex items-center gap-2 ${borderColor(c.responsavel)}`}>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.descricao}</p>
                  <p className="text-xs text-gray-500">
                    {formatarData(dataStr)} · {c.responsavel}
                    {c.categoria && (
                      <span className="ml-1 bg-gray-100 px-1.5 py-0.5 rounded text-[10px] text-gray-500">{c.categoria}</span>
                    )}
                  </p>
                </div>

                {/* Valor + parcela */}
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">R$ {c.valor.toFixed(2)}</p>
                  {c.parcela_atual && c.total_parcelas && (
                    <p className="text-xs text-gray-400">{c.parcela_atual}/{c.total_parcelas}</p>
                  )}
                </div>

                {/* Ações */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => abrirEditar(c)}
                    className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setModalExcluir(c)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Modal: editar compra ── */}
      {modalEditar && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-start justify-between mb-5">
              <h3 className="text-lg font-bold">Editar Compra</h3>
              <button onClick={() => setModalEditar(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descrição</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={formEditar.descricao}
                  onChange={(e) => setFormEditar(f => ({ ...f, descricao: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="0,00"
                  value={formEditar.valor}
                  onChange={(e) => setFormEditar(f => ({ ...f, valor: numericOnly(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={formEditar.responsavel}
                  onChange={(e) => setFormEditar(f => ({ ...f, responsavel: e.target.value }))}
                >
                  <option value="Matheus">Matheus</option>
                  <option value="Jeniffer">Jeniffer</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Categoria</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="Ex: Alimentação, Transporte…"
                  value={formEditar.categoria}
                  onChange={(e) => setFormEditar(f => ({ ...f, categoria: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Data da compra</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={formEditar.data_compra}
                  onChange={(e) => setFormEditar(f => ({ ...f, data_compra: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setModalEditar(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={salvando}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: excluir compra ── */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Excluir compra</h3>
            <p className="text-sm text-gray-500 mb-1">
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-gray-800">"{modalExcluir.descricao}"</span>?
            </p>
            <p className="text-sm text-gray-400 mb-6">
              R$ {modalExcluir.valor.toFixed(2)} · {modalExcluir.responsavel}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setModalExcluir(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarExclusao}
                disabled={salvando}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold disabled:opacity-50"
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
