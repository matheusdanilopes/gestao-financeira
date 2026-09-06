/**
 * Modelo único de documento de relatório e seus dois exportadores (PDF e CSV).
 *
 * Antes cada relatório tinha um par de arquivos `gerarRelatorio<X>Pdf.ts` /
 * `gerarRelatorio<X>Csv.ts` com o mesmo cabeçalho, a mesma paginação e a mesma
 * rotina de download copiados — qualquer relatório novo nascia com ~250 linhas
 * duplicadas. Agora cada relatório apenas descreve o que quer imprimir
 * (`DocumentoRelatorio`) e ganha PDF, CSV e a tabela da tela de graça.
 *
 * Convenção de célula: `number` é sempre um valor monetário (PDF imprime
 * "R$ 1.234,56" alinhado à direita, CSV imprime "1234.56" para a planilha
 * conseguir somar). Contagens, percentuais e datas entram como `string`.
 */
import { formatBRL } from './format'
import { formatarMesLongo } from './relatoriosFormat'
import { format } from 'date-fns'

export type CelulaRelatorio = string | number

export interface TotalDocumento {
  label: string
  /** Número é formatado como moeda; string é impressa como veio. */
  valor: CelulaRelatorio
}

export interface SecaoDocumento {
  titulo: string
  explicacao?: string
  colunas: string[]
  linhas: CelulaRelatorio[][]
  totais?: TotalDocumento[]
  /** Mensagem exibida quando a seção não tem linhas. */
  vazio?: string
}

export interface DocumentoRelatorio {
  titulo: string
  /** Período coberto — "Setembro 2025", "Últimos 12 meses"… */
  subtitulo?: string
  /** Nome do arquivo baixado, sem extensão. */
  nomeArquivo: string
  /** Cartões de destaque impressos logo abaixo do cabeçalho. */
  resumo?: TotalDocumento[]
  secoes: SecaoDocumento[]
  /** Falhas parciais de carregamento, impressas em destaque. */
  avisos?: string[]
  /** Observação metodológica no fim do documento. */
  notaRodape?: string
  /** Cor do cabeçalho das tabelas no PDF (RGB). */
  corCabecalho?: [number, number, number]
}

const MARGIN_X = 14
const PAGE_HEIGHT = 297 // A4 em mm
const LARGURA_TEXTO = 182
const COR_PADRAO: [number, number, number] = [30, 41, 59]

/** Texto de uma célula na tela e no PDF. */
export function celulaTexto(c: CelulaRelatorio): string {
  return typeof c === 'number' ? formatBRL(c) : c
}

/** Texto de uma célula no CSV: número cru, para a planilha conseguir somar. */
function celulaCsv(c: CelulaRelatorio): string {
  return typeof c === 'number' ? (Number.isFinite(c) ? c.toFixed(2) : '0.00') : c
}

function indicesNumericos(secao: SecaoDocumento): Set<number> {
  const numericos = new Set<number>()
  for (let col = 0; col < secao.colunas.length; col++) {
    const temNumero = secao.linhas.some(l => typeof l[col] === 'number')
    if (temNumero) numericos.add(col)
  }
  return numericos
}

