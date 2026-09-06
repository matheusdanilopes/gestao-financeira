'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Search } from 'lucide-react'
import { celulaTexto, type CelulaRelatorio, type TotalDocumento } from '@/lib/relatorioDocumento'
import { InfoPopover } from '@/components/InfoPopover'

const LIMITE_PADRAO = 8

export interface SecaoRelatorioProps {
  titulo: string
  /** Metodologia da seção — vira o popover de ajuda no título. */
  explicacao?: string
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  corIcone: string
  corFundo: string
  colunas: string[]
  linhas: CelulaRelatorio[][]
  totais?: TotalDocumento[]
  /** Mostra o campo de busca quando a seção costuma ter muitas linhas. */
  busca?: boolean
  /** Linhas exibidas antes do "ver todas". `0` desativa o corte. */
  limiteInicial?: number
  vazio?: string
  /** Conteúdo extra logo abaixo do cabeçalho (filtros, chips, gráfico). */
  children?: React.ReactNode
  /** Personaliza a renderização de uma célula (badges, cores). */
  renderCelula?: (valor: CelulaRelatorio, colIdx: number, linha: CelulaRelatorio[]) => React.ReactNode
}

/**
 * Card de seção usado por todos os relatórios: tabela ordenável, busca,
 * corte de linhas com "ver todas" e rodapé de totais.
 *
 * As colunas cujo conteúdo é numérico são detectadas e alinhadas à direita
 * automaticamente — a mesma convenção do PDF/CSV (lib/relatorioDocumento.ts),
 * então tela e arquivo exportado nunca divergem.
 */
export default function SecaoRelatorio({
  titulo, explicacao, Icon, corIcone, corFundo,
  colunas, linhas, totais, busca = false, limiteInicial = LIMITE_PADRAO,
  vazio = 'Nenhum lançamento neste período.', children, renderCelula,
}: SecaoRelatorioProps) {
  const [ordem, setOrdem] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null)
  const [termo, setTermo] = useState('')
  const [expandido, setExpandido] = useState(false)

  const colunasNumericas = useMemo(() => {
    const set = new Set<number>()
    for (let col = 0; col < colunas.length; col++) {
      if (linhas.some(l => typeof l[col] === 'number')) set.add(col)
    }
    return set
  }, [colunas, linhas])

  const filtradas = useMemo(() => {
    const alvo = termo.trim().toLowerCase()
    if (!alvo) return linhas
    return linhas.filter(l => l.some(c => celulaTexto(c).toLowerCase().includes(alvo)))
  }, [linhas, termo])

  const ordenadas = useMemo(() => {
    if (!ordem) return filtradas
    const { col, dir } = ordem
    const fator = dir === 'asc' ? 1 : -1
    return [...filtradas].sort((a, b) => {
      const va = a[col]
      const vb = b[col]
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * fator
      return celulaTexto(va).localeCompare(celulaTexto(vb), 'pt-BR', { numeric: true }) * fator
    })
  }, [filtradas, ordem])

  const cortar = limiteInicial > 0 && !expandido && ordenadas.length > limiteInicial
  const visiveis = cortar ? ordenadas.slice(0, limiteInicial) : ordenadas

  function alternarOrdem(col: number) {
    setOrdem(atual => {
      if (!atual || atual.col !== col) return { col, dir: colunasNumericas.has(col) ? 'desc' : 'asc' }
      if (atual.dir === 'desc') return { col, dir: 'asc' }
      return null
    })
  }

  return (
    <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl ${corFundo} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${corIcone}`} strokeWidth={1.8} />
        </div>
        <h2 className="font-bold text-gray-900 flex-1 min-w-0 tracking-tight">{titulo}</h2>
        {explicacao && <InfoPopover texto={explicacao} />}
      </div>

      {children}

      {busca && linhas.length > LIMITE_PADRAO && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={termo}
            onChange={e => setTermo(e.target.value)}
            placeholder="Buscar nesta seção…"
            aria-label={`Buscar em ${titulo}`}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 border border-gray-100
                       text-xs text-gray-700 placeholder:text-gray-400
                       focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>
      )}

      {ordenadas.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">{termo ? 'Nenhum resultado para a busca.' : vazio}</p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="text-gray-400 text-left">
                  {colunas.map((c, idx) => {
                    const ativo = ordem?.col === idx
                    return (
                      <th
                        key={c}
                        scope="col"
                        className={`font-semibold py-1.5 px-1 whitespace-nowrap ${colunasNumericas.has(idx) ? 'text-right' : 'text-left'}`}
                      >
                        <button
                          type="button"
                          onClick={() => alternarOrdem(idx)}
                          aria-label={`Ordenar por ${c}`}
                          className={`inline-flex items-center gap-1 rounded-md px-0.5 -mx-0.5
                                      hover:text-gray-600 transition-colors
                                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300
                                      ${ativo ? 'text-primary-600' : ''}`}
                        >
                          {c}
                          {ativo && (ordem.dir === 'asc'
                            ? <ArrowUp className="w-3 h-3" strokeWidth={2.4} />
                            : <ArrowDown className="w-3 h-3" strokeWidth={2.4} />)}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((linha, idx) => (
                  <tr key={idx} className="border-t border-gray-50">
                    {linha.map((valor, colIdx) => (
                      <td
                        key={colIdx}
                        className={`py-1.5 px-1 text-gray-700 whitespace-nowrap
                                    ${colunasNumericas.has(colIdx) ? 'text-right num' : ''}`}
                      >
                        {renderCelula ? renderCelula(valor, colIdx, linha) : celulaTexto(valor)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(cortar || expandido) && ordenadas.length > limiteInicial && (
            <button
              type="button"
              onClick={() => setExpandido(v => !v)}
              className="w-full py-2 rounded-xl text-xs font-semibold text-primary-600
                         bg-primary-50/60 hover:bg-primary-50 transition-colors
                         flex items-center justify-center gap-1.5
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
              {expandido ? 'Mostrar menos' : `Ver todas as ${ordenadas.length} linhas`}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandido ? 'rotate-180' : ''}`} />
            </button>
          )}
        </>
      )}

      {totais && totais.length > 0 && (
        <div className="flex justify-between items-center pt-2 border-t border-gray-100 flex-wrap gap-x-4 gap-y-1">
          {totais.map(t => (
            <div key={t.label} className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-gray-500">{t.label}</span>
              <span className="font-bold text-gray-900 num">{celulaTexto(t.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
