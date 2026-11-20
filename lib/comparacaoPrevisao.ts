import { SupabaseClient } from '@supabase/supabase-js'
import { buildContracts, extrairParcelamento, itensDoMes, type ItemParcelaProjetado } from '@/lib/parcelamentoProjecao'
import { somarValorFatura } from '@/lib/composicaoFatura'
import { descricoesParecidas, normalizarDescricaoSemParcela } from '@/lib/descricaoSimilaridade'

// Comparação "previsão × importado" da PRIMEIRA importação de cada fatura.
//
// Antes de a fatura existir no banco, o app projeta o valor dela a partir das parcelas
// da fatura anterior (mesma regra de /api/projection: buildContracts + itensDoMes).
// Na primeira importação, essas parcelas reais chegam junto com as compras novas, e o
// responsável de cada uma pode ser recalculado (herança da parcela anterior, heurística
// da descrição) — sem um antes × depois era difícil saber o que mudou. Aqui:
//   1. capturarPrevisoes(): ANTES de gravar, guarda as parcelas projetadas de cada
//      fatura do arquivo que ainda não tem nenhuma linha no banco;
//   2. compararPrevisoes(): DEPOIS de gravar, casa cada parcela prevista com a parcela
//      importada e resume totais por responsável, mudanças de responsável/valor,
//      parcelas que não vieram e compras fora da previsão;
//   3. salvarComparacaoNoLog(): grava o resultado em activity_logs.comparacao_previsao,
//      exibido no detalhe da importação (/importar → Atividades Recentes).

export interface PrevisaoCapturada {
  fatura: string
  cartao: string
  /** projeto_fatura usada como base da projeção (a fatura anterior mais recente). */
  faturaBase: string
  itens: ItemParcelaProjetado[]
}

export interface ResumoPorResponsavel {
  total: number
  porResponsavel: Record<string, number>
}

export interface MudancaResponsavel {
  descricao: string
  parcela: string
  valor: number
  de: string
  para: string
}

export interface MudancaValor {
  descricao: string
  parcela: string
  responsavel: string
  previsto: number
  realizado: number
}

export interface ItemNaoImportado {
  descricao: string
  parcela: string
  responsavel: string
  valor: number
}

export interface ComparacaoPrevisaoFatura {
  fatura: string
  cartao: string
  faturaBase: string
  /** Parcelas projetadas para a fatura antes da importação. */
  previsto: ResumoPorResponsavel
  /** Fatura inteira após a importação (mesma soma do Dashboard: somarValorFatura). */
  realizado: ResumoPorResponsavel
  /** Parte do realizado que corresponde às parcelas previstas (responsável/valor reais). */
  parcelasRealizadas: ResumoPorResponsavel
  /** Compras que não estavam na previsão (à vista, parcela 1/X, estornos sem par…). */
  foraDaPrevisao: ResumoPorResponsavel & { quantidade: number }
  parcelasConfirmadas: number
  mudancasResponsavel: MudancaResponsavel[]
  mudancasValor: MudancaValor[]
  parcelasNaoVieram: ItemNaoImportado[]
}

const SEM_RESPONSAVEL = 'Sem responsável'

function nomeResponsavel(r: string | null | undefined): string {
  return r && r.trim() ? r : SEM_RESPONSAVEL
}

function arred(v: number): number {
  return Math.round(v * 100) / 100
}

function resumoVazio(): ResumoPorResponsavel {
  return { total: 0, porResponsavel: {} }
}

function somarEm(resumo: ResumoPorResponsavel, responsavel: string, valor: number) {
  resumo.total = arred(resumo.total + valor)
  resumo.porResponsavel[responsavel] = arred((resumo.porResponsavel[responsavel] ?? 0) + valor)
}

/**
 * Para cada fatura do arquivo que ainda NÃO tem nenhuma linha no banco (primeira
 * importação), captura as parcelas que a projeção esperava para ela. Precisa rodar
 * antes de o lote ser gravado. Falhas não interrompem a importação (retorna []).
 */
export async function capturarPrevisoes(
  supabase: SupabaseClient,
  cartao: string,
  faturas: string[]
): Promise<PrevisaoCapturada[]> {
  try {
    const capturas = await Promise.all(faturas.map(async (fatura): Promise<PrevisaoCapturada | null> => {
      const { count, error: erroCount } = await supabase
        .from('transacoes_nubank')
        .select('*', { count: 'exact', head: true })
        .eq('projeto_fatura', fatura)
        .eq('cartao', cartao)
      if (erroCount || (count ?? 0) > 0) return null

      const { data: anterior } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura')
        .eq('cartao', cartao)
        .lt('projeto_fatura', fatura)
        .order('projeto_fatura', { ascending: false })
        .limit(1)
      const faturaBase: string | undefined = anterior?.[0]?.projeto_fatura
      if (!faturaBase) return null

      const { data: linhasBase } = await supabase
        .from('transacoes_nubank')
        .select('*')
        .eq('cartao', cartao)
        .eq('projeto_fatura', faturaBase)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO')

      const contratos = buildContracts(linhasBase ?? [])
      const itens = itensDoMes(new Date(fatura), contratos, new Map())
      return { fatura, cartao, faturaBase, itens }
    }))
    return capturas.filter((c): c is PrevisaoCapturada => c !== null)
  } catch (err) {
    console.error('[comparacaoPrevisao] Falha ao capturar previsão:', err)
    return []
  }
}

interface LinhaFatura {
  id: string
  descricao: string
  valor: number
  status: string | null
  conciliacao_ref: string | null
  responsavel: string | null
  parcela_atual: number | null
  total_parcelas: number | null
}

