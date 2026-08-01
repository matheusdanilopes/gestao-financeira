import Papa from 'papaparse'
import { format } from 'date-fns'
import type { RelatorioMensal } from './relatorioMensal'

interface LinhaCsv {
  Tipo: string
  Data: string
  Descrição: string
  Categoria: string
  Responsável: string
  Status: string
  Previsto: string
  Realizado: string
}

function linha(campos: Partial<LinhaCsv> & { Tipo: string }): LinhaCsv {
  return {
    Data: '', Descrição: '', Categoria: '', Responsável: '', Status: '', Previsto: '', Realizado: '',
    ...campos,
  }
}

export function gerarRelatorioCsv(relatorio: RelatorioMensal, mesSelecionado: Date): void {
  const linhas: LinhaCsv[] = []

  for (const r of relatorio.receitas.itens) {
    linhas.push(linha({
      Tipo: 'Receita',
      Descrição: r.item,
      Responsável: r.responsavel,
      Status: r.pago ? 'Recebido' : 'Pendente',
      Previsto: r.valorPrevisto.toFixed(2),
      Realizado: r.valorRecebido.toFixed(2),
    }))
  }
  linhas.push(linha({
    Tipo: 'TOTAL Receitas',
    Previsto: relatorio.receitas.totalPrevisto.toFixed(2),
    Realizado: relatorio.receitas.totalRecebido.toFixed(2),
  }))

  for (const d of relatorio.despesas.itens) {
    linhas.push(linha({
      Tipo: 'Despesa',
      Descrição: d.item,
      Categoria: d.categoria,
      Status: d.status,
      Previsto: d.valorPrevisto.toFixed(2),
      Realizado: d.valorReal !== null ? d.valorReal.toFixed(2) : '',
    }))
  }
  linhas.push(linha({
    Tipo: 'TOTAL Despesas',
    Previsto: relatorio.despesas.totalPrevisto.toFixed(2),
    Realizado: relatorio.despesas.totalReal.toFixed(2),
  }))

  for (const c of relatorio.compras.itens) {
    linhas.push(linha({
      Tipo: 'Compra',
      Data: c.data,
      Descrição: c.descricao,
      Categoria: c.categoria ?? '',
      Responsável: c.responsavel,
      Realizado: c.valor.toFixed(2),
    }))
  }
  linhas.push(linha({ Tipo: 'TOTAL Compras', Realizado: relatorio.compras.total.toFixed(2) }))

  for (const i of relatorio.investimentos.itens) {
    linhas.push(linha({
      Tipo: 'Investimento',
      Descrição: i.descricao,
      Categoria: `${i.percentual}%`,
      Previsto: i.valorPlanejado.toFixed(2),
      Realizado: i.valorAportado.toFixed(2),
    }))
  }
  linhas.push(linha({
    Tipo: 'TOTAL Investimentos',
    Previsto: relatorio.investimentos.totalPlanejado.toFixed(2),
    Realizado: relatorio.investimentos.totalAportado.toFixed(2),
  }))

  linhas.push(linha({ Tipo: 'SALDO PREVISTO', Previsto: relatorio.saldoPrevisto.toFixed(2) }))
  linhas.push(linha({ Tipo: 'SALDO REALIZADO', Realizado: relatorio.saldoRealizado.toFixed(2) }))

  const csv = Papa.unparse(linhas, { delimiter: ';' })
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-${format(mesSelecionado, 'yyyy-MM')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
