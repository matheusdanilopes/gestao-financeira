/**
 * Categorização por IA — só para o que a memória do casal e as regras não
 * resolveram.
 *
 * Antes: uma lista de descrições cruas + os nomes das categorias, resposta
 * por POSIÇÃO e qualquer nome fora da lista virava "Outros" em silêncio
 * ("Alimentacao" sem acento, "Supermercado"…). 129 compras foram para
 * "Outros" pela IA assim. Agora:
 *  - o modelo recebe o que significa cada categoria NESTE casal, exemplos dos
 *    rótulos deles, o nome que deram à compra, valor, parcelas e quem comprou;
 *  - a resposta é por id e o esquema só aceita categorias válidas;
 *  - "Outros" é último recurso: na dúvida o modelo dá o palpite mais provável
 *    com confiança baixa, e a compra fica marcada para revisão.
 */
import { gerarRodada, GeminiError } from '../ai/agent/geminiClient'
import { semAcento } from './normalizacao'

export interface ItemParaIA {
  id: string
  descricao: string
  nomePersonalizado?: string | null
  chave: string
  valor: number
  parcelas?: string
  responsavel?: string | null
  adquirente?: string
  marketplace?: boolean
  vendedor?: string
  exemplos?: Array<{ chave: string; categoria: string }>
}

export interface RespostaIA {
  categoria: string
  confianca: number
  motivo: string
}

/** O que cada categoria quer dizer — escrito a partir dos rótulos reais do casal. */
export const GUIA_CATEGORIAS: Record<string, string> = {
  'Alimentação': 'comer fora e delivery: restaurante, lanchonete, padaria, café, iFood, lanche na conveniência de posto ou em mercadinho 24h',
  'Mercado': 'compras de supermercado/atacado para casa: comida para estocar, limpeza, higiene',
  'Transporte': 'Uber/99, estacionamento, pedágio/tag, ônibus, manutenção e peças do carro',
  'Combustível': 'abastecimento do carro',
  'Saúde': 'farmácia, consulta, exame, plano, ótica, dentista, academia e pilates',
  'Cosméticos': 'produtos de beleza: perfume, maquiagem, cuidados de pele e cabelo',
  'Beleza': 'serviços de beleza: salão, manicure, depilação, estética, sobrancelha',
  'Vestuário': 'roupas, calçados, bolsas, acessórios, relógios e joias para uso próprio',
  'Lazer': 'passeios, cinema, eventos, bares, hobbies, livros e assinaturas de entretenimento',
  'Festa': 'artigos e serviços para festas e comemorações',
  'Presente': 'compras para dar de presente a outra pessoa',
  'Moradia': 'casa: móveis, utilidades domésticas, decoração, reforma, manutenção, vidraçaria',
  'Tecnologia': 'eletrônicos, acessórios de celular, apps, software e assinaturas digitais (inclusive o IOF delas)',
  'Serviços': 'serviços prestados por terceiros que não se encaixam acima (conserto, lavanderia, costura, taxas)',
  'Educação': 'cursos, escola, faculdade, material e livros de estudo',
  'Viagem': 'passagens, hospedagem e gastos durante viagens',
  'Pet': 'ração, pet shop, veterinário',
  'Streaming': 'Netflix, Disney+, Max, Prime Video e similares',
  'Música': 'Spotify, Deezer e similares',
  'Jogos': 'jogos e plataformas de games',
  'Segurança': 'monitoramento, seguros e equipamentos de segurança',
  'Outros': 'ÚLTIMO recurso — só quando nem o nome, nem o vendedor, nem o valor permitem um palpite',
}

const SINONIMOS: Record<string, string> = {
  alimentacao: 'Alimentação', restaurante: 'Alimentação', comida: 'Alimentação', delivery: 'Alimentação', lanche: 'Alimentação',
  supermercado: 'Mercado', mercado: 'Mercado', compras: 'Mercado',
  transporte: 'Transporte', combustivel: 'Combustível', gasolina: 'Combustível',
  saude: 'Saúde', farmacia: 'Saúde', cosmeticos: 'Cosméticos', perfumaria: 'Cosméticos',
  beleza: 'Beleza', vestuario: 'Vestuário', roupas: 'Vestuário', moda: 'Vestuário',
  lazer: 'Lazer', entretenimento: 'Lazer', festa: 'Festa', presente: 'Presente', presentes: 'Presente',
  moradia: 'Moradia', casa: 'Moradia', tecnologia: 'Tecnologia', eletronicos: 'Tecnologia', software: 'Tecnologia',
  servicos: 'Serviços', educacao: 'Educação', viagem: 'Viagem', pet: 'Pet', streaming: 'Streaming',
  musica: 'Música', jogos: 'Jogos', seguranca: 'Segurança', outros: 'Outros', outro: 'Outros',
}

/** Nome devolvido pelo modelo → categoria permitida (tolerante a acento, caixa e sinônimo). null se não der. */
export function resolverNomeCategoria(nome: unknown, permitidas: string[]): string | null {
  if (typeof nome !== 'string' || !nome.trim()) return null
  const n = semAcento(nome).toLowerCase().trim()
  const direta = permitidas.find(c => semAcento(c).toLowerCase() === n)
  if (direta) return direta
  const sinonimo = SINONIMOS[n]
  return sinonimo && permitidas.includes(sinonimo) ? sinonimo : null
}

