import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatBRL } from './logger'
import { RELATORIO_EXPLICACOES, type RelatorioMensal } from './relatorioMensal'

const MARGIN_X = 14
const PAGE_HEIGHT = 297 // A4 em mm

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatarData(iso: string): string {
  if (!iso) return ''
  try {
    return format(new Date(`${iso}T00:00:00`), 'dd/MM/yyyy')
  } catch {
    return iso
  }
}

export async function gerarRelatorioPdf(relatorio: RelatorioMensal, mesSelecionado: Date): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  const periodo = capitalizar(format(mesSelecionado, 'MMMM yyyy', { locale: ptBR }))
  const geradoEm = format(new Date(), "dd/MM/yyyy 'às' HH:mm")

  let cursorY = 20

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Relatório Gerencial Mensal', MARGIN_X, cursorY)

  cursorY += 8
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90)
  doc.text(`Período: ${periodo}`, MARGIN_X, cursorY)

  cursorY += 6
  doc.setFontSize(9)
  doc.text(`Gerado em ${geradoEm}`, MARGIN_X, cursorY)
  doc.setTextColor(0)

  cursorY += 10

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
      doc.text('Nenhum lançamento neste mês.', MARGIN_X, cursorY)
      doc.setTextColor(0)
      cursorY += 10
      return
    }

    autoTable(doc, {
      startY: cursorY,
      head: [head],
      body: rows,
      margin: { left: MARGIN_X, right: MARGIN_X },
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
    })

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  }

  desenharSecao(
    'Receitas',
    RELATORIO_EXPLICACOES.receitas,
    ['Item', 'Responsável', 'Valor'],
    relatorio.receitas.itens.map(i => [i.item, i.responsavel, formatBRL(i.valor)]),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Total Receitas: ${formatBRL(relatorio.receitas.total)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')
  cursorY += 12

  desenharSecao(
    'Despesas',
    RELATORIO_EXPLICACOES.despesas,
    ['Item', 'Categoria', 'Status', 'Valor'],
    relatorio.despesas.itens.map(i => [i.item, i.categoria, i.status, formatBRL(i.valor)]),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Total Despesas: ${formatBRL(relatorio.despesas.total)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')
  cursorY += 12

  desenharSecao(
    'Compras',
    RELATORIO_EXPLICACOES.compras,
    ['Data', 'Descrição', 'Responsável', 'Categoria', 'Valor'],
    relatorio.compras.itens.map(i => [formatarData(i.data), i.descricao, i.responsavel, i.categoria ?? '', formatBRL(i.valor)]),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Total Compras: ${formatBRL(relatorio.compras.total)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')
  cursorY += 12

  desenharSecao(
    'Investimentos',
    RELATORIO_EXPLICACOES.investimentos,
    ['Data', 'Descrição', 'Observação', 'Valor'],
    relatorio.investimentos.itens.map(i => [formatarData(i.data), i.descricao, i.observacao ?? '', formatBRL(i.valor)]),
  )
  garantirEspaco(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`Total Investimentos: ${formatBRL(relatorio.investimentos.total)}`, MARGIN_X, cursorY)
  doc.setFont('helvetica', 'normal')
  cursorY += 14

  garantirEspaco(40)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumo', MARGIN_X, cursorY)
  cursorY += 7

  doc.setFontSize(11)
  doc.text(`Saldo do mês (valores realizados): ${formatBRL(relatorio.saldoMes)}`, MARGIN_X, cursorY)
  cursorY += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(
    'Compras já estão refletidas na fatura do cartão em Despesas. Investimentos representam valores destinados a partir do saldo do mês.',
    MARGIN_X,
    cursorY,
    { maxWidth: 180 },
  )
  doc.setTextColor(0)
  cursorY += 12

  autoTable(doc, {
    startY: cursorY,
    head: [['Receitas', 'Despesas', 'Compras', 'Investimentos']],
    body: [[
      formatBRL(relatorio.receitas.total),
      formatBRL(relatorio.despesas.total),
      formatBRL(relatorio.compras.total),
      formatBRL(relatorio.investimentos.total),
    ]],
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 10, halign: 'center' },
    headStyles: { fillColor: [30, 41, 59] },
  })

  doc.save(`relatorio-${format(mesSelecionado, 'yyyy-MM')}.pdf`)
}
