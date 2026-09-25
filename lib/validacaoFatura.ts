import { SupabaseClient } from '@supabase/supabase-js'
import { labelCartao } from '@/lib/pushImportacao'
import { TransacaoNubank, normalizarDescricaoParaHash } from '@/lib/csvparser'
import { descricoesParecidas } from '@/lib/descricaoSimilaridade'
import { formatBRL } from '@/lib/format'

export interface StatsFaturaValidacao {
  noCSV: number
  totalNoBanco: number
}

interface LinhaBanco {
  id: string
  descricao: string
  valor: number
  data_compra: string
}

const TOLERANCIA_DIAS_MS = 3 * 24 * 60 * 60 * 1000
const TOLERANCIA_VALOR = 0.05

interface LinhaArquivo {
  descricao: string
  data_compra: string
  valor: number
}

/**
 * Pareia, 1 pra 1, as linhas do banco com as transações do arquivo da mesma fatura
 * (mesma descrição normalizada), em duas passadas:
 *  1. mesma data e valor a até R$ 0,05 — resolve primeiro as cobranças repetidas do
 *     mesmo comerciante (ex.: pedágios NuTag de valor igual em dias próximos), para que
 *     a tolerância de data da passada 2 não troque os pares entre si;
 *  2. até 3 dias de diferença na data e R$ 0,05 no valor — exportações sucessivas do
 *     NuBank podem trazer a data ligeiramente diferente (processamento x compra) e o
 *     valor de uma parcela com centavos redistribuídos.
 *
 * Devolve o que sobrou dos dois lados: `excedentes` (no banco, sem par no arquivo) e
 * `faltantes` (no arquivo, sem par no banco).
 */
function parearArquivoBanco(
  linhasBanco: LinhaBanco[],
  transacoesArquivo: TransacaoNubank[],
  mesReferencia: string
): { excedentes: LinhaBanco[]; faltantes: LinhaArquivo[] } {
  const arquivo: Array<LinhaArquivo & { chave: string; usado: boolean }> = transacoesArquivo
    .filter(t => t.projeto_fatura === mesReferencia)
    .map(t => ({ descricao: t.descricao, data_compra: t.data_compra, valor: t.valor, chave: normalizarDescricaoParaHash(t.descricao), usado: false }))

  const banco = linhasBanco
    .filter(r => !!r.data_compra)
    .sort((x, y) => x.data_compra.localeCompare(y.data_compra))
    .map(r => ({ linha: r, chave: normalizarDescricaoParaHash(r.descricao), pareado: false }))

  const dias = (x: string, y: string) =>
    Math.abs(new Date(x + 'T12:00:00').getTime() - new Date(y + 'T12:00:00').getTime())

  for (const toleranciaDias of [0, TOLERANCIA_DIAS_MS]) {
    for (const b of banco) {
      if (b.pareado) continue
      let melhorIdx = -1
      let melhorScore = Infinity
      arquivo.forEach((c, i) => {
        if (c.usado || c.chave !== b.chave) return
        const diffDias = dias(c.data_compra, b.linha.data_compra)
        const diffValor = Math.abs(c.valor - b.linha.valor)
        if (diffDias > toleranciaDias || diffValor > TOLERANCIA_VALOR) return
        const score = diffDias + diffValor * 1_000_000 // prioriza data próxima, depois valor exato
        if (score < melhorScore) { melhorScore = score; melhorIdx = i }
      })
      if (melhorIdx >= 0) {
        arquivo[melhorIdx].usado = true
        b.pareado = true
      }
    }
  }

  return {
    excedentes: banco.filter(b => !b.pareado).map(b => b.linha),
    faltantes: arquivo.filter(c => !c.usado).map(({ descricao, data_compra, valor }) => ({ descricao, data_compra, valor })),
  }
}

/**
 * Procura, entre as demais linhas do banco (mesma fatura/cartão), a transação
 * mais parecida com a excedente — candidata a ser a mesma compra lançada em
 * duplicidade. Considera "parecida" (via `descricoesParecidas`, compartilhada
 * com a checagem de conciliação em `lib/conciliacao.ts`) quando a descrição
 * normalizada é igual, uma é prefixo da outra (títulos do NuBank podem vir
 * truncados de forma diferente entre exportações, ex.: "Jim.Com* 41697862
 * Pau" vs "...Paul"), ou difere por poucos caracteres (letra/pontuação
 * removida ou trocada em qualquer posição) — com valor dentro de R$ 0,05 e
 * data dentro de 3 dias.
 */
