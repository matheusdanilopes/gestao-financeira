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
  Valor: string
}

function linha(campos: Partial<LinhaCsv> & { Tipo: string }): LinhaCsv {
  return {
    Data: '', Descrição: '', Categoria: '', Responsável: '', Status: '', Valor: '',
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
      Valor: r.valor.toFixed(2),
    }))
  }
  linhas.push(linha({ Tipo: 'TOTAL Receitas', Valor: relatorio.receitas.total.toFixed(2) }))

  for (const d of relatorio.despesas.itens) {
    linhas.push(linha({
      Tipo: 'Despesa',
      Descrição: d.item,
      Categoria: d.categoria,
      Status: d.status,
      Valor: d.valor.toFixed(2),
    }))
  }
  linhas.push(linha({ Tipo: 'TOTAL Despesas', Valor: relatorio.despesas.total.toFixed(2) }))

  for (const c of relatorio.compras.itens) {
    linhas.push(linha({
      Tipo: 'Compra',
      Data: c.data,
      Descrição: c.descricao,
      Categoria: c.categoria ?? '',
      Responsável: c.responsavel,
      Valor: c.valor.toFixed(2),
    }))
  }
  linhas.push(linha({ Tipo: 'TOTAL Compras', Valor: relatorio.compras.total.toFixed(2) }))

  for (const i of relatorio.investimentos.itens) {
    linhas.push(linha({
      Tipo: 'Investimento',
      Data: i.data,
      Descrição: i.descricao,
      Categoria: i.observacao ?? '',
      Valor: i.valor.toFixed(2),
    }))
  }
  linhas.push(linha({ Tipo: 'TOTAL Investimentos', Valor: relatorio.investimentos.total.toFixed(2) }))

  linhas.push(linha({ Tipo: 'SALDO DO MÊS', Valor: relatorio.saldoMes.toFixed(2) }))

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
