import Papa from 'papaparse'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { RelatorioCartoes, MesGasto } from './relatorioCartoes'

interface LinhaCsv {
  Tipo: string
  'Mês/Descrição': string
  Responsável: string
  Total: string
  Matheus: string
  Jeniffer: string
  Conjunto: string
  ParcelasRestantes: string
  Término: string
}

function linha(campos: Partial<LinhaCsv> & { Tipo: string }): LinhaCsv {
  return {
    'Mês/Descrição': '', Responsável: '', Total: '', Matheus: '', Jeniffer: '', Conjunto: '', ParcelasRestantes: '', Término: '',
    ...campos,
  }
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatarMes(mes: Date): string {
  return capitalizar(format(mes, 'MMM/yyyy', { locale: ptBR }))
}

function linhasMesGasto(tipo: string, meses: MesGasto[]): LinhaCsv[] {
  return meses.map(m => linha({
    Tipo: tipo,
    'Mês/Descrição': formatarMes(m.mes),
    Total: m.total.toFixed(2),
    Matheus: m.matheus.toFixed(2),
    Jeniffer: m.jeniffer.toFixed(2),
    Conjunto: m.conjunto.toFixed(2),
  }))
}

export function gerarRelatorioCartoesCsv(relatorio: RelatorioCartoes): void {
  const linhas: LinhaCsv[] = []

  linhas.push(...linhasMesGasto('Histórico', relatorio.historico))
  linhas.push(linha({
    Tipo: 'TOTAL Histórico',
    Total: relatorio.historico.reduce((acc, m) => acc + m.total, 0).toFixed(2),
    Matheus: relatorio.historico.reduce((acc, m) => acc + m.matheus, 0).toFixed(2),
    Jeniffer: relatorio.historico.reduce((acc, m) => acc + m.jeniffer, 0).toFixed(2),
    Conjunto: relatorio.historico.reduce((acc, m) => acc + m.conjunto, 0).toFixed(2),
  }))

  linhas.push(...linhasMesGasto('Projeção', relatorio.projecao))
  linhas.push(linha({
    Tipo: 'TOTAL Projeção',
    Total: relatorio.projecao.reduce((acc, m) => acc + m.total, 0).toFixed(2),
    Matheus: relatorio.projecao.reduce((acc, m) => acc + m.matheus, 0).toFixed(2),
    Jeniffer: relatorio.projecao.reduce((acc, m) => acc + m.jeniffer, 0).toFixed(2),
    Conjunto: relatorio.projecao.reduce((acc, m) => acc + m.conjunto, 0).toFixed(2),
  }))

  for (const p of relatorio.parcelamentosAbertos) {
    linhas.push(linha({
      Tipo: 'Parcelamento aberto',
      'Mês/Descrição': p.descricao,
      Responsável: p.responsavel,
      Total: p.valorRestante.toFixed(2),
      ParcelasRestantes: `${p.parcelasRestantes}`,
      Término: formatarMes(p.mesTermino),
    }))
  }
  linhas.push(linha({
    Tipo: 'TOTAL Parcelamentos em Aberto',
    Total: relatorio.parcelamentosAbertos.reduce((acc, p) => acc + p.valorRestante, 0).toFixed(2),
  }))

  const csv = Papa.unparse(linhas, { delimiter: ';' })
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-cartoes-${format(new Date(), 'yyyy-MM')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