function encontrarProvavelDuplicata(alvo: LinhaBanco, todasLinhas: LinhaBanco[]): LinhaBanco | null {
  const dataAlvo = new Date(alvo.data_compra + 'T12:00:00').getTime()

  let melhor: LinhaBanco | null = null
  let melhorScore = Infinity

  for (const outra of todasLinhas) {
    if (outra.id === alvo.id || !outra.data_compra) continue

    const diffValor = Math.abs(outra.valor - alvo.valor)
    if (diffValor > TOLERANCIA_VALOR) continue

    if (!descricoesParecidas(outra.descricao, alvo.descricao)) continue

    const dataOutra = new Date(outra.data_compra + 'T12:00:00').getTime()
    const diffDias = Math.abs(dataOutra - dataAlvo)
    if (diffDias > TOLERANCIA_DIAS_MS) continue

    const score = diffDias + diffValor * 1_000_000
    if (score < melhorScore) { melhorScore = score; melhor = outra }
  }

  return melhor
}

function formatarDia(dataISO: string | undefined): string {
  return dataISO ? `${dataISO.substring(8, 10)}/${dataISO.substring(5, 7)}` : ''
}

/** Diferença de valor total (banco - arquivo) abaixo da qual ela não é citada no alerta. */
const TOLERANCIA_TOTAL = 0.10

/**
 * Compara, por fatura (mês), o arquivo importado com o que ficou no banco para o mesmo
 * cartão, nos DOIS sentidos e pelo valor total:
 *  - `excedentes`: no banco, sem par no arquivo (ex.: compra duplicada);
 *  - `faltantes`: no arquivo, sem par no banco (ex.: cobrança "engolida" pela
 *    conciliação de outra parecida);
 *  - diferença de valor total das compras (banco - arquivo), citada no alerta.
 * Antes só se comparava a QUANTIDADE e só quando o banco tinha mais linhas — uma troca
 * (uma cobrança a mais e outra a menos, como NuTag R$ 9,98 a mais em 30/08 e R$ 8,93 a
 * menos em 06/09) mantinha a contagem igual e passava sem alerta.
 *
 * Deduplicação: não cria uma nova notificação se já existir uma (lida ou não) com os
 * mesmos números para o mesmo cartao+mês — evita spam a cada reimportação enquanto a
 * divergência continuar exatamente a mesma. Só gera uma nova quando os números mudam.
 *
 * `faturaStats` só define quais faturas validar e a quantidade do arquivo; as linhas do
 * banco são lidas aqui.
 */
