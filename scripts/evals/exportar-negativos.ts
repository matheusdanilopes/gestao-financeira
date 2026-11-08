/**
 * Transforma os 👎 do chat em rascunhos de cenários de avaliação.
 *
 *   npm run evals:negativos              últimos 30 dias
 *   npm run evals:negativos -- --dias 90
 *
 * Para cada resposta marcada com 👎: a pergunta que a originou, o histórico
 * curto, a resposta ruim, o comentário e a trilha de consultas. Grava um
 * arquivo com rascunhos no formato de casos.ts — complete o campo `espera`
 * (o que a resposta certa deveria conter, conferido no banco) e mova o caso
 * para casos.ts. Só lê o banco.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { criarSupabaseAdmin } from '../../lib/supabaseAdmin'

const i = process.argv.indexOf('--dias')
const dias = i >= 0 ? Number(process.argv[i + 1]) : 30

async function main() {
  const supabase = criarSupabaseAdmin()
  if (!supabase) {
    console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(2)
  }
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { data: ruins, error } = await supabase
    .from('messages')
    .select('id, conversation_id, content, created_at, ferramentas, meta, avaliacao_comentario, canal')
    .eq('avaliacao', -1)
    .gte('avaliado_em', desde)
    .order('avaliado_em', { ascending: false })
  if (error) {
    console.error('Erro ao ler as avaliações (a migration de avaliação foi aplicada?):', error.message)
    process.exit(1)
  }
  if (!ruins?.length) {
    console.log(`Nenhum 👎 nos últimos ${dias} dias.`)
    return
  }

  const rascunhos: string[] = []
  for (const r of ruins) {
    const { data: antes } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', r.conversation_id)
      .neq('role', 'system')
      .lt('created_at', r.created_at)
      .order('created_at', { ascending: false })
      .limit(5)
    const anteriores = (antes ?? []).reverse()
    const pergunta = anteriores.at(-1)?.role === 'user' ? anteriores.pop()!.content : '(pergunta não encontrada)'
    const trilha = Array.isArray(r.ferramentas)
      ? (r.ferramentas as Array<{ nome: string; args?: unknown }>).map(f => `${f.nome}(${JSON.stringify(f.args ?? {})})`).join(' → ')
      : 'sem consulta'

    rascunhos.push(`  {
    id: 'negativo-${String(r.id).slice(0, 8)}',
    categoria: 'lastro', // ajuste
    descricao: ${JSON.stringify(`👎 em ${String(r.created_at).slice(0, 10)}: ${r.avaliacao_comentario ?? 'sem comentário'}`)},
    hoje: '${String(r.created_at).slice(0, 10)}',
    quem: 'jeniffer', // ajuste
    canal: '${r.canal === 'telegram' ? 'telegram' : 'app'}',
    historico: ${JSON.stringify(anteriores.slice(-4).map(m => ({ role: m.role, content: String(m.content).slice(0, 400) })), null, 2).replace(/\n/g, '\n    ')},
    pergunta: ${JSON.stringify(pergunta)},
    // Resposta ruim: ${JSON.stringify(String(r.content).replace(/\s+/g, ' ').slice(0, 300))}
    // Consultas feitas: ${trilha}
    espera: { /* TODO: o que a resposta certa precisa conter — confira no banco */ },
  },`)
  }

  const pasta = join(process.cwd(), 'scripts', 'evals', 'resultados')
  mkdirSync(pasta, { recursive: true })
  const arquivo = join(pasta, `negativos-${new Date().toISOString().slice(0, 10)}.ts.txt`)
  writeFileSync(arquivo, rascunhos.join('\n\n') + '\n')
  console.log(`${ruins.length} 👎 exportado(s) para ${arquivo}`)
}

main()