/** Casa as parcelas previstas com o que foi gravado e resume as diferenças. */
export async function compararPrevisoes(
  supabase: SupabaseClient,
  previsoes: PrevisaoCapturada[]
): Promise<ComparacaoPrevisaoFatura[]> {
  if (previsoes.length === 0) return []
  try {
    return await Promise.all(previsoes.map(async previsao => {
      const { data } = await supabase
        .from('transacoes_nubank')
        .select('id, descricao, valor, status, conciliacao_ref, responsavel, parcela_atual, total_parcelas')
        .eq('cartao', previsao.cartao)
        .eq('projeto_fatura', previsao.fatura)
      return compararFatura(previsao, (data ?? []) as LinhaFatura[])
    }))
  } catch (err) {
    console.error('[comparacaoPrevisao] Falha ao comparar previsão:', err)
    return []
  }
}

export function compararFatura(previsao: PrevisaoCapturada, linhas: LinhaFatura[]): ComparacaoPrevisaoFatura {
  const previsto = resumoVazio()
  const realizado = resumoVazio()
  const parcelasRealizadas = resumoVazio()
  const foraDaPrevisao = { ...resumoVazio(), quantidade: 0 }
  const mudancasResponsavel: MudancaResponsavel[] = []
  const mudancasValor: MudancaValor[] = []
  const parcelasNaoVieram: ItemNaoImportado[] = []

  for (const item of previsao.itens) somarEm(previsto, nomeResponsavel(item.responsavel), item.valor)

  const responsaveis = new Set(linhas.map(l => nomeResponsavel(l.responsavel)))
  for (const r of responsaveis) {
    const valor = somarValorFatura(linhas.filter(l => nomeResponsavel(l.responsavel) === r))
    if (valor !== 0) somarEm(realizado, r, valor)
  }

  const candidatas = linhas
    .filter(l => l.status !== 'ESTORNO' && l.status !== 'ESTORNADO')
    .map(l => ({ linha: l, parcela: extrairParcelamento({ ...l }), chaveDesc: normalizarDescricaoSemParcela(l.descricao) }))
    .filter(c => c.parcela !== null)
  const usadas = new Set<string>()
  let parcelasConfirmadas = 0

  for (const item of previsao.itens) {
    const chaveDesc = normalizarDescricaoSemParcela(item.descricao)
    const mesmaParcela = candidatas.filter(c =>
      !usadas.has(c.linha.id) &&
      c.parcela!.total === item.totalParcelas &&
      c.parcela!.atual === item.parcelaAtual
    )
    const porDescricao = mesmaParcela.filter(c => c.chaveDesc === chaveDesc)
    const opcoes = porDescricao.length > 0
      ? porDescricao
      : mesmaParcela.filter(c => descricoesParecidas(c.linha.descricao, item.descricao))
    const escolhida = opcoes.sort((a, b) => Math.abs(a.linha.valor - item.valor) - Math.abs(b.linha.valor - item.valor))[0]

    const parcela = `${item.parcelaAtual}/${item.totalParcelas}`
    const respPrevisto = nomeResponsavel(item.responsavel)

    if (!escolhida) {
      parcelasNaoVieram.push({ descricao: item.descricao, parcela, responsavel: respPrevisto, valor: arred(item.valor) })
      continue
    }

    usadas.add(escolhida.linha.id)
    const respReal = nomeResponsavel(escolhida.linha.responsavel)
    somarEm(parcelasRealizadas, respReal, escolhida.linha.valor)

    const mudouResp = respReal !== respPrevisto
    const mudouValor = Math.abs(escolhida.linha.valor - item.valor) > 0.01
    if (!mudouResp && !mudouValor) parcelasConfirmadas++
    if (mudouResp) {
      mudancasResponsavel.push({
        descricao: escolhida.linha.descricao,
        parcela,
        valor: arred(escolhida.linha.valor),
        de: respPrevisto,
        para: respReal,
      })
    }
    if (mudouValor) {
      mudancasValor.push({
        descricao: escolhida.linha.descricao,
        parcela,
        responsavel: respReal,
        previsto: arred(item.valor),
        realizado: arred(escolhida.linha.valor),
      })
    }
  }

  const restantes = linhas.filter(l => !usadas.has(l.id))
  for (const r of new Set(restantes.map(l => nomeResponsavel(l.responsavel)))) {
    const valor = somarValorFatura(restantes.filter(l => nomeResponsavel(l.responsavel) === r))
    if (valor !== 0) somarEm(foraDaPrevisao, r, valor)
  }
  foraDaPrevisao.quantidade = restantes.filter(l => l.status !== 'ESTORNADO' && !(l.status === 'ESTORNO' && l.conciliacao_ref)).length

  return {
    fatura: previsao.fatura,
    cartao: previsao.cartao,
    faturaBase: previsao.faturaBase,
    previsto,
    realizado,
    parcelasRealizadas,
    foraDaPrevisao,
    parcelasConfirmadas,
    mudancasResponsavel,
    mudancasValor,
    parcelasNaoVieram,
  }
}

/** Grava a comparação no log da importação. Sem a coluna (migration não aplicada), só avisa. */
export async function salvarComparacaoNoLog(
  supabase: SupabaseClient,
  logId: string | null | undefined,
  comparacoes: ComparacaoPrevisaoFatura[]
): Promise<void> {
  if (!logId || comparacoes.length === 0) return
  const { error } = await supabase
    .from('activity_logs')
    .update({ comparacao_previsao: comparacoes })
    .eq('id', logId)
  if (error) {
    console.error(
      '[comparacaoPrevisao] Falha ao salvar comparação no log (aplique supabase/migration_comparacao_previsao.sql):',
      error.message
    )
  }
}
