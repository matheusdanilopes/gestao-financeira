/**
 * Avaliação do Fin com o modelo e o banco REAIS.
 *
 *   npm run evals                         todos os cenários, 1 vez
 *   npm run evals -- --so real-gargalo    só um (ou vários, separados por vírgula)
 *   npm run evals -- --categoria lastro   só uma categoria
 *   npm run evals -- --repetir 3          cada cenário 3 vezes (mede consistência)
 *   npm run evals -- --minimo 0.9         falha (exit 1) abaixo de 90% de aprovação
 *
 * Precisa de GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
 * (ex.: `vercel env pull .env.local` e rodar com `node --env-file=.env.local`).
 * GEMINI_MODEL_CHAT troca o modelo avaliado — útil para comparar dois modelos.
 *
 * Só LÊ o banco: as operações (propor/confirmar) vão para um Supabase em
 * memória, então nenhum cenário grava nada de verdade.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { criarSupabaseAdmin } from '../../lib/supabaseAdmin'
import { GatewayDados } from '../../lib/ai/data/gateway'
import { computeInsights } from '../../lib/ai/insightsEngine'
import { construirReferencias } from '../../lib/ai/agent/queryEngine'
import { buildSystemPrompt, buildBlockedPrompt } from '../../lib/ai/agent/systemPrompt'
import { executarAgente, type AgentEvent } from '../../lib/ai/agent/runAgent'
import { criarInterlocutor } from '../../lib/ai/agent/interlocutor'
import { GeminiError, GEMINI_MODEL } from '../../lib/ai/agent/geminiClient'
import type { ContextoEscrita } from '../../lib/ai/agent/writeEngine'
import { criarSupabaseFalso } from '../../lib/ai/agent/testes/apoio'
import { CASOS, type CasoAvaliacao } from './casos'
import { avaliar } from './avaliar'

// ─── Argumentos ──────────────────────────────────────────────────────────────

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const so = arg('so')?.split(',').map(s => s.trim())
const categoria = arg('categoria')
const repetir = Math.max(1, Number(arg('repetir') ?? 1))
const minimo = Number(arg('minimo') ?? 1)

const EMAILS = { jeniffer: 'jeniffer@financeiro.com', matheus: 'matheus@financeiro.com' } as const
const PAUSA_ENTRE_CASOS_MS = 1_500
const ORCAMENTO_MS = 75_000

interface Resultado {
  id: string
  categoria: string
  tentativa: number
  ok: boolean
  falhas: string[]
  resposta: string
  ferramentas: Array<{ nome: string; args?: Record<string, unknown> }>
  meta?: unknown
  erro?: string
}

// ─── Execução ────────────────────────────────────────────────────────────────

async function rodarCaso(caso: CasoAvaliacao, tentativa: number, apiKey: string): Promise<Resultado> {
  const supabase = criarSupabaseAdmin()!
  const gateway = new GatewayDados(supabase, `evals-${caso.quem}`)
  const { dados, certificado } = await gateway.iniciar()
  const refs = construirReferencias(new Date(`${caso.hoje}T12:00:00`))
  const interlocutor = criarInterlocutor(EMAILS[caso.quem], caso.canal ?? 'app')
  const systemPrompt = certificado.certificado
    ? buildSystemPrompt({ data: dados, metrics: computeInsights(dados, refs.hoje), refs, certificate: certificado, interlocutor, cobertura: gateway.cobertura })
    : buildBlockedPrompt(certificado)

  // Escritas só em memória.
  const db = criarSupabaseFalso({
    chat_operacoes: (caso.pendentes ?? []).map((p, i) => ({
      id: `pend-${i}`, conversation_id: 'evals', status: 'pendente', created_at: `2026-01-01T00:00:0${i}Z`, ...p,
    })),
  })

  let done: Extract<AgentEvent, { type: 'done' }> | undefined
  for await (const ev of executarAgente({
    apiKey,
    systemPrompt,
    historico: caso.historico ?? [],
    pergunta: caso.pergunta,
    gateway,
    refs,
    semFerramentas: !certificado.certificado,
    deadlineMs: Date.now() + ORCAMENTO_MS,
    escrita: {
      supabase: db.cliente as unknown as ContextoEscrita['supabase'],
      conversationId: 'evals',
      usuario: EMAILS[caso.quem],
      responsavelPadrao: interlocutor.nome,
    },
  })) if (ev.type === 'done') done = ev

  if (!done) throw new Error('turno terminou sem done')
  const falhas = avaliar(caso, done)
  return {
    id: caso.id, categoria: caso.categoria, tentativa, ok: falhas.length === 0, falhas,
    resposta: done.texto, ferramentas: done.trilha.map(t => ({ nome: t.nome, args: t.args })), meta: done.meta,
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || !criarSupabaseAdmin()) {
    console.error('Faltam variáveis: GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(2)
  }

  const casos = CASOS.filter(c => (!so || so.includes(c.id)) && (!categoria || c.categoria === categoria))
  if (casos.length === 0) {
    console.error('Nenhum cenário selecionado.')
    process.exit(2)
  }
  console.log(`Modelo: ${GEMINI_MODEL} · ${casos.length} cenário(s) × ${repetir}\n`)

  const resultados: Resultado[] = []
  for (const caso of casos) {
    for (let t = 1; t <= repetir; t++) {
      let r: Resultado
      try {
        r = await rodarCaso(caso, t, apiKey)
      } catch (err) {
        if (err instanceof GeminiError && err.codigo === 'QUOTA') {
          // Cota por minuto: espera e tenta de novo uma vez.
          await new Promise(res => setTimeout(res, ((err.detalhes?.segundos ?? 30) + 2) * 1000))
          try { r = await rodarCaso(caso, t, apiKey) } catch (e2) { r = falhaDeExecucao(caso, t, e2) }
        } else r = falhaDeExecucao(caso, t, err)
      }
      resultados.push(r)
      const meta = r.meta as { duracaoMs?: number; revisoes?: string[] } | undefined
      console.log(
        `${r.ok ? '✅' : '❌'} ${caso.id}${repetir > 1 ? ` #${t}` : ''}` +
        `  [${r.ferramentas.map(f => f.nome).join(', ') || 'sem consulta'}]` +
        (meta?.revisoes?.length ? `  revisões: ${meta.revisoes.join('+')}` : '') +
        (meta?.duracaoMs ? `  ${(meta.duracaoMs / 1000).toFixed(1)}s` : '')
      )
      for (const f of r.falhas) console.log(`     ↳ ${f}`)
      if (!r.ok) console.log(`     resposta: ${r.resposta.replace(/\s+/g, ' ').slice(0, 220)}`)
      await new Promise(res => setTimeout(res, PAUSA_ENTRE_CASOS_MS))
    }
  }

  // Resumo por categoria
  const aprovados = resultados.filter(r => r.ok).length
  const taxa = aprovados / resultados.length
  console.log('\nPor categoria:')
  for (const cat of [...new Set(resultados.map(r => r.categoria))]) {
    const doCat = resultados.filter(r => r.categoria === cat)
    console.log(`  ${cat.padEnd(10)} ${doCat.filter(r => r.ok).length}/${doCat.length}`)
  }
  const comLastro = resultados.filter(r => ((r.meta as { lastro?: { semLastro?: string[] } })?.lastro?.semLastro ?? []).length === 0).length
  console.log(`\nAprovação: ${aprovados}/${resultados.length} (${(taxa * 100).toFixed(0)}%) · respostas com todos os R$ de origem conhecida: ${comLastro}/${resultados.length}`)

  const pasta = join(process.cwd(), 'scripts', 'evals', 'resultados')
  mkdirSync(pasta, { recursive: true })
  const arquivo = join(pasta, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(arquivo, JSON.stringify({ modelo: GEMINI_MODEL, taxa, resultados }, null, 2))
  console.log(`Detalhes: ${arquivo}`)

  process.exit(taxa >= minimo ? 0 : 1)
}

function falhaDeExecucao(caso: CasoAvaliacao, tentativa: number, err: unknown): Resultado {
  const msg = err instanceof Error ? err.message : String(err)
  return { id: caso.id, categoria: caso.categoria, tentativa, ok: false, falhas: [`erro: ${msg}`], resposta: '', ferramentas: [], erro: msg }
}

main()
