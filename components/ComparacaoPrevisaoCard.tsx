'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowRight, Check, ChevronDown, ChevronUp, Info, Scale, Undo2, UserRoundCog } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { estiloResponsavel, RESPONSAVEIS } from '@/lib/responsavelStyle'
import type { ComparacaoPrevisaoFatura, MudancaResponsavel } from '@/lib/comparacaoPrevisao'

const NOME_CARTAO: Record<string, string> = { nubank: 'NuBank', cartao1: 'Cartão 1', cartao2: 'Cartão 2' }

function mesFatura(iso: string): string {
  return format(new Date(iso.substring(0, 10) + 'T12:00:00'), 'MMM/yyyy', { locale: ptBR })
}

function Diferenca({ valor }: { valor: number }) {
  if (Math.abs(valor) < 0.01) return <span className="text-gray-400">=</span>
  return (
    <span className={valor > 0 ? 'text-red-600' : 'text-green-600'}>
      {valor > 0 ? '+' : '−'}{formatBRL(Math.abs(valor))}
    </span>
  )
}

function Secao({ titulo, quantidade, destaque, abertaInicial, children }: {
  titulo: string
  quantidade: number
  destaque?: boolean
  abertaInicial?: boolean
  children: React.ReactNode
}) {
  const [aberta, setAberta] = useState(!!abertaInicial)
  if (quantidade === 0) return null
  return (
    <div className={`rounded-xl border ${destaque ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100 bg-gray-50/60'}`}>
      <button
        onClick={() => setAberta(a => !a)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-700"
      >
        <span>{titulo} <span className={destaque ? 'text-amber-700' : 'text-gray-400'}>({quantidade})</span></span>
        {aberta ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {aberta && <div className="px-3 pb-2 space-y-1.5">{children}</div>}
    </div>
  )
}

function ItemMudancaResponsavel({ m, ocupado, erro, onResolver }: {
  m: MudancaResponsavel
  ocupado: boolean
  erro?: string
  onResolver: (acao: 'corrigir' | 'manter') => void
}) {
  return (
    <div className="rounded-lg bg-white border border-amber-100 p-2 space-y-1.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-gray-800 font-medium">{m.descricao}</p>
          <p className="text-[10px] text-gray-400">Parcela {m.parcela} · {formatBRL(m.valor)}</p>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 font-semibold">
          <span className={`px-1.5 py-0.5 rounded ${estiloResponsavel(m.de).badge}`}>{m.de}</span>
          <ArrowRight className="w-3 h-3 text-gray-400" />
          <span className={`px-1.5 py-0.5 rounded ${estiloResponsavel(m.para).badge}`}>{m.para}</span>
        </span>
      </div>

      {m.motivo && (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-600 leading-snug">
          <Info className="w-3.5 h-3.5 mt-px shrink-0 text-amber-500" />
          <span><strong className="text-gray-700">Por quê:</strong> {m.motivo.texto}</span>
        </p>
      )}

      {m.resolucao ? (
        <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
          <Check className="w-3.5 h-3.5" />
          {m.resolucao.acao === 'corrigida'
            ? `Corrigido para ${m.resolucao.responsavel} — as próximas parcelas seguem este responsável.`
            : `Mantido em ${m.resolucao.responsavel}.`}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button
            disabled={ocupado}
            onClick={() => onResolver('corrigir')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50 transition"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Voltar para {m.de}
          </button>
          <button
            disabled={ocupado}
            onClick={() => onResolver('manter')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-50 transition"
          >
            Manter {m.para}
          </button>
        </div>
      )}
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
    </div>
  )
}

export default function ComparacaoPrevisaoCard({ comparacao: inicial, logId }: { comparacao: ComparacaoPrevisaoFatura; logId: string }) {
  const [c, setC] = useState(inicial)
  const [ocupadoId, setOcupadoId] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})

  async function resolver(transacaoId: string, acao: 'corrigir' | 'manter') {
    setOcupadoId(transacaoId)
    setErros(e => { const { [transacaoId]: _omit, ...resto } = e; return resto })
    try {
      const res = await fetch(`/api/nubank/atividades/${logId}/comparacao`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fatura: c.fatura, cartao: c.cartao, transacaoId, acao }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setC(data.comparacao)
    } catch (err) {
      setErros(e => ({ ...e, [transacaoId]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setOcupadoId(null)
    }
  }

  const pendentes = c.mudancasResponsavel.filter(m => !m.resolucao)
  const responsaveis = Array.from(new Set([
    ...Object.keys(c.previsto.porResponsavel),
    ...Object.keys(c.realizado.porResponsavel),
  ])).sort((a, b) => {
    const ia = RESPONSAVEIS.indexOf(a as typeof RESPONSAVEIS[number])
    const ib = RESPONSAVEIS.indexOf(b as typeof RESPONSAVEIS[number])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'pt-BR')
  })

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="p-1.5 rounded-lg bg-primary-50 text-primary-600 shrink-0">
          <Scale className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-800">
            Previsão × importado · fatura {mesFatura(c.fatura)}
            <span className="font-normal text-gray-400"> · {NOME_CARTAO[c.cartao] ?? c.cartao}</span>
          </p>
          <p className="text-[11px] text-gray-500 leading-snug">
            Primeira importação desta fatura. Previsto = parcelas projetadas a partir da fatura de {mesFatura(c.faturaBase)}.
          </p>
        </div>
      </div>

      {pendentes.length > 0 ? (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <UserRoundCog className="w-4 h-4 shrink-0" />
          <span><strong>{pendentes.length}</strong> parcela(s) mudaram de responsável em relação à previsão — confira abaixo.</span>
        </div>
      ) : (
        <div className="rounded-xl bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-700">
          {c.mudancasResponsavel.length > 0
            ? 'Todas as mudanças de responsável foram conferidas.'
            : 'Nenhuma parcela prevista mudou de responsável.'}
        </div>
      )}

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-[300px]">
          <thead>
            <tr className="text-gray-400 text-[10px] uppercase tracking-wide">
              <th className="text-left font-semibold px-1 py-1">Responsável</th>
              <th className="text-right font-semibold px-1 py-1">Previsto</th>
              <th className="text-right font-semibold px-1 py-1">Importado</th>
              <th className="text-right font-semibold px-1 py-1">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {responsaveis.map(r => {
              const previsto = c.previsto.porResponsavel[r] ?? 0
              const realizado = c.realizado.porResponsavel[r] ?? 0
              const parcelas = c.parcelasRealizadas.porResponsavel[r] ?? 0
              const novas = c.foraDaPrevisao.porResponsavel[r] ?? 0
              return (
                <tr key={r} className="border-t border-gray-50 align-top">
                  <td className="px-1 py-1.5">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-gray-700">
                      <span className={`w-2 h-2 rounded-full ${estiloResponsavel(r).ponto}`} />
                      {r}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right text-gray-600 tabular-nums">{formatBRL(previsto)}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">
                    <div className="font-semibold text-gray-800">{formatBRL(realizado)}</div>
                    <div className="text-[10px] text-gray-400 whitespace-nowrap">
                      parcelas {formatBRL(parcelas)} · novas {formatBRL(novas)}
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-semibold"><Diferenca valor={realizado - previsto} /></td>
                </tr>
              )
            })}
            <tr className="border-t border-gray-200">
              <td className="px-1 py-1.5 font-bold text-gray-800">Total</td>
              <td className="px-1 py-1.5 text-right text-gray-700 font-semibold tabular-nums">{formatBRL(c.previsto.total)}</td>
              <td className="px-1 py-1.5 text-right tabular-nums">
                <div className="font-bold text-gray-900">{formatBRL(c.realizado.total)}</div>
                <div className="text-[10px] text-gray-400 whitespace-nowrap">
                  parcelas {formatBRL(c.parcelasRealizadas.total)} · novas {formatBRL(c.foraDaPrevisao.total)}
                </div>
              </td>
              <td className="px-1 py-1.5 text-right tabular-nums font-bold"><Diferenca valor={c.realizado.total - c.previsto.total} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">{c.parcelasConfirmadas} parcela(s) iguais à previsão</span>
        <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-100">{c.foraDaPrevisao.quantidade} compra(s) fora da previsão</span>
      </div>

      <div className="space-y-2">
        <Secao titulo="Mudaram de responsável" quantidade={c.mudancasResponsavel.length} destaque={pendentes.length > 0} abertaInicial={pendentes.length > 0}>
          {c.mudancasResponsavel.map(m => (
            <ItemMudancaResponsavel
              key={m.transacaoId}
              m={m}
              ocupado={ocupadoId === m.transacaoId}
              erro={erros[m.transacaoId]}
              onResolver={acao => resolver(m.transacaoId, acao)}
            />
          ))}
        </Secao>

        <Secao titulo="Valor diferente do previsto" quantidade={c.mudancasValor.length}>
          {c.mudancasValor.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="truncate text-gray-800">{m.descricao}</p>
                <p className="text-[10px] text-gray-400">Parcela {m.parcela} · {m.responsavel}</p>
              </div>
              <span className="shrink-0 tabular-nums text-gray-600">
                {formatBRL(m.previsto)} <ArrowRight className="inline w-3 h-3 text-gray-400" /> <strong className="text-gray-800">{formatBRL(m.realizado)}</strong>
              </span>
            </div>
          ))}
        </Secao>

        <Secao titulo="Previstas que não vieram na fatura" quantidade={c.parcelasNaoVieram.length}>
          {c.parcelasNaoVieram.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="truncate text-gray-800">{m.descricao}</p>
                <p className="text-[10px] text-gray-400">Parcela {m.parcela} · {m.responsavel}</p>
              </div>
              <span className="shrink-0 tabular-nums text-gray-600">{formatBRL(m.valor)}</span>
            </div>
          ))}
        </Secao>
      </div>
    </div>
  )
}