export async function exportarRelatorioPdf(documento: DocumentoRelatorio): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  const corHead = documento.corCabecalho ?? COR_PADRAO
  const geradoEm = format(new Date(), "dd/MM/yyyy 'às' HH:mm")
  let cursorY = 20

  function garantirEspaco(altura: number) {
    if (cursorY + altura > PAGE_HEIGHT - 20) {
      doc.addPage()
      cursorY = 20
    }
  }

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(documento.titulo, MARGIN_X, cursorY)

  if (documento.subtitulo) {
    cursorY += 8
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(90)
    doc.text(documento.subtitulo, MARGIN_X, cursorY)
  }

  cursorY += 6
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90)
  doc.text(`Gerado em ${geradoEm}`, MARGIN_X, cursorY)
  doc.setTextColor(0)
  cursorY += 10

  if (documento.avisos && documento.avisos.length > 0) {
    doc.setFontSize(9)
    doc.setTextColor(180, 60, 0)
    doc.text(`Atenção: ${documento.avisos.join(' ')}`, MARGIN_X, cursorY, { maxWidth: LARGURA_TEXTO })
    doc.setTextColor(0)
    cursorY += 6 + Math.ceil(documento.avisos.join(' ').length / 110) * 5
  }

  if (documento.resumo && documento.resumo.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [documento.resumo.map(r => r.label)],
      body: [documento.resumo.map(r => celulaTexto(r.valor))],
      margin: { left: MARGIN_X, right: MARGIN_X },
      styles: { fontSize: 9, halign: 'center' },
      headStyles: { fillColor: corHead },
    })
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  for (const secao of documento.secoes) {
    garantirEspaco(26)

    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0)
    doc.text(secao.titulo, MARGIN_X, cursorY)
    cursorY += 6

    if (secao.explicacao) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(110)
      doc.text(secao.explicacao, MARGIN_X, cursorY, { maxWidth: LARGURA_TEXTO })
      doc.setTextColor(0)
      doc.setFont('helvetica', 'normal')
      cursorY += 4 + Math.ceil(secao.explicacao.length / 110) * 4.5
    }

    if (secao.linhas.length === 0) {
      doc.setFontSize(10)
      doc.setTextColor(140)
      doc.text(secao.vazio ?? 'Nenhum lançamento neste período.', MARGIN_X, cursorY)
      doc.setTextColor(0)
      cursorY += 10
      continue
    }

    const numericos = indicesNumericos(secao)
    const columnStyles: Record<number, { halign: 'right' }> = {}
    for (const idx of numericos) columnStyles[idx] = { halign: 'right' }

    autoTable(doc, {
      startY: cursorY,
      head: [secao.colunas],
      body: secao.linhas.map(l => l.map(celulaTexto)),
      margin: { left: MARGIN_X, right: MARGIN_X },
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: corHead },
      columnStyles,
    })
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6

    if (secao.totais && secao.totais.length > 0) {
      garantirEspaco(10)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(
        secao.totais.map(t => `${t.label}: ${celulaTexto(t.valor)}`).join('    '),
        MARGIN_X, cursorY,
        { maxWidth: LARGURA_TEXTO },
      )
      doc.setFont('helvetica', 'normal')
      cursorY += 10
    }
  }

  if (documento.notaRodape) {
    garantirEspaco(16)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(110)
    doc.text(documento.notaRodape, MARGIN_X, cursorY, { maxWidth: LARGURA_TEXTO })
    doc.setTextColor(0)
    doc.setFont('helvetica', 'normal')
  }

  doc.save(`${documento.nomeArquivo}.pdf`)
}

