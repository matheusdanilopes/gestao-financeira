/**
 * Aprendizado de categorias: quando o casal escolhe uma categoria à mão, ela
 * vira memória para as próximas compras do mesmo estabelecimento
 * (lib/categorizacao/memoria.ts lê esta tabela).
 *
 * Mudanças (08/11/2026):
 *  - a chave é o ESTABELECIMENTO normalizado ("mercadolivre blzcosme"), não a
 *    descrição com parcela ("MERCADOLIVRE BLZCOSME PARCELA 1 5");
 *  - a memória é do casal (user_id 'default'): antes a tela de compras gravava
 *    em 'default' e a rota de feedback no id de cada um — duas memórias;
 *  - marketplace genérico não é memorizado (o nome não diz o que foi comprado);
 *  - o classificador antigo (Gemini 1.5, uma chamada por compra) saiu: tudo
 *    passa por lib/categorizarTransacoes.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarEstabelecimento } from './categorizacao/normalizacao'

export const USUARIO_MEMORIA = 'default'

/** Chave usada na memória para uma descrição de fatura. */
export function sanitizarDescricao(descricao: string): string {
  return normalizarEstabelecimento(descricao).chave
}

/**
 * A edição de uma compra deve virar aprendizado? Só quando a pessoa ESCOLHEU
 * a categoria agora. Antes, salvar qualquer campo (valor, responsável, nome)
 * regravava a categoria atual como "manual" e a memorizava — foi assim que
 * "Outros" dado pela IA virou regra e se espalhou para 123 compras.
 */
export function categoriaFoiEscolhida(categoriaAntes: string | null | undefined, categoriaDepois: string | null | undefined): boolean {
  return !!categoriaDepois && categoriaDepois !== (categoriaAntes ?? '')
}

/** Origem a gravar depois de uma edição: só vira MANUAL quem a pessoa trocou. */
export function origemAposEdicao(
  categoriaAntes: string | null | undefined,
  origemAntes: string | null | undefined,
  categoriaDepois: string | null | undefined
): string | null {
  if (!categoriaDepois) return null
  return categoriaFoiEscolhida(categoriaAntes, categoriaDepois) ? 'MANUAL' : (origemAntes ?? null)
}

/**
 * Soma uma escolha à memória. Ignora marketplace genérico. Devolve false
 * quando não memorizou.
 */
export async function atualizarAprendizado(
  supabase: SupabaseClient,
  descricao: string,
  categoriaValidada: string,
  userId = USUARIO_MEMORIA
): Promise<boolean> {
  const est = normalizarEstabelecimento(descricao)
  if (est.generico || !est.chave) return false

  const { data: existente } = await supabase
    .from('classificacoes_aprendidas')
    .select('id, frequencia, categoria_validada')
    .eq('user_id', userId)
    .eq('descricao_limpa', est.chave)
    .maybeSingle()

  if (existente) {
    // Mudou de ideia: a nova escolha substitui e o contador recomeça.
    const mudou = existente.categoria_validada !== categoriaValidada
    await supabase
      .from('classificacoes_aprendidas')
      .update({
        categoria_validada: categoriaValidada,
        frequencia: mudou ? 1 : existente.frequencia + 1,
        ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', existente.id)
  } else {
    await supabase.from('classificacoes_aprendidas').insert({
      user_id: userId,
      descricao_limpa: est.chave,
      categoria_validada: categoriaValidada,
      frequencia: 1,
    })
  }
  return true
}
