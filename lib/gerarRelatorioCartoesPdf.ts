import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatBRL } from './logger'
import { RELATORIO_CARTOES_EXPLICACOES, type RelatorioCartoes, type MesGasto } from './relatorioCartoes'

const MARGIN_X = 14
const PAGE_HEIGHT = 297 // A4 em mm

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatarMes(mes: Date): string {
  return capitalizar(format(mes, 'MMM/yyyy', { locale: ptBR }))
}

function linhasMesGasto(meses: MesGasto[]): (string | number)[][] {
  return meses.map(m => [formatarMes(m.mes), formatBRL(m.total), formatBRL(m.matheus), formatBRL(m.jeniffer), formatBRL(m.conjunto)])
}

export async function gerarRelatorioCartoesPdf(relatorio: RelatorioCartoes): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  const geradoEm = format(new Date(), "dd/MM/yyyy 'às' HH:mm")

  let cursorY = 20

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Relatório de Gastos no Cartão', MARGIN_X, cursorY)

  cursorY += 8
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90)
  doc.text(`Gerado em ${geradoEm}`, MARGIN_X, cursorY)
  doc.setTextColor(0)

  cursorY += 10

  if (relatorio.erros.length > 0) {
    doc.setFontSize(9)
    doc.setTextColor(180, 60, 0)
    doc.text(`Atenção: ${relatorio.erros.join(' ')}`, MARGIN_X, cursorY, { maxWidth: 180 })
    doc.setTextColor(0)
    cursorY += 10
  }

  function garantirEspaco(alturaNecessaria: number) {
    if (cursorY + alturaNecessaria > PAGE_HEIGHT - 20) {
      doc.addPage()
      cursorY = 20
    }
  }

  function desenharSecao(
    titulo: string,
    explicacao: string,
    head: string[],
    rows: (string | number)[][],
  ) {
    garantirEspaco(24)

    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0)
    doc.text(titulo, MARGIN_X, cursorY)
    cursorY += 6

    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(110)
    doc.text(explicacao, MARGIN_X, cursorY, { maxWidth: 180 })
    doc.setTextColor(0)
    doc.setFont('helvetica', 'normal')
    cursorY += 8

    if (rows.length === 0) {
      doc.setFontSize(10)
      doc.setTextColor(140)
      doc.text('Nenhum lançamento neste período.', MARGIN_X, cursorY)
      doc.setTextColor(0)
      cursorY += 10
      return
    }

    autoTable(doc, {
      startY: cursorY,
      head: [head],
      body: rows,
      margin: { left: MARGIN_X, right: MARGIN_X },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [76, 29, 149] },
    })

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  }

  const totalHistorico = relatorio.historico.reduce((acc, m) => acc + m.total, 0)
  desenharSecao(
    'Histórico de Gastos (últimos 12 meses)',
    RELATORIO_CARTOES_EXPLICACOES.historico,
    ['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto'],
    linhasMesGasto(relatorio.historico),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Total 12 meses: ${formatBRL(totalHistorico)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')
  cursorY += 12

  const totalProjecao = relatorio.projecao.reduce((acc, m) => acc + m.total, 0)
  desenharSecao(
    'Projeção de Parcelamentos (próximos 12 meses)',
    RELATORIO_CARTOES_EXPLICACOES.projecao,
    ['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto'],
    linhasMesGasto(relatorio.projecao),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Total projetado 12 meses: ${formatBRL(totalProjecao)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')
  cursorY += 12

  const totalRestante = relatorio.parcelamentosAbertos.reduce((acc, p) => acc + p.valorRestante, 0)
  desenharSecao(
    'Parcelamentos em Aberto',
    RELATORIO_CARTOES_EXPLICACOES.parcelamentosAbertos,
    ['Descrição', 'Responsável', 'Origem', 'Parcela', 'Restam', 'Valor restante', 'Término'],
    relatorio.parcelamentosAbertos.map(p => [
      p.descricao,
      p.responsavel,
      p.origem,
      `${p.parcelaAtual}/${p.totalParcelas}`,
      p.parcelasRestantes,
      formatBRL(p.valorRestante),
      formatarMes(p.mesTermino),
    ]),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Valor total restante em aberto: ${formatBRL(totalRestante)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')

  doc.save(`relatorio-cartoes-${format(new Date(), 'yyyy-MM')}.pdf`)
}
