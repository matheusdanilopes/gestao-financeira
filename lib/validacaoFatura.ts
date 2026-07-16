import { SupabaseClient } from '@supabase/supabase-js'
import { labelCartao } from '@/lib/pushImportacao'
import { TransacaoNubank, normalizarDescricaoParaHash } from '@/lib/csvparser'
import { formatBRL } from '@/lib/logger'

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

/**
 * Casa cada linha do banco com a transação do arquivo mais próxima pela mesma
 * descrição normalizada, tolerando até 3 dias de diferença na data e R$ 0,05 no
 * valor (mesma janela de 3 dias usada em contarNoBanco/import/cartao — exportações
 * sucessivas do mesmo extrato do NuBank podem trazer a data de compra ligeiramente
 * diferente — data de processamento vs. data de compra — e o valor de uma parcela
 * com centavos redistribuídos de forma diferente). Comparar por igualdade estrita
 * de data+valor (como antes) tratava essas variações naturais como "excedentes",
 * gerando dezenas de falsos positivos numa única divergência real.
 *
 * Linhas do banco sem par dentro da tolerância são as excedentes de fato.
 */
function encontrarExcedentes(
  linhasBanco: LinhaBanco[],
  transacoesArquivo: TransacaoNubank[],
  mesReferencia: string
): LinhaBanco[] {
  const porDescricaoArquivo = new Map<string, { data: string; valor: number }[]>()
  for (const t of transacoesArquivo) {
    if (t.projeto_fatura !== mesReferencia) continue
    const k = normalizarDescricaoParaHash(t.descricao)
    if (!porDescricaoArquivo.has(k)) porDescricaoArquivo.set(k, [])
    porDescricaoArquivo.get(k)!.push({ data: t.data_compra, valor: t.valor })
  }

  // Ordena por data para consumir os candidatos do arquivo de forma estável
  // (mais previsível quando há múltiplas ocorrências da mesma descrição/valor).
  const linhasOrdenadas = [...linhasBanco]
    .filter(r => !!r.data_compra)
    .sort((a, b) => a.data_compra.localeCompare(b.data_compra))

  const excedentes: LinhaBanco[] = []

  for (const linha of linhasOrdenadas) {
    const k = normalizarDescricaoParaHash(linha.descricao)
    const candidatos = porDescricaoArquivo.get(k)
    const dataBanco = new Date(linha.data_compra + 'T12:00:00').getTime()

    let melhorIdx = -1
    let melhorScore = Infinity
    candidatos?.forEach((c, i) => {
      const dataArq = new Date(c.data + 'T12:00:00').getTime()
      const diffDias = Math.abs(dataArq - dataBanco)
      const diffValor = Math.abs(c.valor - linha.valor)
      if (diffDias <= TOLERANCIA_DIAS_MS && diffValor <= TOLERANCIA_VALOR) {
        const score = diffDias + diffValor * 1_000_000 // prioriza data próxima, depois valor exato
        if (score < melhorScore) { melhorScore = score; melhorIdx = i }
      }
    })

    if (melhorIdx >= 0) {
      candidatos!.splice(melhorIdx, 1) // consome o candidato casado
    } else {
      excedentes.push(linha)
    }
  }

  return excedentes
}

/**
 * Compara, por fatura (mês), a quantidade de transações do arquivo importado
 * com a quantidade atual no banco para o mesmo cartão. Quando o banco tem
 * MAIS transações que o arquivo, identifica a(s) linha(s) excedente(s) via
 * `encontrarExcedentes` (casamento tolerante por descrição, com folga de data
 * e valor) e gera uma notificação (tabela `notificacoes`) apontando exatamente
 * para ela(s).
 *
 * Deduplicação: não cria uma nova notificação se já existir uma (lida ou não)
 * com os mesmos números para o mesmo cartao+mês — evita spam a cada
 * reimportação enquanto a divergência continuar exatamente a mesma, mesmo que
 * a notificação anterior já tenha sido marcada como lida (ex: usuário visitou
 * /compras por outro motivo). Só gera uma nova notificação quando os números
 * de fato mudam.
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
    if (stats.totalNoBanco <= stats.noCSV) {
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

    try {
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
        metadataExistente?.quantidade_banco === stats.totalNoBanco

      if (existente && mesmaDivergencia) {
        console.log(`[validacaoFatura] divergência já notificada (sem mudança, lida=${existente.lida}) cartao=${cartao} mes=${mesReferencia}`)
        continue
      }

      if (existente && !existente.lida) {
        // Situação mudou desde a última notificação (números diferentes, ou a lógica de
        // detecção foi corrigida) — marca a antiga como lida e gera uma nova, atualizada.
        await supabase.from('notificacoes').update({ lida: true }).eq('id', existente.id)
      }

      const diferenca = stats.totalNoBanco - stats.noCSV
      const mesLabel = mesReferencia.substring(0, 7)

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
        }
        linhas = (linhasBancoLegado ?? []).map((r: Record<string, unknown>) => ({ ...r, data_compra: r.data }) as LinhaBanco)
      } else if (linhasBancoError) {
        console.error(`[validacaoFatura] erro ao buscar linhas do banco cartao=${cartao} mes=${mesReferencia}:`, linhasBancoError)
      }

      const excedentes = encontrarExcedentes(linhas, transacoesArquivo, mesReferencia)

      let descricao: string
      if (excedentes.length === 1) {
        const [linha] = excedentes
        const data = linha.data_compra?.substring(8, 10)
        const mes = linha.data_compra?.substring(5, 7)
        descricao = `Fatura ${mesLabel} do ${nome}: "${linha.descricao}" (${formatBRL(linha.valor)}${data && mes ? ` em ${data}/${mes}` : ''}) está no banco mas não consta no arquivo importado.`
      } else if (excedentes.length > 1) {
        descricao = `Fatura ${mesLabel} do ${nome}: ${excedentes.length} transações estão no banco mas não constam no arquivo importado.`
      } else {
        descricao = `Divergência na fatura ${mesLabel} do ${nome}: ${stats.noCSV} no arquivo, ${stats.totalNoBanco} no banco (${diferenca} a mais).`
      }

      await supabase.from('notificacoes').insert({
        de_usuario: 'sistema',
        nome_usuario: 'Sistema',
        acao: 'fatura_divergencia',
        descricao,
        metadata: {
          cartao,
          mes_referencia: mesReferencia,
          quantidade_arquivo: stats.noCSV,
          quantidade_banco: stats.totalNoBanco,
          diferenca,
          ...(excedentes.length > 0 ? { transacao_ids: excedentes.map(e => e.id) } : {}),
        },
      })
    } catch (error) {
      console.error(`[validacaoFatura] erro ao validar cartao=${cartao} mes=${mesReferencia}:`, error)
    }
  }
}