export async function validarDivergenciaFatura(
  supabase: SupabaseClient,
  faturaStats: Record<string, StatsFaturaValidacao>,
  transacoesArquivo: TransacaoNubank[],
  cartao: string,
  nomeCartao?: string
): Promise<void> {
  const nome = labelCartao(cartao, nomeCartao)

  for (const [mesReferencia, stats] of Object.entries(faturaStats)) {
    try {
      const { data: linhasBanco, error: linhasBancoError } = await supabase
        .from('transacoes_nubank')
        .select('id, descricao, valor, data_compra')
        .eq('projeto_fatura', mesReferencia)
        .eq('cartao', cartao)
        .eq('is_estorno', false)

      let linhas: LinhaBanco[] = linhasBanco ?? []

      // Fallback para schema legado (coluna 'data' em vez de 'data_compra'),
      // mesmo padrão usado em lib/conciliacao.ts e app/api/import/cartao/route.ts.
      if (linhasBancoError?.message?.includes('data_compra')) {
        const { data: linhasBancoLegado, error: erroLegado } = await supabase
          .from('transacoes_nubank')
          .select('id, descricao, valor, data')
          .eq('projeto_fatura', mesReferencia)
          .eq('cartao', cartao)
          .eq('is_estorno', false)
        if (erroLegado) {
          console.error(`[validacaoFatura] erro ao buscar linhas do banco (legado) cartao=${cartao} mes=${mesReferencia}:`, erroLegado)
          continue
        }
        linhas = (linhasBancoLegado ?? []).map((r: Record<string, unknown>) => ({ ...r, data_compra: r.data }) as LinhaBanco)
      } else if (linhasBancoError) {
        // Sem as linhas do banco não dá para comparar — melhor não alertar do que alertar errado.
        console.error(`[validacaoFatura] erro ao buscar linhas do banco cartao=${cartao} mes=${mesReferencia}:`, linhasBancoError)
        continue
      }

      const { excedentes, faltantes } = parearArquivoBanco(linhas, transacoesArquivo, mesReferencia)
      const somar = (valores: number[]) => Math.round(valores.reduce((acc, v) => acc + Number(v), 0) * 100) / 100
      const totalArquivo = somar(transacoesArquivo.filter(t => t.projeto_fatura === mesReferencia).map(t => t.valor))
      const totalBanco = somar(linhas.map(l => l.valor))
      const diferencaValor = Math.round((totalBanco - totalArquivo) * 100) / 100

      // O total não dispara alerta sozinho: linhas pareadas podem diferir até R$ 0,05 cada
      // (centavos redistribuídos em parcelas) e isso se acumula numa fatura grande. Uma
      // diferença real de valor numa linha já impede o pareamento e aparece como
      // faltante + excedente; o total entra na mensagem como contexto.
      const temDivergencia = excedentes.length > 0 || faltantes.length > 0

      if (!temDivergencia) {
        // Sem divergência agora (resolvida por uma reimportação ou nunca existiu de fato) —
        // marca como lida qualquer notificação antiga não lida para não deixar o usuário
        // preso olhando um alerta que não reflete mais o estado real dos dados.
        await supabase
          .from('notificacoes')
          .update({ lida: true })
          .eq('acao', 'fatura_divergencia')
          .eq('lida', false)
          .contains('metadata', { cartao, mes_referencia: mesReferencia })
        continue
      }

      const { data: existentes } = await supabase
        .from('notificacoes')
        .select('id, metadata, lida')
        .eq('acao', 'fatura_divergencia')
        .contains('metadata', { cartao, mes_referencia: mesReferencia })
        .order('created_at', { ascending: false })
        .limit(1)

      const existente = existentes?.[0]
      const metadataExistente = existente?.metadata as Record<string, unknown> | undefined
      const mesmaDivergencia =
        metadataExistente?.quantidade_arquivo === stats.noCSV &&
        metadataExistente?.quantidade_banco === linhas.length &&
        metadataExistente?.quantidade_excedentes === excedentes.length &&
        metadataExistente?.quantidade_faltantes === faltantes.length &&
        metadataExistente?.diferenca_valor === diferencaValor

      if (existente && mesmaDivergencia) {
        console.log(`[validacaoFatura] divergência já notificada (sem mudança, lida=${existente.lida}) cartao=${cartao} mes=${mesReferencia}`)
        continue
      }

      if (existente && !existente.lida) {
        // Situação mudou desde a última notificação (números diferentes, ou a lógica de
        // detecção foi corrigida) — marca a antiga como lida e gera uma nova, atualizada.
        await supabase.from('notificacoes').update({ lida: true }).eq('id', existente.id)
      }

      const mesLabel = mesReferencia.substring(0, 7)

      // Só faz sentido apontar uma provável duplicata quando há exatamente uma
      // transação excedente e nenhuma faltante — com troca ou várias, vira ruído.
      const provavelDuplicata = excedentes.length === 1 && faltantes.length === 0
        ? encontrarProvavelDuplicata(excedentes[0], linhas)
        : null

      const partes: string[] = []
      if (excedentes.length === 1) {
        const [linha] = excedentes
        let texto = `"${linha.descricao}" (${formatBRL(linha.valor)} em ${formatarDia(linha.data_compra)}) está no banco mas não no arquivo`
        if (provavelDuplicata) {
          texto += ` — pode ser duplicata de "${provavelDuplicata.descricao}" (${formatarDia(provavelDuplicata.data_compra)})`
        }
        partes.push(texto)
      } else if (excedentes.length > 1) {
        partes.push(`${excedentes.length} transações estão no banco mas não no arquivo`)
      }
      if (faltantes.length === 1) {
        const [linha] = faltantes
        partes.push(`"${linha.descricao}" (${formatBRL(linha.valor)} em ${formatarDia(linha.data_compra)}) está no arquivo mas não no banco`)
      } else if (faltantes.length > 1) {
        const lista = faltantes.slice(0, 3).map(f => `${formatBRL(f.valor)} em ${formatarDia(f.data_compra)}`).join(', ')
        partes.push(`${faltantes.length} transações do arquivo não estão no banco (${lista}${faltantes.length > 3 ? ', …' : ''})`)
      }
      if (Math.abs(diferencaValor) >= TOLERANCIA_TOTAL) {
        partes.push(`total no banco ${formatBRL(totalBanco)} x ${formatBRL(totalArquivo)} no arquivo (${diferencaValor > 0 ? '+' : ''}${formatBRL(diferencaValor)})`)
      }
      const descricao = `Divergência na fatura ${mesLabel} do ${nome}: ${partes.join('; ')}.`

      await supabase.from('notificacoes').insert({
        de_usuario: 'sistema',
        nome_usuario: 'Sistema',
        acao: 'fatura_divergencia',
        descricao,
        metadata: {
          cartao,
          mes_referencia: mesReferencia,
          quantidade_arquivo: stats.noCSV,
          quantidade_banco: linhas.length,
          diferenca: linhas.length - stats.noCSV,
          quantidade_excedentes: excedentes.length,
          quantidade_faltantes: faltantes.length,
          diferenca_valor: diferencaValor,
          total_banco: totalBanco,
          total_arquivo: totalArquivo,
          ...(faltantes.length > 0 ? { faltantes: faltantes.slice(0, 20) } : {}),
          ...(excedentes.length > 0 ? { transacao_ids: excedentes.map(e => e.id) } : {}),
          ...(provavelDuplicata ? { provavel_duplicata_id: provavelDuplicata.id } : {}),
        },
      })
    } catch (error) {
      console.error(`[validacaoFatura] erro ao validar cartao=${cartao} mes=${mesReferencia}:`, error)
    }
  }
}
