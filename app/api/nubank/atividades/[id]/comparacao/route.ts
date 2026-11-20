import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { resolverMudancaResponsavel, type ComparacaoPrevisaoFatura } from '@/lib/comparacaoPrevisao'

/**
 * Resolve uma mudança de responsável da comparação previsão × importado
 * (lib/comparacaoPrevisao.ts):
 * - acao 'corrigir': volta a transação para o responsável previsto. As próximas
 *   parcelas herdam o responsável desta (aplicarResponsavelDeParcelaAnterior), então
 *   a correção vale para o resto da série;
 * - acao 'manter': só marca a mudança como conferida.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, unauthorized } = await requireAuth(req)
    if (unauthorized) return unauthorized
    const { id } = await params

    const body = await req.json().catch(() => null)
    const { fatura, cartao, transacaoId, acao } = (body ?? {}) as Record<string, unknown>
    if (typeof fatura !== 'string' || typeof cartao !== 'string' || typeof transacaoId !== 'string' ||
        (acao !== 'corrigir' && acao !== 'manter')) {
      return NextResponse.json({ error: 'Informe fatura, cartao, transacaoId e acao (corrigir | manter).' }, { status: 400 })
    }

    const { data: log, error: erroLog } = await supabase
      .from('activity_logs')
      .select('comparacao_previsao')
      .eq('id', id)
      .maybeSingle()
    if (erroLog) return NextResponse.json({ error: erroLog.message }, { status: 500 })

    const comparacoes = (log?.comparacao_previsao ?? null) as ComparacaoPrevisaoFatura[] | null
    const indice = comparacoes?.findIndex(c => c.fatura === fatura && c.cartao === cartao) ?? -1
    if (!comparacoes || indice === -1) {
      return NextResponse.json({ error: 'Comparação não encontrada para esta importação.' }, { status: 404 })
    }

    const mudanca = comparacoes[indice].mudancasResponsavel.find(m => m.transacaoId === transacaoId)
    if (!mudanca) return NextResponse.json({ error: 'Mudança de responsável não encontrada.' }, { status: 404 })
    if (mudanca.resolucao) return NextResponse.json({ comparacao: comparacoes[indice] })

    if (acao === 'corrigir') {
      const { data: atualizada, error: erroUpdate } = await supabase
        .from('transacoes_nubank')
        .update({ responsavel: mudanca.de })
        .eq('id', transacaoId)
        .select('id')
      if (erroUpdate) return NextResponse.json({ error: erroUpdate.message }, { status: 500 })
      if (!atualizada || atualizada.length === 0) {
        return NextResponse.json({ error: 'A transação não existe mais (pode ter sido removida ou revertida).' }, { status: 409 })
      }
    }

    const novas = [...comparacoes]
    novas[indice] = resolverMudancaResponsavel(comparacoes[indice], transacaoId, acao)

    const { error: erroSalvar } = await supabase
      .from('activity_logs')
      .update({ comparacao_previsao: novas })
      .eq('id', id)
    if (erroSalvar) return NextResponse.json({ error: erroSalvar.message }, { status: 500 })

    if (acao === 'corrigir') {
      await supabase.from('activity_logs').insert({
        acao: 'editar',
        tabela: 'transacoes_nubank',
        descricao: `Responsável corrigido na conferência da importação: ${mudanca.descricao} (${mudanca.para} → ${mudanca.de})`,
        valor: mudanca.valor,
      }).then(({ error }) => { if (error) console.error('[comparacao] log de edição falhou:', error.message) })
    }

    return NextResponse.json({ comparacao: novas[indice] })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
