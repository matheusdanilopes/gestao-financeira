'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, addMonths, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  BookmarkPlus, Plus, X, CheckCircle2, Undo2, Clock, AlertTriangle, XCircle, StopCircle, Trash2,
} from 'lucide-react'
import MonthSelector from '@/components/MonthSelector'
import EmptyState from '@/components/EmptyState'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { InfoPopover } from '@/components/InfoPopover'
import { useMes } from '@/components/MesProvider'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { nomeDoUsuario } from '@/lib/notificacoes'
import { formatBRL, mascaraMoeda, formatarMoedaInput, parseMoeda } from '@/lib/format'
import { RESPONSAVEIS, estiloResponsavel, type Responsavel } from '@/lib/responsavelStyle'
import {
  calcularReservasDoMes, mesReferenciaISO, ehParcelada, mesUltimaParcela,
  type ReservaFatura, type BaixaReserva, type TransacaoParaReserva, type ReservaCalculada,
} from '@/lib/reservasFatura'

// Mesmos tokens visuais da tela de Assinaturas (components/AssinaturasMensal.tsx),
// a irmã mais próxima desta no menu Cartão.
const CAMPO = 'w-full border border-gray-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow'
const LABEL = 'text-xs font-semibold text-gray-500 mb-1.5 block'
const OVERLAY = 'fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay'
const SHEET = 'bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center'
const BTN_CANCELAR = 'flex-1 py-3 rounded-2xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]'

// Cartões de filtro por pessoa — classes literais completas (o Tailwind não enxerga
// nomes montados com template string).
const FILTRO_ESTILO: Record<Responsavel, { ativo: string; label: string; valor: string; sub: string }> = {
  Matheus:  { ativo: 'bg-blue-50 border-blue-200 dark:border-blue-800', label: 'text-blue-500', valor: 'text-blue-700', sub: 'text-blue-400' },
  Jeniffer: { ativo: 'bg-pink-50 border-pink-200 dark:border-pink-800', label: 'text-pink-500 dark:text-pink-400', valor: 'text-pink-600', sub: 'text-pink-400' },
  Conjunto: { ativo: 'bg-purple-50 border-purple-200 dark:border-purple-800', label: 'text-purple-500 dark:text-purple-400', valor: 'text-purple-700', sub: 'text-purple-400' },
}

interface Dados {
  reservas: ReservaFatura[]
  baixas: BaixaReserva[]
  transacoes: TransacaoParaReserva[]
}

type TipoReserva = 'pontual' | 'parcelada' | 'recorrente'
const TIPOS: { tipo: TipoReserva; label: string }[] = [
  { tipo: 'pontual', label: 'Pontual' },
  { tipo: 'parcelada', label: 'Parcelada' },
  { tipo: 'recorrente', label: 'Recorrente' },
]
const MAX_PARCELAS = 48

function tipoDe(reserva: ReservaFatura | null): TipoReserva {
  if (reserva?.recorrente) return 'recorrente'
  if (reserva && ehParcelada(reserva)) return 'parcelada'
  return 'pontual'
}

const mesCurto = (iso: string) => format(new Date(iso + 'T12:00:00'), 'MMM/yyyy', { locale: ptBR })

function mensagemErro(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? ''
  return /reservas_fatura/.test(msg)
    ? 'Tabela de compras previstas não encontrada. Rode supabase/migration_reservas_fatura.sql no SQL Editor do Supabase.'
    : 'Não foi possível carregar as compras previstas.'
}

