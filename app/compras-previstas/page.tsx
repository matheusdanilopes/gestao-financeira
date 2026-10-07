'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { format, addMonths, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { BookmarkPlus, Plus, Pencil, Trash2, CheckCircle2, Undo2, Repeat, CalendarCheck, StopCircle, Layers } from 'lucide-react'
import MonthSelector from '@/components/MonthSelector'
import EmptyState from '@/components/EmptyState'
import { BottomSheet } from '@/components/BottomSheet'
import { InfoPopover } from '@/components/InfoPopover'
import { useMes } from '@/components/MesProvider'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { nomeDoUsuario } from '@/lib/notificacoes'
import { formatBRL, mascaraMoeda, formatarMoedaInput, parseMoeda } from '@/lib/format'
import { RESPONSAVEIS, RESPONSAVEL_STYLE, type Responsavel } from '@/lib/responsavelStyle'
import {
  calcularReservasDoMes, mesReferenciaISO, ehParcelada, mesUltimaParcela,
  type ReservaFatura, type BaixaReserva, type TransacaoParaReserva, type ReservaCalculada,
} from '@/lib/reservasFatura'

const CAMPO = 'w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2.5 placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all'

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
  const [editando, setEditando] = useState<ReservaFatura | 'nova' | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

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

  const calculadas = useMemo(
    () => dados ? calcularReservasDoMes(dados.reservas, dados.baixas, dados.transacoes, mesRef) : [],
    [dados, mesRef],
  )

  const totais = useMemo(() => {
    const porResp = Object.fromEntries(RESPONSAVEIS.map(r => [r, { reservado: 0, pendente: 0 }])) as Record<Responsavel, { reservado: number; pendente: number }>
    let reservado = 0, pendente = 0
    for (const c of calculadas) {
      reservado += c.valorDoMes
      pendente += c.pendente
      const r = porResp[c.reserva.responsavel as Responsavel]
      if (r) { r.reservado += c.valorDoMes; r.pendente += c.pendente }
    }
    return { reservado, pendente, porResp }
  }, [calculadas])

  async function executar(chave: string, acao: () => PromiseLike<{ error: unknown }>) {
    setOcupado(chave)
    try {
      const { error } = await acao()
      if (error) throw error
      await recarregar()
    } catch {
      alert('Não foi possível salvar. Tente novamente.')
    } finally {
      setOcupado(null)
    }
  }

  // Numa parcelada, a baixa pode ter sido dada numa parcela anterior: desfazer
  // remove aquela baixa, e as parcelas a partir dela voltam a contar.
  const alternarBaixa = (c: ReservaCalculada) => executar(c.reserva.id, () =>
    c.mesBaixa
      ? supabase.from('reservas_fatura_baixas').delete().eq('reserva_id', c.reserva.id).eq('mes_referencia', c.mesBaixa)
      : supabase.from('reservas_fatura_baixas').insert({ reserva_id: c.reserva.id, mes_referencia: mesRef })
  )

  const encerrar = (r: ReservaFatura) => {
    if (!confirm(`Encerrar "${r.descricao}"? Ela vale até ${mesCurto(mesRef)} e some dos meses seguintes.`)) return
    executar(r.id, () => supabase.from('reservas_fatura')
      .update({ mes_fim: mesRef, updated_at: new Date().toISOString() }).eq('id', r.id))
  }

  const excluir = (r: ReservaFatura) => {
    const aviso = r.recorrente
      ? `Excluir "${r.descricao}" de todos os meses? Para parar só daqui pra frente, use Encerrar.`
      : ehParcelada(r)
        ? `Excluir "${r.descricao}" e todas as suas parcelas?`
        : `Excluir a compra prevista "${r.descricao}"?`
    if (!confirm(aviso)) return
    executar(r.id, () => supabase.from('reservas_fatura').delete().eq('id', r.id))
  }

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-[10]">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-1.5">
            Compras previstas
            <InfoPopover texto="Cadastre compras que você sabe que vão cair na fatura do NuBank — pontuais (só neste mês), parceladas (o total dividido pelos meses das parcelas) ou recorrentes (todo mês até você encerrar). O 'Restante' de cada pessoa no Dashboard já desconta o que ainda não caiu. Com palavras-chave, as compras importadas que casarem abatem a previsão sozinhas; você também pode marcar 'Já caiu' manualmente — numa parcelada, isso tira também as parcelas seguintes, que passam a vir das compras importadas." />
          </h1>
          <button
            type="button"
            onClick={() => setEditando('nova')}
            disabled={!!erro}
            className="tap-scale inline-flex items-center gap-1.5 bg-primary-600 text-white text-sm font-semibold px-3.5 py-2 rounded-xl disabled:opacity-40"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} /> Nova
          </button>
        </div>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content space-y-4">
        {erro && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-300">
            {erro}
          </div>
        )}

        {!erro && dados && (
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-5">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Ainda a cair na fatura</p>
            <p className="text-4xl font-bold num text-gray-900 dark:text-gray-100 mt-1">{formatBRL(totais.pendente)}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 num">
              de {formatBRL(totais.reservado)} previstos em {format(mesAtual, "MMMM 'de' yyyy", { locale: ptBR })}
            </p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {RESPONSAVEIS.map(r => (
                <div key={r} className={`rounded-2xl px-3 py-2 ${RESPONSAVEL_STYLE[r].iconBg}`}>
                  <p className={`text-[11px] font-semibold ${RESPONSAVEL_STYLE[r].texto}`}>{r}</p>
                  <p className="text-sm font-bold num text-gray-800 dark:text-gray-100">{formatBRL(totais.porResp[r].pendente)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!erro && dados && calculadas.length === 0 && (
          <EmptyState
            icon={BookmarkPlus}
            title="Nenhuma compra prevista neste mês"
            description="Cadastre compras que ainda vão cair na fatura para saber quanto realmente sobra para gastar."
          />
        )}

        {!erro && RESPONSAVEIS.map(resp => {
          const itens = calculadas.filter(c => c.reserva.responsavel === resp)
          if (itens.length === 0) return null
          return (
            <div key={resp} className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
              <h2 className={`text-sm font-semibold mb-3 ${RESPONSAVEL_STYLE[resp].texto}`}>{resp}</h2>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {itens.map(c => (
                  <ItemReserva
                    key={c.reserva.id}
                    calc={c}
                    ocupado={ocupado === c.reserva.id}
                    mesRef={mesRef}
                    onBaixa={() => alternarBaixa(c)}
                    onEditar={() => setEditando(c.reserva)}
                    onEncerrar={() => encerrar(c.reserva)}
                    onExcluir={() => excluir(c.reserva)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {editando && (
        <FormReserva
          reserva={editando === 'nova' ? null : editando}
          responsavelPadrao={usuario}
          mesRef={mesRef}
          onClose={() => setEditando(null)}
          onSalvo={recarregar}
        />
      )}
    </div>
  )
}

function ItemReserva({ calc, ocupado, mesRef, onBaixa, onEditar, onEncerrar, onExcluir }: {
  calc: ReservaCalculada
  ocupado: boolean
  mesRef: string
  onBaixa: () => void
  onEditar: () => void
  onEncerrar: () => void
  onExcluir: () => void
}) {
  const { reserva, consumido, compras, baixadaManual, mesBaixa, valorDoMes: valor, parcelaAtual, pendente } = calc
  const parcelada = ehParcelada(reserva)
  const pct = baixadaManual ? 100 : valor > 0 ? Math.min(100, (consumido / valor) * 100) : 0
  const passou = consumido > valor

  return (
    <div className={`py-3 ${ocupado ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${pendente === 0 ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-100'}`}>
            {reserva.descricao}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              {reserva.recorrente ? <Repeat className="w-3 h-3" /> : parcelada ? <Layers className="w-3 h-3" /> : <CalendarCheck className="w-3 h-3" />}
              {reserva.recorrente
                ? reserva.mes_fim ? `Recorrente até ${mesCurto(reserva.mes_fim)}` : 'Recorrente'
                : parcelada ? `Parcela ${parcelaAtual}/${reserva.parcelas}` : 'Pontual'}
            </span>
            {baixadaManual && (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
                {mesBaixa && mesBaixa !== mesRef ? `Já caiu em ${mesCurto(mesBaixa)}` : 'Já caiu'}
              </span>
            )}
            {reserva.palavras_chave && (
              <span className="text-[10px] text-gray-400 truncate max-w-[180px]" title={reserva.palavras_chave}>🔎 {reserva.palavras_chave}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold num text-gray-800 dark:text-gray-100">{formatBRL(pendente)}</p>
          <p className="text-[10px] text-gray-400 num">de {formatBRL(valor)}</p>
          {parcelada && (
            <p className="text-[10px] text-gray-400 num">total {formatBRL(Number(reserva.valor))}</p>
          )}
        </div>
      </div>

      <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mt-2">
        <div className={`h-full rounded-full ${passou ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {consumido > 0 && (
        <p className={`text-[10px] mt-1 num ${passou ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`} title={compras.map(t => `${t.descricao} · ${formatBRL(t.valor)}`).join('\n')}>
          {formatBRL(consumido)} já na fatura ({compras.length} compra{compras.length > 1 ? 's' : ''})
          {passou ? ` · passou ${formatBRL(consumido - valor)} do previsto` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button
          type="button"
          onClick={onBaixa}
          title={parcelada && !baixadaManual ? 'A compra foi feita: tira esta parcela e as seguintes da previsão' : undefined}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
        >
          {baixadaManual ? <><Undo2 className="w-3.5 h-3.5" /> Desfazer</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Já caiu</>}
        </button>
        <button type="button" onClick={onEditar} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          <Pencil className="w-3.5 h-3.5" /> Editar
        </button>
        {reserva.recorrente && reserva.mes_fim !== mesRef && (
          <button type="button" onClick={onEncerrar} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            <StopCircle className="w-3.5 h-3.5" /> Encerrar
          </button>
        )}
        <button type="button" onClick={onExcluir} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500">
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>
      </div>
    </div>
  )
}

function FormReserva({ reserva, responsavelPadrao, mesRef, onClose, onSalvo }: {
  reserva: ReservaFatura | null
  responsavelPadrao: Responsavel
  mesRef: string
  onClose: () => void
  onSalvo: () => Promise<void>
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

  async function salvar(e: FormEvent, close: () => void) {
    e.preventDefault()
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
    await onSalvo()
    close()
  }

  return (
    <BottomSheet onClose={onClose} sheetClassName="max-h-[90vh] overflow-y-auto">
      {(close) => (
        <form onSubmit={(e) => salvar(e, close)} className="p-5 space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{reserva ? 'Editar compra prevista' : 'Nova compra prevista'}</h2>

          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-2xl p-1 gap-0.5">
            {TIPOS.map(t => (
              <button
                key={t.tipo}
                type="button"
                onClick={() => setTipo(t.tipo)}
                className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                  tipo === t.tipo ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-2">
            {tipo === 'recorrente'
              ? `Todo mês a partir de ${mesCurto(mesInicio)}, até você encerrar.`
              : tipo === 'parcelada'
                ? parcelasValidas
                  ? `${nParcelas}x de ${formatBRL(valorNum > 0 ? valorNum / nParcelas : 0)}, de ${mesCurto(mesInicio)} a ${mesCurto(mesUltimaParcela(mesInicio, nParcelas))}.`
                  : `A partir de ${mesCurto(mesInicio)}.`
                : `Só em ${mesCurto(mesInicio)}.`}
          </p>

          <label className="block">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Descrição</span>
            <input
              type="text"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="ex.: Gasolina, Presente da mãe"
              maxLength={80}
              className={`${CAMPO} mt-1`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {tipo === 'parcelada' ? 'Valor total da compra' : tipo === 'recorrente' ? 'Valor por mês' : 'Valor'}
            </span>
            <div className="relative mt-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input
                type="text"
                inputMode="numeric"
                value={valor}
                onChange={e => setValor(mascaraMoeda(e.target.value))}
                placeholder="0,00"
                className={`${CAMPO} pl-10 num`}
              />
            </div>
          </label>

          {tipo === 'parcelada' && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Número de parcelas</span>
              <input
                type="text"
                inputMode="numeric"
                value={parcelas}
                onChange={e => setParcelas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="ex.: 6"
                className={`${CAMPO} mt-1 num`}
              />
            </label>
          )}

          <div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Responsável</span>
            <div className="flex gap-2 mt-1">
              {RESPONSAVEIS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResponsavel(r)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    responsavel === r
                      ? `${RESPONSAVEL_STYLE[r].iconBg} ${RESPONSAVEL_STYLE[r].texto} border-transparent`
                      : 'border-gray-200 dark:border-gray-700 text-gray-500'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Palavras-chave (opcional)</span>
            <input
              type="text"
              value={palavras}
              onChange={e => setPalavras(e.target.value)}
              placeholder="ex.: posto, shell, ipiranga"
              className={`${CAMPO} mt-1`}
            />
            <span className="block text-[11px] text-gray-400 mt-1">
              Separadas por vírgula. Compras da fatura com esses termos na descrição abatem a previsão automaticamente.
            </span>
          </label>

          {erro && <p className="text-xs text-red-500">{erro}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={close} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </BottomSheet>
  )
}