function linhaItem(i: ItemParaIA): string {
  const partes = [`id=${i.id}`, `fatura: "${i.descricao}"`]
  if (i.nomePersonalizado) partes.push(`nome dado pelo casal: "${i.nomePersonalizado}"`)
  partes.push(`valor: R$ ${Math.abs(i.valor).toFixed(2).replace('.', ',')}`)
  if (i.parcelas) partes.push(`parcela ${i.parcelas}`)
  if (i.responsavel) partes.push(`de: ${i.responsavel}`)
  if (i.marketplace) partes.push(i.vendedor ? `marketplace, vendedor "${i.vendedor}"` : 'marketplace sem vendedor identificável')
  if (i.exemplos?.length) partes.push(`parecidos: ${i.exemplos.map(e => `"${e.chave}"→${e.categoria}`).join('; ')}`)
  return `- ${partes.join(' · ')}`
}

export function montarPromptCategorizacao(
  itens: ItemParaIA[],
  permitidas: string[],
  exemplosGerais: Array<{ chave: string; categoria: string }>,
  adquirentes: Record<string, string> = {}
): string {
  const guia = permitidas
    .map(c => `- ${c}: ${GUIA_CATEGORIAS[c] ?? 'categoria definida pelo casal'}`)
    .join('\n')
  const exemplos = exemplosGerais.length
    ? exemplosGerais.map(e => `"${e.chave}" → ${e.categoria}`).join('; ')
    : '(ainda sem rótulos)'
  const prefixos = Object.entries(adquirentes).map(([p, d]) => `"${p.toUpperCase()}*" = ${d}`).join('; ')

  return `Você categoriza compras de cartão de crédito de um casal brasileiro (Maringá-PR) para o app de finanças deles.

CATEGORIAS (use exatamente um destes nomes)
${guia}

COMO O CASAL COSTUMA CATEGORIZAR (siga este padrão quando servir)
${exemplos}

COMO LER A DESCRIÇÃO DA FATURA
- Prefixos de maquininha não são a loja: o nome vem depois do asterisco. ${prefixos}
- "- Parcela 2/5" e "- Jeniffer"/"- Matheus" não fazem parte do nome.
- Nome de pessoa (ex.: "Zp*Thaynara", "Maria Silva Souza") costuma ser prestador autônomo — use o valor, o nome dado pelo casal e os exemplos parecidos para deduzir o serviço.
- Marketplace (Mercado Livre, Amazon, Shopee, Havan): o nome não diz o que foi comprado; use o vendedor, o nome dado pelo casal, o valor e as parcelas.
- O nome dado pelo casal, quando existe, é a melhor pista de todas.

REGRAS
- Escolha sempre a categoria MAIS PROVÁVEL. "Outros" só quando não houver nenhuma pista.
- confianca entre 0 e 1: ≥ 0.85 quando o estabelecimento é claro; 0.5–0.8 quando é dedução; < 0.5 quando é palpite.
- motivo: até 8 palavras.

COMPRAS
${itens.map(linhaItem).join('\n')}

Responda com um item por id.`
}

export interface OpcoesIA {
  apiKey: string
  deadlineMs: number
  /** Para testes: substitui a chamada ao Gemini. */
  gerar?: typeof gerarRodada
}

/**
 * Classifica um lote. Devolve só os ids que o modelo respondeu com uma
 * categoria válida — o que faltar fica sem categoria (para a próxima
 * rodada), nunca "Outros" por falha técnica.
 */
export async function classificarLoteIA(
  itens: ItemParaIA[],
  permitidas: string[],
  exemplosGerais: Array<{ chave: string; categoria: string }>,
  adquirentes: Record<string, string>,
  opts: OpcoesIA
): Promise<Map<string, RespostaIA>> {
  const gerar = opts.gerar ?? gerarRodada
  const rodada = await gerar({
    apiKey: opts.apiKey,
    deadlineMs: opts.deadlineMs,
    // Tarefa de classificação: raciocínio baixo basta e sai mais barato.
    thinkingBudget: 1024,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        itens: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              categoria: { type: 'STRING', enum: permitidas },
              confianca: { type: 'NUMBER' },
              motivo: { type: 'STRING' },
            },
            required: ['id', 'categoria', 'confianca'],
          },
        },
      },
      required: ['itens'],
    },
    contents: [{ role: 'user', parts: [{ text: montarPromptCategorizacao(itens, permitidas, exemplosGerais, adquirentes) }] }],
  })

  let json: { itens?: Array<{ id?: unknown; categoria?: unknown; confianca?: unknown; motivo?: unknown }> }
  try {
    json = JSON.parse(rodada.texto)
  } catch {
    throw new GeminiError(`Resposta da IA não é JSON: ${rodada.texto.slice(0, 200)}`, 'DESCONHECIDO')
  }

  const ids = new Set(itens.map(i => i.id))
  const resultado = new Map<string, RespostaIA>()
  for (const r of json.itens ?? []) {
    const id = String(r.id ?? '')
    if (!ids.has(id) || resultado.has(id)) continue
    const categoria = resolverNomeCategoria(r.categoria, permitidas)
    if (!categoria) continue
    const confianca = Math.max(0, Math.min(1, Number(r.confianca) || 0))
    resultado.set(id, { categoria, confianca, motivo: typeof r.motivo === 'string' ? r.motivo.slice(0, 120) : '' })
  }
  return resultado
}
