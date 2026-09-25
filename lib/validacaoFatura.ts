import { SupabaseClient } from '@supabase/supabase-js'
import { labelCartao } from '@/lib/pushImportacao'
import { TransacaoNubank, normalizarDescricaoParaHash } from '@/lib/csvparser'
import { descricoesParecidas } from '@/lib/descricaoSimilaridade'
import { formatBRL } from '@/lib/format'
import { somarValorFatura } from '@/lib/composicaoFatura'

export interface StatsFaturaValidacao {
  noCSV: number
  totalNoBanco: number
}

interface LinhaBanco {
  id: string
  descricao: string
  valor: number
  data_compra: string
  hash_linha?: string | null
  is_estorno?: boolean | null
  status?: string | null
  conciliacao_ref?: string | null
}

const TOLERANCIA_DIAS_MS = 3 * 24 * 60 * 60 * 1000
const TOLERANCIA_VALOR = 0.05

interface LinhaArquivo {
  descricao: string
  data_compra: string
  valor: number
  is_estorno: boolean
}

const DIA_MS = 24 * 60 * 60 * 1000
const tempo = (dataISO: string) => new Date(dataISO + 'T12:00:00').getTime()

/**
 * Pareia, 1 pra 1, as linhas do banco com as do arquivo da mesma fatura. Compras só
 * pareiam com compras e estornos com estornos. Todos os pares possíveis entram numa
 * fila ordenada do mais confiável para o menos, e cada linha fica com o melhor par
 * ainda livre (guloso global — um guloso linha a linha podia "roubar" o par de uma
 * cobrança vizinha e deixar duas linhas sem par):
 *  1. mesmo hash_linha e valor a até R$ 0,05 (a linha que criou o registro — o valor
 *     também é exigido porque o hash não muda quando o valor é editado depois);
 *  2. mesma descrição normalizada, mesma data e valor a até R$ 0,05 (cobranças
 *     repetidas do mesmo comerciante, ex.: pedágios NuTag em dias próximos);
 *  3. mesma descrição, até 3 dias de diferença (data de processamento x compra);
 *  4. descrição parecida (`descricoesParecidas`: título truncado ou 1 caractere
 *     diferente, ex.: CSV x API), até 3 dias.
 *
 * Devolve o que sobrou dos dois lados: `excedentes` (no banco, sem par no arquivo) e
 * `faltantes` (no arquivo, sem par no banco).
 */
