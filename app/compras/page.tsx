'use client'

import { useEffect, useMemo } from 'react'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ChevronLeft, ChevronRight, Pencil, Trash2, X } from 'lucide-react'
import { addMonths, subMonths, format, startOfMonth, parse, isToday, isYesterday } from 'date-fns'
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

const CATEGORIA_CORES: Record<string, string> = {
  'Alimentação': 'bg-orange-100 text-orange-700',
  'Mercado':     'bg-green-100 text-green-700',
  'Transporte':  'bg-blue-100 text-blue-700',
  'Saúde':       'bg-red-100 text-red-700',
  'Lazer':       'bg-purple-100 text-purple-700',
  'Educação':    'bg-indigo-100 text-indigo-700',
  'Moradia':     'bg-amber-100 text-amber-700',
  'Vestuário':   'bg-pink-100 text-pink-700',
  'Tecnologia':  'bg-cyan-100 text-cyan-700',
  'Serviços':    'bg-slate-100 text-slate-600',
  'Viagem':      'bg-teal-100 text-teal-700',
  'Pet':         'bg-lime-100 text-lime-700',
  'Outros':      'bg-gray-100 text-gray-500',
}

function categoriaCor(cat: string | null): string {
  if (!cat) return 'bg-gray-100 text-gray-400'
  return CATEGORIA_CORES[cat] ?? 'bg-gray-100 text-gray-500'
}

function formatarCabecalhoData(dataStr: string): string {
  if (!dataStr || dataStr.length < 10) return dataStr
  try {
    const d = parse(dataStr, 'yyyy-MM-dd', new Date())
    if (isToday(d)) return 'Hoje'
    if (isYesterday(d)) return 'Ontem'
    return format(d, "EEEE, dd 'de' MMMM", { locale: ptBR })
  } catch {
    return dataStr
  }
}

function dataParaInput(dataStr: string | null): string {
  if (!dataStr) return format(new Date(), 'yyyy-MM-dd')
  return dataStr.toString().substring(0, 10)
}

export default function ComprasPage() {
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
      .order('data', { ascending: false })
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

  const comprasPorData = useMemo(() => {
    const grupos: Record<string, Compra[]> = {}
    comprasFiltradas.forEach((c) => {
      const key = (c.data_compra || c.data || '').toString().substring(0, 10)
      if (!grupos[key]) grupos[key] = []
      grupos[key].push(c)
    })
    return Object.entries(grupos).sort(([a], [b]) => b.localeCompare(a))
  }, [comprasFiltradas])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">

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
      <div className="bg-white rounded-xl shadow p-3 mb-4 flex items-center justify-between">
        <p className="text-xs text-gray-500">Total filtrado no mês</p>
        <div className="text-right">
          <p className="text-lg font-bold text-blue-700">R$ {total.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{comprasFiltradas.length} compras</p>
        </div>
      </div>

      {/* Lista agrupada por data */}
      {comprasPorData.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-10 flex flex-col items-center justify-center gap-2">
          <p className="text-gray-300 text-4xl">🛒</p>
          <p className="text-sm text-gray-400">Nenhuma compra encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comprasPorData.map(([dataKey, itens]) => {
            const subtotal = itens.reduce((acc, c) => acc + c.valor, 0)
            return (
              <div key={dataKey} className="bg-white rounded-xl shadow overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-500 capitalize">
                    {formatarCabecalhoData(dataKey)}
                  </span>
                  <span className="text-xs font-semibold text-gray-600">
                    R$ {subtotal.toFixed(2)}
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {itens.map((c) => (
                    <div
                      key={c.hash_linha}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        c.responsavel === 'Matheus'
                          ? 'border-l-4 border-l-blue-400'
                          : c.responsavel === 'Jeniffer'
                          ? 'border-l-4 border-l-pink-400'
                          : 'border-l-4 border-l-gray-200'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate leading-snug">
                          {c.descricao}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            c.responsavel === 'Matheus'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-pink-100 text-pink-700'
                          }`}>
                            {c.responsavel}
                          </span>

                          {c.categoria && (
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${categoriaCor(c.categoria)}`}>
                              {c.categoria}
                            </span>
                          )}

                          {c.parcela_atual && c.total_parcelas && (
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                              {c.parcela_atual}/{c.total_parcelas}x
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-800">
                          R$ {c.valor.toFixed(2)}
                        </p>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => abrirEditar(c)}
                          className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-50 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setModalExcluir(c)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: editar compra */}
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

      {/* Modal: excluir compra */}
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
