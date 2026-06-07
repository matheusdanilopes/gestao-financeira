/**
 * Financial Validation Engine
 *
 * Mandatory gateway between raw financial data and the AI.
 * No data reaches the AI without passing through this layer.
 *
 * Responsibilities:
 *  - Remove duplicate transactions
 *  - Exclude card-payment entries (not expenses)
 *  - Flag investment redemptions (not operational income)
 *  - Detect installment double-counting
 *  - Detect statistical anomalies
 *  - Validate mathematical consistency
 *  - Issue a reliability certificate (0–100%) for every dataset
 *
 * RN11 – RN20 / CA01 – CA06
 */

import type {
  EnrichedData,
  Transacao,
  ValidationIssue,
  ValidationCertificate,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizarDescricao(desc: string): string {
  return (desc ?? '')
    .toLowerCase()
    .replace(/[^a-záéíóúâêîôûàãõç\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

const R = (v: number) => `R$ ${Math.abs(v).toFixed(2).replace('.', ',')}`

// ─── 1. Duplicate detection (RN14, CA01) ─────────────────────────────────────

function detectarDuplicatas(transacoes: Transacao[]): {
  excluirIndices: Set<number>
  issues: ValidationIssue[]
} {
  const seen = new Map<string, number>()
  const excluirIndices = new Set<number>()
  const issues: ValidationIssue[] = []
  const jaReportados = new Set<string>()

  for (let i = 0; i < transacoes.length; i++) {
    const t = transacoes[i]
    const key = `${normalizarDescricao(t.descricao)}|${t.valor}|${t.data}|${t.responsavel}`
    if (seen.has(key)) {
      excluirIndices.add(i)
      if (!jaReportados.has(key)) {
        jaReportados.add(key)
        issues.push({
          type: 'duplicate',
          severity: 'warning',
          descricao: `Duplicata removida: "${t.descricao}" (${t.responsavel}) — ${R(t.valor)} em ${t.data}`,
          valor: t.valor,
          transacoes: [t.descricao],
        })
      }
    } else {
      seen.set(key, i)
    }
  }

  return { excluirIndices, issues }
}

// ─── 2. Card payment exclusion (RN16, CA02) ──────────────────────────────────
// Bill payments are financial settlements, not new expenses.

const PAGAMENTO_CARTAO_PATTERNS = [
  /pagamento\s*(de\s*)?(fatura|cartão|cartao)/i,
  /pagto\s*(fatura|cartão|cartao)/i,
  /pag\.?\s*(fat\.?|fatura)/i,
  /payment\s*(credit|card)/i,
  /bill\s*payment/i,
]

function detectarPagamentosCartao(transacoes: Transacao[]): {
  excluirIndices: Set<number>
  issues: ValidationIssue[]
} {
  const excluirIndices = new Set<number>()
  const issues: ValidationIssue[] = []

  for (let i = 0; i < transacoes.length; i++) {
    const t = transacoes[i]
    if (PAGAMENTO_CARTAO_PATTERNS.some(p => p.test(t.descricao))) {
      excluirIndices.add(i)
      issues.push({
        type: 'card_payment',
        severity: 'warning',
        descricao: `Pagamento de fatura excluído dos gastos: "${t.descricao}" — ${R(t.valor)}`,
        valor: t.valor,
        transacoes: [t.descricao],
      })
    }
  }

  return { excluirIndices, issues }
}

// ─── 3. Investment redemption — informational (RN17) ─────────────────────────
// Redemptions are patrimonial movements, not operational income.

const RESGATE_PATTERNS = [
  /resgate\s*(de\s*)?(investimento|aplicação|aplicacao|fundo)/i,
  /retirada\s*(de\s*)?(investimento|aplicação|aplicacao)/i,
  /liquidação\s*(de\s*)?(investimento|aplicação)/i,
  /transferência\s*(de\s*)?corretora/i,
]

function detectarResgatesInvestimentos(transacoes: Transacao[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const t of transacoes) {
    if (RESGATE_PATTERNS.some(p => p.test(t.descricao))) {
      issues.push({
        type: 'investment_redemption',
        severity: 'warning',
        descricao: `Resgate/movimentação patrimonial: "${t.descricao}" — ${R(t.valor)} (não contabilizado como despesa operacional)`,
        valor: t.valor,
        transacoes: [t.descricao],
      })
    }
  }

  return issues
}

// ─── 6. Installment double-count detection (RN req: parcelamentos) ────────────
// Detects when both the full purchase total and individual installment entries
// exist for the same item, which would inflate the computed totals.

function detectarDuplaContagemParcelamentos(transacoes: Transacao[]): {
  excluirIndices: Set<number>
  issues: ValidationIssue[]
} {
  const excluirIndices = new Set<number>()
  const issues: ValidationIssue[] = []

  const byDesc = new Map<string, Array<{ t: Transacao; idx: number }>>()
  for (let i = 0; i < transacoes.length; i++) {
    const key = normalizarDescricao(transacoes[i].descricao)
    if (!byDesc.has(key)) byDesc.set(key, [])
    byDesc.get(key)!.push({ t: transacoes[i], idx: i })
  }

  for (const [, group] of byDesc) {
    if (group.length < 2) continue

    const singles  = group.filter(({ t }) => !t.total_parcelas || t.total_parcelas <= 1)
    const parcelas = group.filter(({ t }) => (t.total_parcelas ?? 0) > 1)

    if (singles.length === 0 || parcelas.length === 0) continue

    const totalParcelas = parcelas[0].t.total_parcelas ?? 1
    const valorParcela  = parcelas[0].t.valor
    const valorTotal    = valorParcela * totalParcelas
    const valorSingles  = singles.reduce((s, { t }) => s + t.valor, 0)

    // Tolerance: within 5% implies the single entry IS the full amount
    if (valorTotal > 0 && Math.abs(valorSingles - valorTotal) / valorTotal < 0.05) {
      for (const { idx } of singles) excluirIndices.add(idx)
      issues.push({
        type: 'installment_double_count',
        severity: 'critical',
        descricao: `Dupla contagem evitada: "${group[0].t.descricao}" — total ${R(valorSingles)} + ${parcelas.length} parcela(s) de ${R(valorParcela)}`,
        valor: valorSingles,
        transacoes: group.map(({ t }) => t.descricao),
      })
    }
  }

  return { excluirIndices, issues }
}

// ─── 7. Statistical anomaly detection — informational ────────────────────────

function detectarAnomalias(transacoes: Transacao[]): ValidationIssue[] {
  if (transacoes.length < 5) return []

  const valores = transacoes.map(t => Math.abs(t.valor)).filter(v => v > 0)
  const media = valores.reduce((s, v) => s + v, 0) / valores.length
  if (media === 0) return []

  const variancia = valores.reduce((s, v) => s + Math.pow(v - media, 2), 0) / valores.length
  const stddev    = Math.sqrt(variancia)
  const limiar    = media + 4 * stddev

  const issues: ValidationIssue[] = []
  const jaReportados = new Set<string>()

  for (const t of transacoes) {
    const abs = Math.abs(t.valor)
    if (abs > limiar && abs > media * 5 && !jaReportados.has(t.descricao)) {
      jaReportados.add(t.descricao)
      issues.push({
        type: 'anomaly',
        severity: 'info',
        descricao: `Valor atípico: "${t.descricao}" — ${R(t.valor)} (${(abs / media).toFixed(1)}× a média de ${R(media)})`,
        valor: t.valor,
        transacoes: [t.descricao],
      })
    }
  }

  return issues
}

// ─── 8. Mathematical consistency audit (RN12) ────────────────────────────────

function validarConsistenciaMath(transacoes: Transacao[]): ValidationIssue[] {
  if (transacoes.length === 0) return []

  let total = 0
  const byCat: Record<string, number> = {}

  for (const t of transacoes) {
    total += t.valor
    const cat = t.categoria ?? 'Sem categoria'
    byCat[cat] = (byCat[cat] ?? 0) + t.valor
  }

  const sumCats = Object.values(byCat).reduce((s, v) => s + v, 0)
  const diff    = Math.abs(total - sumCats)

  if (diff > 0.02) {
    return [{
      type: 'math_inconsistency',
      severity: 'warning',
      descricao: `Inconsistência matemática: categorias somam ${R(sumCats)} ≠ total ${R(total)} (Δ ${R(diff)})`,
      valor: diff,
    }]
  }

  return []
}

// ─── 9. Reliability index (RN18) ──────────────────────────────────────────────

function calcularIndiceConfiabilidade(
  issues: ValidationIssue[],
  totalTransacoes: number,
  excluidas: number
): number {
  let score = 100

  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': score -= 15; break
      case 'warning':  score -= 3;  break
      case 'info':     score -= 0.5; break
    }
  }

  if (totalTransacoes > 0) {
    const ratio = excluidas / totalTransacoes
    if (ratio > 0.2)      score -= 10
    else if (ratio > 0.1) score -= 5
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

function buildResumo(
  indice: number,
  issues: ValidationIssue[],
  validadas: number,
  excluidas: number
): string {
  const criticos = issues.filter(i => i.severity === 'critical').length
  const alertas  = issues.filter(i => i.severity === 'warning').length

  if (indice === 100 && excluidas === 0)
    return `Dados auditados sem inconsistências. ${validadas} transações certificadas.`
  if (indice >= 95)
    return `Pequenas inconsistências corrigidas. ${validadas} transações válidas, ${excluidas} excluída(s).`
  if (indice >= 80)
    return `${alertas} alerta(s) tratado(s). ${validadas} transações validadas, ${excluidas} excluída(s).`
  if (indice >= 60)
    return `${criticos} problema(s) crítico(s) e ${alertas} alerta(s). Dados podem conter distorções — revisão recomendada.`
  return `Problemas críticos detectados. Dados com alta probabilidade de distorção. Revisão urgente necessária.`
}

// ─── Main export (RN11) ───────────────────────────────────────────────────────

export interface ValidationResult {
  validatedData: EnrichedData
  certificate: ValidationCertificate
}

export function validateFinancialData(data: EnrichedData): ValidationResult {
  const allIssues: ValidationIssue[]  = []
  const excluirIndices = new Set<number>()

  // Step 1: Duplicates — remove all but first occurrence
  const dup = detectarDuplicatas(data.transacoes)
  for (const i of dup.excluirIndices) excluirIndices.add(i)
  allIssues.push(...dup.issues)

  // Step 2: Card payments — bill payments are not expenses
  const pag = detectarPagamentosCartao(data.transacoes)
  for (const i of pag.excluirIndices) excluirIndices.add(i)
  allIssues.push(...pag.issues)

  // Step 3: Investment redemptions — informational
  allIssues.push(...detectarResgatesInvestimentos(data.transacoes))

  // Step 4: Installment double-count — run on the already-filtered set
  const txRestantes = data.transacoes.filter((_, i) => !excluirIndices.has(i))
  const parcCheck   = detectarDuplaContagemParcelamentos(txRestantes)
  // Map local indices back to original indices
  let localIdx = 0
  for (let origIdx = 0; origIdx < data.transacoes.length; origIdx++) {
    if (!excluirIndices.has(origIdx)) {
      if (parcCheck.excluirIndices.has(localIdx)) excluirIndices.add(origIdx)
      localIdx++
    }
  }
  allIssues.push(...parcCheck.issues)

  // Step 7: Anomaly detection — informational, do not exclude
  const txValidadas = data.transacoes.filter((_, i) => !excluirIndices.has(i))
  allIssues.push(...detectarAnomalias(txValidadas))

  // Step 8: Math consistency — informational
  allIssues.push(...validarConsistenciaMath(txValidadas))

  const transacoesExcluidas = excluirIndices.size
  const transacoesValidadas = data.transacoes.length - transacoesExcluidas
  const indice    = calcularIndiceConfiabilidade(allIssues, data.transacoes.length, transacoesExcluidas)
  const hasCritical = allIssues.some(i => i.severity === 'critical')

  const certificate: ValidationCertificate = {
    timestamp: new Date().toISOString(),
    indiceConfiabilidade: indice,
    totalTransacoes: data.transacoes.length,
    transacoesValidadas,
    transacoesExcluidas,
    problemas: allIssues,
    certificado: !hasCritical,
    resumo: buildResumo(indice, allIssues, transacoesValidadas, transacoesExcluidas),
  }

  const validatedData: EnrichedData = {
    ...data,
    transacoes: txValidadas,
  }

  return { validatedData, certificate }
}

// ─── Format certificate for AI context (RN18, CA06) ──────────────────────────

/**
 * Formats the certificate as a context section for the AI.
 * compact = true → single-line summary for follow-up messages (~15 tokens).
 * compact = false → full detail for first message.
 */
export function formatCertificateForAI(
  cert: ValidationCertificate,
  compact = false
): string {
  const pct   = cert.indiceConfiabilidade
  const icon  = pct >= 95 ? '✅' : pct >= 80 ? '⚠️' : '🔴'

  if (compact) {
    return `DADOS AUDITADOS: ${cert.transacoesValidadas}/${cert.totalTransacoes} transações | Confiabilidade: ${pct}% ${icon}`
  }

  const lines: string[] = [
    `CERTIFICADO DE VALIDAÇÃO ${icon}`,
    `Confiabilidade: ${pct}% | ${cert.transacoesValidadas}/${cert.totalTransacoes} transações auditadas`,
  ]

  if (cert.transacoesExcluidas > 0) {
    const typeLabels: Record<string, string> = {
      duplicate:                'duplicata',
      card_payment:             'pagamento de fatura',
      installment_double_count: 'dupla contagem de parcelamento',
    }
    const countByType: Record<string, number> = {}
    for (const p of cert.problemas) {
      if (typeLabels[p.type]) countByType[p.type] = (countByType[p.type] ?? 0) + 1
    }
    const tiposStr = Object.entries(countByType)
      .map(([t, n]) => `${n} ${typeLabels[t]}`)
      .join(', ')

    lines.push(`Excluídas: ${cert.transacoesExcluidas} transação(ões) — ${tiposStr || 'inconsistências'}`)
  }

  // Critical issues (block or heavy warning)
  const criticos = cert.problemas.filter(p => p.severity === 'critical')
  if (criticos.length > 0) {
    lines.push(`⚠️ CRÍTICO (${criticos.length}): ${criticos.slice(0, 2).map(p => p.descricao.slice(0, 90)).join(' | ')}`)
  }

  // Warning summary (max 2)
  const alertas = cert.problemas
    .filter(p => p.severity === 'warning')
    .slice(0, 2)
  if (alertas.length > 0) {
    lines.push(`Alertas: ${alertas.map(a => a.descricao.slice(0, 90)).join(' | ')}`)
  }

  // Anomaly summary
  const anomalias = cert.problemas.filter(p => p.type === 'anomaly')
  if (anomalias.length > 0) {
    lines.push(`Valores atípicos identificados: ${anomalias.length} transação(ões) com valores muito acima da média`)
  }

  lines.push(cert.resumo)

  return lines.join('\n')
}

/**
 * Anti-distortion motor (RN13): builds a metrics section where every figure
 * includes absolute value + percentage + comparison base, so the AI never
 * receives a bare percentage without context.
 */
export function buildAntiDistortionSection(
  totalAtual: number,
  totalAnterior: number,
  media6m: number,
  mesAtual: string,
  mesAnterior: string
): string {
  if (totalAtual === 0) return ''

  const lines: string[] = ['MOTOR ANTI-DISTORÇÃO (valores absolutos + referências):']

  // vs previous month
  if (totalAnterior > 0) {
    const varPct = ((totalAtual - totalAnterior) / totalAnterior) * 100
    const sinal  = varPct >= 0 ? '+' : ''
    lines.push(
      `  vs ${mesAnterior}: ${R(totalAtual)} (${sinal}${varPct.toFixed(1)}% vs ${R(totalAnterior)})`
    )
  }

  // vs 6-month average
  if (media6m > 0) {
    const varPct = ((totalAtual - media6m) / media6m) * 100
    const sinal  = varPct >= 0 ? '+' : ''
    lines.push(
      `  vs média 6m: ${R(totalAtual)} (${sinal}${varPct.toFixed(1)}% vs ${R(media6m)}/mês)`
    )
  }

  lines.push(`  Mês de referência: ${mesAtual}`)

  return lines.join('\n')
}

/**
 * Explainability metadata (RN19, CA04): generates a traceability block that
 * lets the AI cite the exact data behind each category insight.
 */
export function buildExplainabilitySection(
  topCategorias: Array<{
    categoria: string
    valor: number
    percentual: number
    anterior?: number
    variacao?: number
  }>,
  mesAtual: string,
  mesAnterior: string
): string {
  if (topCategorias.length === 0) return ''

  const lines = ['RASTREABILIDADE DE INSIGHTS POR CATEGORIA:']

  for (const cat of topCategorias.slice(0, 5)) {
    const sinal = cat.variacao !== undefined ? (cat.variacao >= 0 ? '+' : '') : ''
    const varStr = cat.variacao !== undefined
      ? ` | ${sinal}${cat.variacao.toFixed(1)}% vs ${R(cat.anterior ?? 0)} em ${mesAnterior}`
      : ''
    lines.push(
      `  ${cat.categoria}: ${R(cat.valor)} (${cat.percentual.toFixed(1)}% do total em ${mesAtual})${varStr}`
    )
  }

  return lines.join('\n')
}