export async function exportarRelatorioCsv(documento: DocumentoRelatorio): Promise<void> {
  const Papa = (await import('papaparse')).default

  const matriz: string[][] = []
  matriz.push([documento.titulo])
  if (documento.subtitulo) matriz.push([documento.subtitulo])
  matriz.push([`Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`])

  for (const aviso of documento.avisos ?? []) matriz.push([`Atenção: ${aviso}`])

  if (documento.resumo && documento.resumo.length > 0) {
    matriz.push([])
    matriz.push(['Resumo'])
    matriz.push(documento.resumo.map(r => r.label))
    matriz.push(documento.resumo.map(r => celulaCsv(r.valor)))
  }

  for (const secao of documento.secoes) {
    matriz.push([])
    matriz.push([secao.titulo])
    matriz.push(secao.colunas)
    if (secao.linhas.length === 0) {
      matriz.push([secao.vazio ?? 'Nenhum lançamento neste período.'])
    } else {
      for (const linha of secao.linhas) matriz.push(linha.map(celulaCsv))
    }
    for (const total of secao.totais ?? []) {
      matriz.push([`TOTAL — ${total.label}`, celulaCsv(total.valor)])
    }
  }

  if (documento.notaRodape) {
    matriz.push([])
    matriz.push([documento.notaRodape])
  }

  const csv = Papa.unparse(matriz, { delimiter: ';' })
  // BOM: sem ele o Excel em pt-BR abre "Alimentação" como "AlimentaÃ§Ã£o".
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `${documento.nomeArquivo}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Sufixo padrão de nome de arquivo para relatórios de um mês específico. */
export function sufixoArquivoMes(mes: Date): string {
  return format(mes, 'yyyy-MM')
}

/** Subtítulo padrão para relatórios de um mês específico. */
export function subtituloMes(mes: Date): string {
  return `Período: ${formatarMesLongo(mes)}`
}

// ── Saídas legíveis por outra IA ───────────────────────────────────────────

/**
 * O documento em Markdown — o formato que modelos de linguagem leem melhor:
 * tabelas com cabeçalho, seções nomeadas e a metodologia junto dos números,
 * para a IA não precisar adivinhar o que cada coluna significa.
 */
export function documentoParaMarkdown(documento: DocumentoRelatorio): string {
  const partes: string[] = []

  partes.push(`# ${documento.titulo}`)
  if (documento.subtitulo) partes.push(`_${documento.subtitulo}_`)
  partes.push(`_Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}. Valores em BRL (R$)._`)

  if (documento.avisos && documento.avisos.length > 0) {
    partes.push(`> **Dados incompletos:** ${documento.avisos.join(' ')}`)
  }

  if (documento.resumo && documento.resumo.length > 0) {
    partes.push('## Resumo')
    partes.push(documento.resumo.map(r => `- **${r.label}:** ${celulaTexto(r.valor)}`).join('\n'))
  }

  for (const secao of documento.secoes) {
    partes.push(`## ${secao.titulo}`)
    if (secao.explicacao) partes.push(`_${secao.explicacao}_`)

    if (secao.linhas.length === 0) {
      partes.push(secao.vazio ?? 'Sem lançamentos neste período.')
    } else {
      const cabecalho = `| ${secao.colunas.join(' | ')} |`
      const separador = `| ${secao.colunas.map(() => '---').join(' | ')} |`
      const corpo = secao.linhas
        .map(l => `| ${l.map(c => celulaTexto(c).replace(/\|/g, '\\|')).join(' | ')} |`)
        .join('\n')
      partes.push([cabecalho, separador, corpo].join('\n'))
    }

    if (secao.totais && secao.totais.length > 0) {
      partes.push(secao.totais.map(t => `**${t.label}:** ${celulaTexto(t.valor)}`).join(' · '))
    }
  }

  if (documento.notaRodape) partes.push(`> ${documento.notaRodape}`)

  return partes.join('\n\n')
}

/** O documento como JSON — para quem vai processar por código ou por agente. */
export function documentoParaJson(documento: DocumentoRelatorio): string {
  return JSON.stringify(
    {
      relatorio: documento.titulo,
      periodo: documento.subtitulo ?? null,
      geradoEm: new Date().toISOString(),
      moeda: 'BRL',
      avisos: documento.avisos ?? [],
      resumo: (documento.resumo ?? []).map(r => ({ indicador: r.label, valor: r.valor })),
      secoes: documento.secoes.map(secao => ({
        titulo: secao.titulo,
        metodologia: secao.explicacao ?? null,
        colunas: secao.colunas,
        // Objetos (e não arrays posicionais): a coluna vira o nome do campo,
        // então quem lê o JSON não precisa cruzar índice com cabeçalho.
        linhas: secao.linhas.map(linha =>
          Object.fromEntries(secao.colunas.map((coluna, idx) => [coluna, linha[idx] ?? null])),
        ),
        totais: (secao.totais ?? []).map(t => ({ indicador: t.label, valor: t.valor })),
      })),
      nota: documento.notaRodape ?? null,
    },
    null,
    2,
  )
}

function baixarTexto(conteudo: string, nomeArquivo: string, mime: string): void {
  const blob = new Blob(['﻿' + conteudo], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportarRelatorioMarkdown(documento: DocumentoRelatorio): void {
  baixarTexto(documentoParaMarkdown(documento), `${documento.nomeArquivo}.md`, 'text/markdown')
}

export function exportarRelatorioJson(documento: DocumentoRelatorio): void {
  baixarTexto(documentoParaJson(documento), `${documento.nomeArquivo}.json`, 'application/json')
}

/**
 * Copia texto para a área de transferência.
 *
 * `navigator.clipboard` não existe em contexto não seguro nem em parte dos
 * navegadores in-app (o app roda como PWA e é aberto por links de mensageiro),
 * então há o caminho antigo com textarea + execCommand antes de desistir.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // cai no fallback
  }

  try {
    const area = document.createElement('textarea')
    area.value = texto
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
