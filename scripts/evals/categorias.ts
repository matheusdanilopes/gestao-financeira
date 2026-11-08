/**
 * Avaliação da categorização com dados e modelo REAIS — só leitura.
 *
 *   npm run evals:categorias                    os dois relatórios abaixo
 *   npm run evals:categorias -- --so acerto     acerto contra os rótulos do casal
 *   npm run evals:categorias -- --so outros     o que aconteceria com os "Outros" atuais
 *   npm run evals:categorias -- --amostra 200   tamanho da amostra (padrão 150)
 *   npm run evals:categorias -- --minimo 0.8    exit 1 se o acerto ficar abaixo
 *
 * ACERTO: pega compras que o casal categorizou à mão e pede ao pipeline para
 * categorizar de novo, SEM que a memória conheça aquele estabelecimento
 * (deixa-um-de-fora) — senão seria só copiar a resposta. Mede acerto por
 * fonte (regra, IA…) e quantas iriam para "Outros".
 * Atenção: parte dos rótulos "manuais" veio do ciclo antigo (editar outro
 * campo gravava a categoria da IA como manual), então 100% não é o teto.
 *
 * OUTROS: roda o pipeline nas compras hoje em "Outros" (não manuais) e mostra
 * para onde iriam. Nada é gravado.
 *
 * Precisa de GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 */
import { criarSupabaseAdmin } from '../../lib/supabaseAdmin'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '../../lib/categorias'
import { MemoriaCategorias, type EntradaMemoria } from '../../lib/categorizacao/memoria'
import { normalizarEstabelecimento, chaveDeMemoriaAntiga } from '../../lib/categorizacao/normalizacao'
import { decidirCategorias, type TransacaoParaCategorizar } from '../../lib/categorizacao/pipeline'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const so = arg('so')
const amostra = Number(arg('amostra') ?? 150)
const minimo = Number(arg('minimo') ?? 0)

type Linha = TransacaoParaCategorizar & { categoria: string | null; categoria_origem: string | null }
const COLUNAS = 'hash_linha, descricao, descricao_personalizada, valor, parcela_atual, total_parcelas, responsavel, categoria, categoria_origem'