async function carregar(mes: Date): Promise<Dados> {
  const mesRef = mesReferenciaISO(mes)
  // Compras do mês M aparecem na fatura M+1 (mesma regra do Dashboard).
  const projetoFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [reservasRes, baixasRes, txRes] = await Promise.all([
    supabase.from('reservas_fatura')
      .select('id, descricao, valor, responsavel, recorrente, mes_inicio, mes_fim, palavras_chave, parcelas, created_at')
      .lte('mes_inicio', mesRef).or(`mes_fim.is.null,mes_fim.gte.${mesRef}`),
    // Até o mês exibido: a baixa de uma compra parcelada vale para as parcelas seguintes.
    supabase.from('reservas_fatura_baixas').select('reserva_id, mes_referencia').lte('mes_referencia', mesRef),
    supabase.from('transacoes_nubank').select('descricao, valor, responsavel, status')
      .eq('cartao', 'nubank').eq('projeto_fatura', projetoFatura),
  ])
  if (reservasRes.error) throw reservasRes.error
  if (baixasRes.error) throw baixasRes.error
  return {
    reservas: (reservasRes.data ?? []) as ReservaFatura[],
    baixas: (baixasRes.data ?? []) as BaixaReserva[],
    transacoes: (txRes.data ?? []) as TransacaoParaReserva[],
  }
}