function parearArquivoBanco(
  linhasBanco: LinhaBanco[],
  linhasArquivo: Array<LinhaArquivo & { hash_linha?: string }>
): { excedentes: LinhaBanco[]; faltantes: LinhaArquivo[] } {
  const banco = linhasBanco.filter(r => !!r.data_compra)
  const chave = (d: string) => normalizarDescricaoParaHash(d)
  const chavesBanco = banco.map(r => chave(r.descricao))
  const chavesArquivo = linhasArquivo.map(t => chave(t.descricao))

  const pares: Array<{ b: number; a: number; score: number }> = []
  banco.forEach((r, bi) => {
    linhasArquivo.forEach((t, ai) => {
      if (!!r.is_estorno !== t.is_estorno) return
      const diffValor = Math.abs(Number(r.valor) - t.valor)
      if (diffValor > TOLERANCIA_VALOR) return
      const diffDias = Math.abs(tempo(r.data_compra) - tempo(t.data_compra))
      if (diffDias > TOLERANCIA_DIAS_MS) return
      let nivel: number
      if (r.hash_linha && t.hash_linha && r.hash_linha === t.hash_linha) nivel = 0
      else if (chavesBanco[bi] === chavesArquivo[ai]) nivel = diffDias === 0 ? 1 : 2
      else if (descricoesParecidas(r.descricao, t.descricao)) nivel = 3
      else return
      // nível domina; dentro do nível, data mais próxima e depois valor mais exato
      pares.push({ b: bi, a: ai, score: nivel * 1e12 + diffDias + diffValor * DIA_MS })
    })
  })
  pares.sort((x, y) => x.score - y.score)

  const bancoPareado = new Array(banco.length).fill(false)
  const arquivoPareado = new Array(linhasArquivo.length).fill(false)
  for (const { b, a } of pares) {
    if (bancoPareado[b] || arquivoPareado[a]) continue
    bancoPareado[b] = true
    arquivoPareado[a] = true
  }

  return {
    excedentes: banco.filter((_, i) => !bancoPareado[i]),
    faltantes: linhasArquivo
      .filter((_, i) => !arquivoPareado[i])
      .map(({ descricao, data_compra, valor, is_estorno }) => ({ descricao, data_compra, valor, is_estorno })),
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

/** Diferença de valor total (banco - arquivo) abaixo da qual ela não é citada no alerta; somada
 *  à tolerância de centavos por linha, também é o limite para o total disparar alerta sozinho. */
const TOLERANCIA_TOTAL = 0.10

/**
 * Compara, por fatura (mês), o arquivo importado com o que ficou no banco para o mesmo
 * cartão, linha a linha e nos DOIS sentidos (ver parearArquivoBanco):
 *  - `excedentes`: no banco, sem par no arquivo (ex.: compra duplicada, valor antigo de
 *    um conflito ainda não resolvido);
 *  - `faltantes`: no arquivo, sem par no banco (ex.: cobrança "engolida" pela
 *    conciliação de outra parecida);
 *  - total da fatura como o app calcula (somarValorFatura) x total do arquivo
 *    (compras - estornos) — alerta sozinho quando a diferença passa do que os
 *    centavos das linhas pareadas explicam.
 * Vale para compras e estornos. Antes só se comparava a QUANTIDADE de compras e só
 * quando o banco tinha mais linhas — uma troca (uma cobrança a mais e outra a menos)
 * mantinha a contagem igual e passava sem alerta.
 *
 * Um registro do banco só é apontado como excedente se a data dele estiver dentro do
 * período que o arquivo cobre para essa fatura (±3 dias): um arquivo parcial (ex.: a
 * API trazendo só os últimos dias) não prova que as compras mais antigas sobram.
 *
 * Deduplicação: não cria uma nova notificação se a última (lida ou não) do mesmo
 * cartao+mês apontou exatamente as mesmas linhas — evita spam a cada reimportação
 * enquanto a divergência continuar a mesma. Só gera uma nova quando ela muda.
 *
 * `faturaStats` define quais faturas validar; as quantidades são recalculadas aqui.
 * `transacoesArquivo` deve trazer TODAS as linhas do arquivo (compras e estornos).
 */
export async function validarDivergenciaFatura(
  supabase: SupabaseClient,
  faturaStats: Record<string, StatsFaturaValidacao>,
  transacoesArquivo: TransacaoNubank[],
  cartao: string,
  nomeCartao?: string
): Promise<void> {
  const nome = labelCartao(cartao, nomeCartao)

  for (const mesReferencia of Object.keys(faturaStats)) {
    try {
      const colunas = 'id, descricao, valor, hash_linha, is_estorno, status, conciliacao_ref'
      const { data: linhasBanco, error: linhasBancoError } = await supabase
        .from('transacoes_nubank')
        .select(`${colunas}, data_compra`)
        .eq('projeto_fatura', mesReferencia)
        .eq('cartao', cartao)

      let linhas: LinhaBanco[] = (linhasBanco ?? []) as LinhaBanco[]

      // Fallback para schema legado (coluna 'data' em vez de 'data_compra'),
      // mesmo padrão usado em lib/conciliacao.ts e app/api/import/cartao/route.ts.
      if (linhasBancoError?.message?.includes('data_compra')) {
        const { data: linhasBancoLegado, error: erroLegado } = await supabase
          .from('transacoes_nubank')
          .select(`${colunas}, data`)
          .eq('projeto_fatura', mesReferencia)
          .eq('cartao', cartao)
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

      const arquivoDaFatura = transacoesArquivo
        .filter(t => t.projeto_fatura === mesReferencia)
        .map(t => ({ descricao: t.descricao, data_compra: t.data_compra, valor: t.valor, is_estorno: !!t.is_estorno, hash_linha: t.hash_linha }))
      if (arquivoDaFatura.length === 0) continue

      const pareamento = parearArquivoBanco(linhas, arquivoDaFatura)
      const faltantes = pareamento.faltantes

      // Período coberto pelo arquivo nesta fatura (±3 dias) — ver comentário da função.
      const datasArquivo = arquivoDaFatura.map(t => t.data_compra).sort()
      const inicioCobertura = tempo(datasArquivo[0]) - TOLERANCIA_DIAS_MS
      const fimCobertura = tempo(datasArquivo[datasArquivo.length - 1]) + TOLERANCIA_DIAS_MS
      const dentroDaCobertura = (r: LinhaBanco) => {
        if (!r.data_compra) return false
        const t = tempo(r.data_compra)
        return t >= inicioCobertura && t <= fimCobertura
      }
      const excedentes = pareamento.excedentes.filter(dentroDaCobertura)
      // Total do app também só no período coberto — mesma razão (arquivo parcial).
      const linhasCobertas = linhas.filter(dentroDaCobertura)

      // Excedentes que são o valor antigo de um conflito de valor ainda aberto: o valor
      // novo está no banco como CONFLITO_VALOR e pareou com a linha do arquivo.
      const originaisEmConflito = new Set(
        linhas.filter(l => l.status === 'CONFLITO_VALOR' && l.conciliacao_ref).map(l => l.conciliacao_ref as string)
      )
      const emConflito = excedentes.filter(e => originaisEmConflito.has(e.id))

      const somar = (valores: number[]) => Math.round(valores.reduce((acc, v) => acc + Number(v), 0) * 100) / 100
      const totalArquivo = Math.round(
        (somar(arquivoDaFatura.filter(t => !t.is_estorno).map(t => t.valor)) -
          somar(arquivoDaFatura.filter(t => t.is_estorno).map(t => t.valor))) * 100
      ) / 100
      const totalBanco = Math.round(somarValorFatura(linhasCobertas.map(l => ({ ...l, valor: Number(l.valor) }))) * 100) / 100
      const diferencaValor = Math.round((totalBanco - totalArquivo) * 100) / 100

      // O total também dispara alerta, mas só acima do que os centavos podem explicar:
      // linhas pareadas diferem até R$ 0,05 cada (centavos redistribuídos em parcelas) e
      // isso se acumula numa fatura grande. Com todas as linhas pareadas, o que sobra é
      // a regra de soma do app divergindo do Nubank — ex.: compra estornada cujo estorno
      // caiu na fatura seguinte (o app tira a compra desta fatura; o Nubank cobra aqui e
      // credita na próxima).
      const toleranciaTotal = TOLERANCIA_TOTAL + TOLERANCIA_VALOR * arquivoDaFatura.length
      const totalDiverge = Math.abs(diferencaValor) > toleranciaTotal
      const temDivergencia = excedentes.length > 0 || faltantes.length > 0 || totalDiverge

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

      // Identidade da divergência: QUAIS linhas sobram de cada lado (não só quantas).
      const assinatura = [
        `t:${totalDiverge ? diferencaValor : 0}`,
        ...excedentes.map(e => `b:${e.id}`).sort(),
        ...faltantes.map(f => `a:${f.is_estorno ? 'e' : 'c'}|${f.data_compra}|${f.valor}|${normalizarDescricaoParaHash(f.descricao)}`).sort(),
      ].join(';')

      const { data: existentes } = await supabase
        .from('notificacoes')
        .select('id, metadata, lida')
        .eq('acao', 'fatura_divergencia')
        .contains('metadata', { cartao, mes_referencia: mesReferencia })
        .order('created_at', { ascending: false })
        .limit(1)

      const existente = existentes?.[0]
      const metadataExistente = existente?.metadata as Record<string, unknown> | undefined

      if (existente && metadataExistente?.assinatura === assinatura) {
        console.log(`[validacaoFatura] divergência já notificada (sem mudança, lida=${existente.lida}) cartao=${cartao} mes=${mesReferencia}`)
        continue
      }

      if (existente && !existente.lida) {
        // Situação mudou desde a última notificação — marca a antiga como lida e gera
        // uma nova, atualizada.
        await supabase.from('notificacoes').update({ lida: true }).eq('id', existente.id)
      }

      const mesLabel = mesReferencia.substring(0, 7)
      const rotulo = (l: { is_estorno?: boolean | null }) => (l.is_estorno ? 'estorno ' : '')

      // Só faz sentido apontar uma provável duplicata quando há exatamente uma
      // transação excedente e nenhuma faltante — com troca ou várias, vira ruído.
      const provavelDuplicata = excedentes.length === 1 && faltantes.length === 0 && emConflito.length === 0
        ? encontrarProvavelDuplicata(excedentes[0], linhas.filter(l => !!l.is_estorno === !!excedentes[0].is_estorno))
        : null

      const partes: string[] = []
      const excedentesSemConflito = excedentes.filter(e => !originaisEmConflito.has(e.id))
      if (excedentesSemConflito.length === 1) {
        const [linha] = excedentesSemConflito
        let texto = `${rotulo(linha)}"${linha.descricao}" (${formatBRL(Number(linha.valor))} em ${formatarDia(linha.data_compra)}) está no banco mas não no arquivo`
        if (provavelDuplicata) {
          texto += ` — pode ser duplicata de "${provavelDuplicata.descricao}" (${formatarDia(provavelDuplicata.data_compra)})`
        }
        partes.push(texto)
      } else if (excedentesSemConflito.length > 1) {
        partes.push(`${excedentesSemConflito.length} transações estão no banco mas não no arquivo`)
      }
      if (emConflito.length > 0) {
        partes.push(
          emConflito.length === 1
            ? `"${emConflito[0].descricao}" (${formatBRL(Number(emConflito[0].valor))}) tem conflito de valor aguardando decisão no sino`
            : `${emConflito.length} compras têm conflito de valor aguardando decisão no sino`
        )
      }
      if (faltantes.length === 1) {
        const [linha] = faltantes
        partes.push(`${rotulo(linha)}"${linha.descricao}" (${formatBRL(linha.valor)} em ${formatarDia(linha.data_compra)}) está no arquivo mas não no banco`)
      } else if (faltantes.length > 1) {
        const lista = faltantes.slice(0, 3).map(f => `${rotulo(f)}${formatBRL(f.valor)} em ${formatarDia(f.data_compra)}`).join(', ')
        partes.push(`${faltantes.length} transações do arquivo não estão no banco (${lista}${faltantes.length > 3 ? ', …' : ''})`)
      }
      if (totalDiverge || Math.abs(diferencaValor) >= TOLERANCIA_TOTAL) {
        let texto = `total da fatura no app ${formatBRL(totalBanco)} x ${formatBRL(totalArquivo)} no arquivo (${diferencaValor > 0 ? '+' : ''}${formatBRL(diferencaValor)})`
        const soTotal = excedentes.length === 0 && faltantes.length === 0
        const temEstornoPareado = linhasCobertas.some(l => l.status === 'ESTORNADO' || (l.status === 'ESTORNO' && l.conciliacao_ref))
        if (soTotal && temEstornoPareado) {
          texto += ` — provável compra estornada com o estorno em outra fatura (o app desconta a compra inteira aqui; o Nubank cobra nesta e credita na outra)`
        }
        partes.push(texto)
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
          assinatura,
          quantidade_arquivo: arquivoDaFatura.length,
          quantidade_banco: linhas.length,
          diferenca: linhas.length - arquivoDaFatura.length,
          quantidade_excedentes: excedentes.length,
          quantidade_faltantes: faltantes.length,
          quantidade_conflitos_pendentes: emConflito.length,
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
