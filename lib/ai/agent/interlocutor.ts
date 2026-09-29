/**
 * Quem está falando com o assessor.
 *
 * Os dados do app são do casal, mas a conversa é sempre com UMA pessoa: a que
 * está logada no app (ou a dona do Telegram vinculado). É ela quem
 * responde por "eu", "meu", "gastei", "recebi" — sem isso o modelo tratava
 * "quanto eu gastei?" como o total do casal.
 */

export type CanalConversa = 'app' | 'telegram'

export interface Interlocutor {
  /** Responsável correspondente nos dados (ex.: "Matheus"), ou null se não deu para identificar. */
  nome: string | null
  email: string | null
  canal: CanalConversa
}

/**
 * Mesmo critério das demais rotas do app (alertas-fatura, notificações): não
 * há tabela de mapeamento usuário → responsável, então o e-mail decide.
 */
export function responsavelDoEmail(email: string | null | undefined): string | null {
  const lower = (email ?? '').toLowerCase()
  if (lower.includes('jeniffer') || lower.includes('jennifer')) return 'Jeniffer'
  if (lower.includes('matheus')) return 'Matheus'
  return null
}

export function criarInterlocutor(email: string | null | undefined, canal: CanalConversa): Interlocutor {
  return { nome: responsavelDoEmail(email), email: email ?? null, canal }
}

export function blocoInterlocutor(i: Interlocutor): string {
  const onde = i.canal === 'telegram'
    ? 'pelo Telegram (a conta do Telegram está vinculada à conta no app)'
    : 'pelo chat do app, logado na própria conta'

  if (!i.nome) {
    return [
      'QUEM ESTÁ FALANDO',
      `A conversa é com o usuário logado${i.email ? ` (${i.email})` : ''}, ${onde}, mas não foi possível saber qual dos responsáveis é essa pessoa.`,
      'Se a pessoa falar na primeira pessoa ("eu", "meu", "gastei"), pergunte quem é antes de filtrar por pessoa — não some o casal inteiro como se fosse só dela.',
    ].join('\n')
  }

  const n = i.nome
  return [
    'QUEM ESTÁ FALANDO',
    `Você está conversando com ${n}, ${onde}. Chame a pessoa pelo nome quando for natural.`,
    `PRIMEIRA PESSOA = ${n}. "Eu", "meu", "minha", "comigo", "gastei", "comprei", "paguei", "recebi", "devo", "minha fatura", "meus parcelamentos" referem-se aos dados de ${n}: filtre as consultas com responsavel = "${n}" (confirme o valor exato com listar_dimensoes se a consulta reclamar do filtro).`,
    `Nas respostas em primeira pessoa, NÃO some os gastos do Conjunto nem os da outra pessoa aos de ${n}. Se o Conjunto for relevante, mencione-o numa linha à parte ("além disso, no Conjunto…").`,
    '"Nós", "a gente", "nosso", "da casa", "do casal" ou uma pergunta sem pessoa nenhuma ("quanto foi a fatura?") = todos os responsáveis juntos.',
    'Se perguntar pela outra pessoa pelo nome, responda sobre ela normalmente.',
    `Em operações (propor_*), quando não for dito outro responsável, o responsável é ${n}.`,
  ].join('\n')
}