export default function ComprasPrevistasPage() {
  const { mesAtual, setMesAtual } = useMes()
  const mesRef = mesReferenciaISO(mesAtual)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [usuario, setUsuario] = useState<Responsavel>('Matheus')
  const [filtro, setFiltro] = useState<Responsavel | ''>('')
  const [modal, setModal] = useState<
    | { tipo: 'form'; reserva: ReservaFatura | null }
    | { tipo: 'excluir' | 'encerrar'; reserva: ReservaFatura }
    | null
  >(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  useEffect(() => {
    let cancelado = false
    async function init() {
      if (AUTH_DISABLED) return
      const { data: { session } } = await supabase.auth.getSession()
      const email = session?.user?.email
      if (!email || cancelado) return
      setUsuario(nomeDoUsuario(email) === 'Jeniffer' ? 'Jeniffer' : 'Matheus')
    }
    init()
    return () => { cancelado = true }
  }, [])

  const recarregar = useCallback(async () => {
    try {
      const novos = await carregar(mesAtual)
      setDados(novos)
      setErro(null)
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }, [mesAtual])

  useEffect(() => {
    let cancelado = false
    carregar(mesAtual)
      .then(novos => { if (!cancelado) { setDados(novos); setErro(null) } })
      .catch(e => { if (!cancelado) setErro(mensagemErro(e)) })
    return () => { cancelado = true }
  }, [mesAtual])

  function mostrarToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const calculadas = useMemo(
    () => dados ? calcularReservasDoMes(dados.reservas, dados.baixas, dados.transacoes, mesRef) : [],
    [dados, mesRef],
  )

  const totais = useMemo(() => {
    const porResp = Object.fromEntries(
      RESPONSAVEIS.map(r => [r, { previsto: 0, pendente: 0, qtd: 0 }])
    ) as Record<Responsavel, { previsto: number; pendente: number; qtd: number }>
    let previsto = 0, pendente = 0, concluidas = 0
    for (const c of calculadas) {
      previsto += c.valorDoMes
      pendente += c.pendente
      if (c.pendente === 0) concluidas++
      const r = porResp[c.reserva.responsavel as Responsavel]
      if (r) { r.previsto += c.valorDoMes; r.pendente += c.pendente; r.qtd++ }
    }
    return { previsto, pendente, concluidas, porResp }
  }, [calculadas])

  async function executar(chave: string, acao: () => PromiseLike<{ error: unknown }>, sucesso: string) {
    setOcupado(chave)
    try {
      const { error } = await acao()
      if (error) throw error
      await recarregar()
      mostrarToast(sucesso)
      return true
    } catch {
      mostrarToast('Não foi possível salvar. Tente novamente.', 'erro')
      return false
    } finally {
      setOcupado(null)
    }
  }

  // Numa parcelada, a baixa pode ter sido dada numa parcela anterior: desfazer
  // remove aquela baixa, e as parcelas a partir dela voltam a contar.
  const alternarBaixa = (c: ReservaCalculada) => executar(
    c.reserva.id,
    () => c.mesBaixa
      ? supabase.from('reservas_fatura_baixas').delete().eq('reserva_id', c.reserva.id).eq('mes_referencia', c.mesBaixa)
      : supabase.from('reservas_fatura_baixas').insert({ reserva_id: c.reserva.id, mes_referencia: mesRef }),
    c.mesBaixa ? 'Voltou a contar no Restante' : 'Marcada como já caiu',
  )

  async function encerrar(r: ReservaFatura) {
    const ok = await executar(r.id, () => supabase.from('reservas_fatura')
      .update({ mes_fim: mesRef, updated_at: new Date().toISOString() }).eq('id', r.id), 'Compra recorrente encerrada')
    if (ok) setModal(null)
  }

  async function excluir(r: ReservaFatura) {
    const ok = await executar(r.id, () => supabase.from('reservas_fatura').delete().eq('id', r.id), 'Compra prevista excluída')
    if (ok) setModal(null)
  }

  const visiveis = filtro ? RESPONSAVEIS.filter(r => r === filtro) : RESPONSAVEIS

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-1.5">
          Compras previstas
          <InfoPopover texto="Cadastre compras que você sabe que vão cair na fatura do NuBank — pontuais (só neste mês), parceladas (o total dividido pelos meses das parcelas) ou recorrentes (todo mês até você encerrar). O 'Restante' de cada pessoa no Dashboard já desconta o que ainda não caiu. Com palavras-chave, as compras importadas que casarem abatem a previsão sozinhas; você também pode marcar 'Já caiu' manualmente — numa parcelada, isso tira também as parcelas seguintes, que passam a vir das compras importadas." />
        </h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content">
        <div className="space-y-3">
          {toast && (
            <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-float ${
              toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
            }`}>
              {toast.msg}
            </div>
          )}

          {erro && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 font-medium">{erro}</p>
            </div>
          )}

          {!erro && !dados && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[0, 1].map(i => <div key={i} className="h-[92px] bg-white rounded-2xl shadow-card border border-gray-100 animate-pulse" />)}
              </div>
              <div className="h-40 bg-white rounded-3xl shadow-card border border-gray-100 animate-pulse" />
            </>
          )}

          {!erro && dados && (
            <>
              {/* Resumo: o que ainda vai cair + o que já caiu */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1.5">
                    <Clock className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" />
                    <p className="text-xs text-gray-400 font-medium">A cair na fatura</p>
                  </div>
                  <p className="text-xl font-bold text-primary-700 num leading-none">{formatBRL(totais.pendente)}</p>
                  <p className="text-xs text-gray-400 mt-1 num">de {formatBRL(totais.previsto)} previstos</p>
                </div>
                <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    <p className="text-xs text-gray-400 font-medium">Já na fatura</p>
                  </div>
                  <p className="text-xl font-bold text-green-700 num leading-none">{formatBRL(totais.previsto - totais.pendente)}</p>
                  <p className="text-xs text-gray-400 mt-1">{totais.concluidas}/{calculadas.length} concluída(s)</p>
                </div>
              </div>

              {/* Filtro por pessoa */}
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => setFiltro('')}
                  className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
                    filtro === '' ? 'bg-primary-50 border-primary-200 dark:border-primary-800' : 'bg-white border-gray-100'
                  }`}
                >
                  <p className={`text-[11px] font-medium mb-0.5 ${filtro === '' ? 'text-primary-500 dark:text-primary-400' : 'text-gray-400'}`}>Total</p>
                  <p className={`text-xs font-bold num leading-tight ${filtro === '' ? 'text-primary-700' : 'text-gray-700'}`}>{formatBRL(totais.pendente)}</p>
                  <p className={`text-[9px] mt-0.5 ${filtro === '' ? 'text-primary-400' : 'text-gray-400'}`}>{calculadas.length} prevista(s)</p>
                </button>
                {RESPONSAVEIS.map(r => {
                  const ativo = filtro === r
                  const est = FILTRO_ESTILO[r]
                  return (
                    <button
                      key={r}
                      onClick={() => setFiltro(ativo ? '' : r)}
                      className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${ativo ? est.ativo : 'bg-white border-gray-100'}`}
                    >
                      <p className={`text-[11px] font-medium mb-0.5 ${ativo ? est.label : 'text-gray-400'}`}>{r}</p>
                      <p className={`text-xs font-bold num leading-tight ${ativo ? est.valor : 'text-gray-700'}`}>{formatBRL(totais.porResp[r].pendente)}</p>
                      <p className={`text-[9px] mt-0.5 ${ativo ? est.sub : 'text-gray-400'}`}>{totais.porResp[r].qtd} prevista(s)</p>
                    </button>
                  )
                })}
              </div>

              {/* Lista por pessoa */}
              {visiveis.map(resp => {
                const itens = calculadas.filter(c => c.reserva.responsavel === resp)
                if (itens.length === 0) return null
                return (
                  <div key={resp} className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${estiloResponsavel(resp).ponto}`} />
                        <span className="font-semibold text-sm text-gray-700">{resp}</span>
                      </div>
                      <span className="text-sm font-bold text-primary-700 num">
                        {formatBRL(totais.porResp[resp].pendente)}
                        <span className="text-xs font-normal text-gray-400 ml-0.5">a cair</span>
                      </span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {itens.map(c => (
                        <ItemPrevisto
                          key={c.reserva.id}
                          calc={c}
                          mesRef={mesRef}
                          ocupado={ocupado === c.reserva.id}
                          onEditar={() => setModal({ tipo: 'form', reserva: c.reserva })}
                          onExcluir={() => setModal({ tipo: 'excluir', reserva: c.reserva })}
                          onBaixa={() => alternarBaixa(c)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}

              {calculadas.filter(c => !filtro || c.reserva.responsavel === filtro).length === 0 && (
                <div className="bg-white rounded-3xl shadow-card border border-gray-100">
                  <EmptyState
                    icon={BookmarkPlus}
                    title="Nenhuma compra prevista"
                    description="Cadastre compras que ainda vão cair na fatura para saber quanto realmente sobra para gastar"
                  />
                </div>
              )}

              <button
                onClick={() => setModal({ tipo: 'form', reserva: null })}
                className="w-full bg-primary-600 text-white py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm"
              >
                <Plus className="w-5 h-5" />
                Adicionar compra prevista
              </button>
            </>
          )}
        </div>
      </div>

      {modal?.tipo === 'form' && (
        <FormCompraPrevista
          reserva={modal.reserva}
          responsavelPadrao={filtro || usuario}
          mesRef={mesRef}
          onClose={() => setModal(null)}
          onSalvo={async (msg) => { await recarregar(); mostrarToast(msg); setModal(null) }}
          onEncerrar={r => setModal({ tipo: 'encerrar', reserva: r })}
          onExcluir={r => setModal({ tipo: 'excluir', reserva: r })}
        />
      )}

      {modal?.tipo === 'excluir' && (
        <ModalConfirmacao
          icone={<XCircle className="w-6 h-6 text-red-500" />}
          fundoIcone="bg-red-100"
          titulo="Excluir compra prevista?"
          texto={<>
            <span className="font-semibold text-gray-800">&quot;{modal.reserva.descricao}&quot;</span>{' '}
            {modal.reserva.recorrente
              ? 'sai de todos os meses. Para parar só daqui pra frente, use Encerrar.'
              : ehParcelada(modal.reserva) ? 'e todas as parcelas serão removidas.' : 'será removida.'}
          </>}
          botao="Excluir"
          corBotao="bg-red-500 hover:bg-red-600"
          ocupado={ocupado === modal.reserva.id}
          onCancelar={() => setModal(null)}
          onConfirmar={() => excluir(modal.reserva)}
        />
      )}

      {modal?.tipo === 'encerrar' && (
        <ModalConfirmacao
          icone={<StopCircle className="w-6 h-6 text-amber-500" />}
          fundoIcone="bg-amber-100"
          titulo="Encerrar compra recorrente?"
          texto={<>
            <span className="font-semibold text-gray-800">&quot;{modal.reserva.descricao}&quot;</span>{' '}
            vale até {mesCurto(mesRef)} e some dos meses seguintes.
          </>}
          botao="Encerrar"
          corBotao="bg-amber-500 hover:bg-amber-600"
          ocupado={ocupado === modal.reserva.id}
          onCancelar={() => setModal(null)}
          onConfirmar={() => encerrar(modal.reserva)}
        />
      )}
    </div>
  )
}

function StatusIcone({ calc }: { calc: ReservaCalculada }) {
  if (calc.consumido > calc.valorDoMes && !calc.baixadaManual)
    return <span title="Passou do valor previsto"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /></span>
  if (calc.pendente === 0)
    return <span title="Já caiu na fatura"><CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /></span>
  return <span title="Ainda não caiu na fatura"><Clock className="w-4 h-4 text-gray-300 shrink-0" /></span>
}

function ItemPrevisto({ calc, mesRef, ocupado, onEditar, onExcluir, onBaixa }: {
  calc: ReservaCalculada
  mesRef: string
  ocupado: boolean
  onEditar: () => void
  onExcluir: () => void
  onBaixa: () => void
}) {
  const { reserva, consumido, compras, baixadaManual, mesBaixa, valorDoMes, parcelaAtual, pendente } = calc
  const parcelada = ehParcelada(reserva)
  const concluida = pendente === 0
  const tipo = reserva.recorrente
    ? reserva.mes_fim ? `Recorrente até ${mesCurto(reserva.mes_fim)}` : 'Recorrente'
    : parcelada ? `Parcela ${parcelaAtual}/${reserva.parcelas}` : 'Pontual'

  const detalhes: string[] = []
  if (baixadaManual) detalhes.push(mesBaixa && mesBaixa !== mesRef ? `já caiu em ${mesCurto(mesBaixa)}` : 'marcada como já caiu')
  if (consumido > 0) detalhes.push(`${formatBRL(consumido)} já na fatura`)
  if (reserva.palavras_chave) detalhes.push(reserva.palavras_chave)

  return (
    <SwipeableItem onDelete={onExcluir}>
      <div
        className={`px-4 py-3.5 flex items-center gap-3 transition-colors cursor-pointer active:bg-gray-50 dark:active:bg-white/[0.06] hover:bg-gray-50/50 dark:hover:bg-white/[0.06] ${ocupado ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={onEditar}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditar() } }}
        aria-label={`Editar ${reserva.descricao}`}
      >
        <StatusIcone calc={calc} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-[15px] font-semibold truncate leading-snug ${concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
              {reserva.descricao}
            </p>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 shrink-0 font-medium">{tipo}</span>
          </div>
          {detalhes.length > 0 && (
            <p
              className="text-xs text-gray-400 mt-0.5 leading-tight truncate"
              title={compras.map(t => `${t.descricao} · ${formatBRL(t.valor)}`).join('\n') || undefined}
            >
              {detalhes.join(' · ')}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[15px] font-bold num ${concluida ? 'text-gray-400' : 'text-primary-700'}`}>{formatBRL(pendente)}</p>
          <p className="text-[10px] text-gray-400 num leading-tight mt-0.5">de {formatBRL(valorDoMes)}</p>
          {parcelada && (
            <p className="text-[10px] text-gray-400 num leading-tight">total {formatBRL(Number(reserva.valor))}</p>
          )}
        </div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onBaixa}
            title={baixadaManual
              ? 'Desfazer: volta a contar no Restante'
              : parcelada ? 'Já caiu: tira esta parcela e as seguintes da previsão' : 'Já caiu na fatura'}
            aria-label={baixadaManual ? 'Desfazer já caiu' : 'Marcar como já caiu'}
            className={`p-1.5 rounded-xl transition-colors ${
              baixadaManual ? 'text-gray-400 hover:bg-gray-100' : 'text-green-500 hover:bg-green-50'
            }`}
          >
            {baixadaManual ? <Undo2 className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </SwipeableItem>
  )
}

function ModalConfirmacao({ icone, fundoIcone, titulo, texto, botao, corBotao, ocupado, onCancelar, onConfirmar }: {
  icone: React.ReactNode
  fundoIcone: string
  titulo: string
  texto: React.ReactNode
  botao: string
  corBotao: string
  ocupado: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <ModalPortal>
      <div className={OVERLAY}>
        <div className={SHEET}>
          <div className={`w-12 h-12 rounded-full ${fundoIcone} flex items-center justify-center mx-auto mb-4`}>{icone}</div>
          <h3 className="text-lg font-bold text-center mb-1">{titulo}</h3>
          <p className="text-sm text-gray-500 text-center mb-6">{texto}</p>
          <div className="flex gap-3">
            <button onClick={onCancelar} className={BTN_CANCELAR}>Cancelar</button>
            <button
              onClick={onConfirmar}
              disabled={ocupado}
              className={`flex-1 py-3 rounded-2xl text-white font-semibold transition-all active:scale-[0.97] shadow-sm disabled:opacity-50 ${corBotao}`}
            >
              {botao}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

function FormCompraPrevista({ reserva, responsavelPadrao, mesRef, onClose, onSalvo, onEncerrar, onExcluir }: {
  reserva: ReservaFatura | null
  responsavelPadrao: Responsavel
  mesRef: string
  onClose: () => void
  onSalvo: (msg: string) => Promise<void>
  onEncerrar: (r: ReservaFatura) => void
  onExcluir: (r: ReservaFatura) => void
}) {
  const [descricao, setDescricao] = useState(reserva?.descricao ?? '')
  const [valor, setValor] = useState(reserva ? formatarMoedaInput(reserva.valor) : '')
  const [responsavel, setResponsavel] = useState<Responsavel>((reserva?.responsavel as Responsavel) ?? responsavelPadrao)
  const [tipo, setTipo] = useState<TipoReserva>(tipoDe(reserva))
  const [parcelas, setParcelas] = useState(reserva && ehParcelada(reserva) ? String(reserva.parcelas) : '2')
  const [palavras, setPalavras] = useState(reserva?.palavras_chave ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Mantém o início original enquanto o tipo não muda. Nova, ou trocando de tipo,
  // começa no mês em exibição.
  const mesInicio = reserva && tipoDe(reserva) === tipo ? reserva.mes_inicio : mesRef
  const nParcelas = Number(parcelas)
  const parcelasValidas = Number.isInteger(nParcelas) && nParcelas >= 2 && nParcelas <= MAX_PARCELAS
  const valorNum = parseMoeda(valor)

  async function salvar() {
    if (!descricao.trim()) { setErro('Informe uma descrição.'); return }
    if (!(valorNum > 0)) { setErro('Informe um valor maior que zero.'); return }
    if (tipo === 'parcelada' && !parcelasValidas) { setErro(`Informe de 2 a ${MAX_PARCELAS} parcelas.`); return }
    setSalvando(true)
    setErro(null)

    // Pontual vale só no mês de início; parcelada, até a última parcela. Ao virar
    // recorrente, reabre (sem fim); ao continuar recorrente, mantém um
    // encerramento já definido.
    const mesFim = tipo === 'recorrente'
      ? (reserva?.recorrente ? reserva.mes_fim : null)
      : tipo === 'parcelada' ? mesUltimaParcela(mesInicio, nParcelas) : mesInicio
    const payload = {
      descricao: descricao.trim(),
      valor: valorNum,
      responsavel,
      recorrente: tipo === 'recorrente',
      parcelas: tipo === 'parcelada' ? nParcelas : null,
      mes_inicio: mesInicio,
      mes_fim: mesFim,
      palavras_chave: palavras.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = reserva
      ? await supabase.from('reservas_fatura').update(payload).eq('id', reserva.id)
      : await supabase.from('reservas_fatura').insert(payload)
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar. Tente novamente.'); return }
    await onSalvo(reserva ? 'Compra prevista atualizada' : 'Compra prevista adicionada')
  }

  const resumoTipo = tipo === 'recorrente'
    ? `Todo mês a partir de ${mesCurto(mesInicio)}, até você encerrar.`
    : tipo === 'parcelada'
      ? parcelasValidas
        ? `${nParcelas}x de ${formatBRL(valorNum > 0 ? valorNum / nParcelas : 0)}, de ${mesCurto(mesInicio)} a ${mesCurto(mesUltimaParcela(mesInicio, nParcelas))}.`
        : `A partir de ${mesCurto(mesInicio)}.`
      : `Só em ${mesCurto(mesInicio)}.`

  return (
    <ModalPortal>
      <div className={OVERLAY}>
        <div className={`${SHEET} max-h-[90vh] overflow-y-auto`}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold">{reserva ? 'Editar Compra Prevista' : 'Nova Compra Prevista'}</h3>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition-all hover:rotate-90 duration-200" aria-label="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className={LABEL}>Tipo</label>
              <div className="flex bg-gray-100 rounded-2xl p-1 gap-0.5">
                {TIPOS.map(t => (
                  <button
                    key={t.tipo}
                    type="button"
                    onClick={() => setTipo(t.tipo)}
                    className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition-colors duration-200 ${
                      tipo === t.tipo ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">{resumoTipo}</p>
            </div>

            <div>
              <label className={LABEL}>Descrição</label>
              <input
                type="text"
                className={CAMPO}
                placeholder="Ex: Gasolina, Presente da mãe…"
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>

            <div>
              <label className={LABEL}>
                {tipo === 'parcelada' ? 'Valor total da compra (R$)' : tipo === 'recorrente' ? 'Valor mensal (R$)' : 'Valor (R$)'}
              </label>
              <input
                type="text"
                inputMode="decimal"
                className="w-full border border-gray-200 rounded-2xl p-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow num"
                placeholder="0,00"
                value={valor}
                onChange={e => setValor(mascaraMoeda(e.target.value))}
              />
            </div>

            {tipo === 'parcelada' && (
              <div>
                <label className={LABEL}>Número de parcelas</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${CAMPO} num`}
                  placeholder="Ex: 6"
                  value={parcelas}
                  onChange={e => setParcelas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
              </div>
            )}

            <div>
              <label className={LABEL}>Responsável</label>
              <select
                className={`${CAMPO} bg-white`}
                value={responsavel}
                onChange={e => setResponsavel(e.target.value as Responsavel)}
              >
                {RESPONSAVEIS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <label className={LABEL}>
                Palavras-chave
                <span className="ml-1 text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                className={CAMPO}
                placeholder="Ex: posto, shell, ipiranga"
                value={palavras}
                onChange={e => setPalavras(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Separadas por vírgula. Compras da fatura com esses termos abatem a previsão automaticamente.
              </p>
            </div>
          </div>

          {erro && <p className="text-xs text-red-500 mt-4">{erro}</p>}

          {reserva && (
            <div className="flex gap-2 mt-5">
              {reserva.recorrente && reserva.mes_fim !== mesRef && (
                <button
                  onClick={() => onEncerrar(reserva)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold transition-all active:scale-[0.98]"
                >
                  <StopCircle className="w-4 h-4" /> Encerrar
                </button>
              )}
              <button
                onClick={() => onExcluir(reserva)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border border-red-200 bg-red-50 text-red-600 text-sm font-semibold transition-all active:scale-[0.98]"
              >
                <Trash2 className="w-4 h-4" /> Excluir
              </button>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className={BTN_CANCELAR}>Cancelar</button>
            <button
              onClick={salvar}
              disabled={salvando}
              className="flex-1 py-3 rounded-2xl bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