async function main() {
  const supabase = criarSupabaseAdmin()
  const apiKey = process.env.GEMINI_API_KEY
  if (!supabase || !apiKey) {
    console.error('Faltam GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(2)
  }
  const { data: cfg } = await supabase.from('configuracoes').select('valor').eq('chave', 'categorias_compras').maybeSingle()
  const permitidas = parseCategoriasConfig(cfg?.valor) || CATEGORIAS_PADRAO

  const todas: Linha[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('transacoes_nubank').select(COLUNAS)
      .or('is_estorno.is.null,is_estorno.eq.false').range(de, de + 999)
    if (error) throw new Error(error.message)
    todas.push(...(data as Linha[]))
    if (!data || data.length < 1000) break
  }
  const { data: aprendidas } = await supabase.from('classificacoes_aprendidas').select('descricao_limpa, categoria_validada, frequencia')
  const manuais = todas.filter(t => t.categoria_origem === 'MANUAL' && t.categoria && t.categoria !== 'Outros')

  const entradas = (excluirChave?: string): EntradaMemoria[] => [
    ...(aprendidas ?? [])
      .filter(a => !excluirChave || chaveDeMemoriaAntiga(a.descricao_limpa) !== excluirChave)
      .map(a => ({ descricao: a.descricao_limpa, categoria: a.categoria_validada, peso: a.frequencia ?? 1, formatoAntigo: true })),
    ...manuais
      .filter(m => !excluirChave || normalizarEstabelecimento(m.descricao).chave !== excluirChave)
      .map(m => ({ descricao: m.descricao, categoria: m.categoria!, peso: 1 })),
  ]
  const ia = { apiKey, deadlineMs: Date.now() + 20 * 60_000, pausaEntreLotesMs: 1_500 }
  let ok = true

  if (!so || so === 'acerto') {
    // Um representante por estabelecimento (senão Uber dominaria a amostra).
    const porChave = new Map<string, Linha>()
    for (const m of manuais) {
      const k = normalizarEstabelecimento(m.descricao).chave
      if (!porChave.has(k)) porChave.set(k, m)
    }
    const casos = [...porChave.entries()].sort(() => Math.random() - 0.5).slice(0, amostra)

    // Deixa-um-de-fora: cada caso decidido sem a memória do próprio estabelecimento.
    // Agrupa por chave para não refazer a memória a cada compra.
    let acertos = 0
    let outros = 0
    const porOrigem: Record<string, { n: number; ok: number }> = {}
    const erros: string[] = []
    for (let i = 0; i < casos.length; i += 25) {
      const lote = casos.slice(i, i + 25)
      const resultados = await Promise.all(lote.map(async ([chave, t]) => {
        const memoria = new MemoriaCategorias(entradas(chave), permitidas)
        const r = await decidirCategorias([{ ...t, categoria: undefined } as TransacaoParaCategorizar], {
          permitidas, memoria, categorizadas: [], ia,
        })
        return { t, d: r.decisoes[0] }
      }))
      for (const { t, d } of resultados) {
        const origem = d?.origem ?? 'SEM DECISÃO'
        porOrigem[origem] ??= { n: 0, ok: 0 }
        porOrigem[origem].n++
        if (d?.categoria === 'Outros') outros++
        if (d?.categoria === t.categoria) { acertos++; porOrigem[origem].ok++ }
        else erros.push(`  ${t.descricao.padEnd(40)} casal: ${t.categoria?.padEnd(12)} pipeline: ${d?.categoria ?? '—'} (${origem}${d ? `, ${d.confianca.toFixed(2)}` : ''})`)
      }
      process.stdout.write(`\r  ${Math.min(i + 25, casos.length)}/${casos.length}`)
    }
    const taxa = acertos / casos.length
    console.log(`\n\nACERTO contra rótulos manuais (${casos.length} estabelecimentos, sem a memória de cada um)`)
    console.log(`  acerto: ${acertos}/${casos.length} (${(taxa * 100).toFixed(0)}%) · foram para "Outros": ${outros}`)
    for (const [o, v] of Object.entries(porOrigem)) console.log(`  ${o.padEnd(12)} ${v.ok}/${v.n}`)
    console.log('\nDivergências (revise: parte dos rótulos manuais veio do ciclo antigo):')
    console.log(erros.slice(0, 40).join('\n'))
    if (taxa < minimo) ok = false
  }

  if (!so || so === 'outros') {
    const alvo = todas.filter(t => t.categoria === 'Outros' && t.categoria_origem !== 'MANUAL')
    const memoria = new MemoriaCategorias(entradas(), permitidas)
    const r = await decidirCategorias(alvo, { permitidas, memoria, categorizadas: todas.filter(t => (t.total_parcelas ?? 0) > 1 && t.categoria && t.categoria !== 'Outros'), ia })
    const destino: Record<string, number> = {}
    for (const d of r.decisoes) destino[d.categoria] = (destino[d.categoria] ?? 0) + 1
    const continuam = destino['Outros'] ?? 0
    console.log(`\nOUTROS HOJE (não manuais): ${alvo.length} compras`)
    console.log(`  sairiam de "Outros": ${r.decisoes.length - continuam} · continuariam: ${continuam} · sem decisão: ${r.semDecisao.length}`)
    console.log(`  para revisão do casal: ${r.decisoes.filter(d => d.status === 'revisao_pendente').length}`)
    console.log('  destino:', Object.entries(destino).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · '))
    const exemplos = r.decisoes.slice(0, 25).map(d => {
      const t = alvo.find(a => a.hash_linha === d.hash_linha)!
      return `  ${t.descricao.padEnd(40)} → ${d.categoria} (${d.origem}, ${d.confianca.toFixed(2)}) ${d.motivo}`
    })
    console.log(exemplos.join('\n'))
  }

  process.exit(ok ? 0 : 1)
}

main()
