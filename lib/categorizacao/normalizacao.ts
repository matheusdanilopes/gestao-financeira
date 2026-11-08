/**
 * Da descrição da fatura ao "estabelecimento".
 *
 * A descrição raramente é o nome da loja: vem com prefixo de maquininha
 * ("MP *", "ZP*", "IFD*"), sufixo de parcela ("- Parcela 2/5"), o nome de quem
 * comprou ("- Jeniffer") e números soltos. Antes, a memória de categorias
 * guardava tudo isso junto ("MERCADOLIVRE MERCADOL PARCELA 1 6"), e a parcela
 * 2/6 da mesma compra não casava com a 1/6 — enquanto o token "PARCELA" fazia
 * lojas diferentes parecerem iguais.
 */

export interface Estabelecimento {
  /** Chave estável do estabelecimento: minúsculas, sem acento, prefixo, parcela ou responsável. */
  chave: string
  /** Maquininha/intermediário que veio no prefixo (ex.: "ifd" = pago pelo iFood). */
  adquirente?: string
  /** Compra em marketplace/loja de departamento: o nome não diz o que foi comprado. */
  marketplace: boolean
  /** Marketplace sem vendedor identificável ("Mercadolivre*Mercadol", "Havan Maringa"). */
  generico: boolean
  /** Parte que identifica o vendedor dentro do marketplace (ex.: "blzcosme"). */
  vendedor?: string
}

const PREFIXOS = [
  'pagseguro', 'pags', 'pag', 'pgz', 'pg', 'mercadopago', 'merpago', 'mp', 'ec', 'ifd', 'dl', 'dm', 'sumup',
  'stone', 'cielo', 'paypal', 'pp', 'sq', 'zp', 'htm', 'ebn', 'ton', 'getnet', 'rede', 'picpay', 'pic', 'hna',
  'jim com', 'jim', 'paygo', 'cappta', 'pagbank', 'infinitepay', 'ip',
]

export const DESCRICAO_ADQUIRENTE: Record<string, string> = {
  ifd: 'pago pelo iFood (delivery de comida, mercado ou farmácia)',
  hna: 'loja online da rede O Boticário/Natura',
  mp: 'Mercado Pago (maquininha de pequeno comércio ou prestador)',
  mercadopago: 'Mercado Pago (maquininha de pequeno comércio ou prestador)',
  pg: 'PagSeguro (maquininha de pequeno comércio ou prestador)',
  zp: 'maquininha de pequeno comércio ou prestador',
  dl: 'pagamento digital de app (ex.: Uber)',
}

/** Marketplaces e lojas de departamento: o nome não indica o que foi comprado. */
const MARKETPLACE = /^(?:mercado ?livre|mercadolivre|mercado mercadolivre|mp mercadolivre|mercadolibre|amazon(?:mktplc| marketplace)?|amazonmktplc|shopee|magalu|magazine luiza|havan|site havan|aliexpress|temu|americanas|casas bahia|shein marketplace|kabum)\b/

/** Palavras que não identificam vendedor dentro de um marketplace. */
const RUIDO_MARKETPLACE = new Set([
  'mercado', 'livre', 'mercadolivre', 'mercadol', 'mercadoli', 'mercadolibre', 'mp', 'amazon', 'amazonmktplc',
  'mktplc', 'marketplace', 'shopee', 'magalu', 'mparc', 'havan', 'site', 'com', 'br', 'aliexpress', 'temu',
  'americanas', 'casas', 'bahia', 'kabum', 'maringa', 'avenida', 'av', 'colom', 'loja', 'lojas', 'store',
])

const RESPONSAVEIS_PADRAO = ['jeniffer', 'matheus', 'conjunto']

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function normalizarEstabelecimento(descricao: string, responsaveis: string[] = RESPONSAVEIS_PADRAO): Estabelecimento {
  let s = semAcento(String(descricao ?? '')).toLowerCase().trim()

  // IOF de "Claude.Ai Subscription" → o estabelecimento é o de dentro das aspas.
  const iof = s.match(/^iof de\s+"([^"]+)"/)
  if (iof) s = iof[1]

  // Sufixos: parcela ("- Parcela 2/5", "Parc 7/10", " 2/2"), meio de pagamento e responsável.
  const resp = responsaveis.map(r => semAcento(r).toLowerCase()).join('|')
  for (let i = 0; i < 3; i++) {
    s = s
      // "(Parcela 4 de 10)" que o importador antigo acrescentava
      .replace(/\s*\(parcela\s*\d+\s*de\s*\d+\)\s*$/, '')
      // "Havefuparc 4/12": "parc" grudado no nome (≥3 letras antes, para não comer o "mparc" da Magalu)
      .replace(/(\w{3,})parc\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/, '$1')
      .replace(/\s*[-–]?\s*\bparc(?:ela)?\.?\s*\d+\s*(?:\/|de|\s)\s*\d+\s*$/, '')
      .replace(/(\D)\d{1,2}\/\d{1,2}\s*$/, '$1')
      .replace(/\s*[-–]?\s*parcela\s*$/, '')
      .replace(/\s+[-–]\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/, '')
      .replace(/\s*[-–]\s*$/, '')
      .replace(/\s*[-–]\s*nupay\s*$/, '')
      .replace(new RegExp(`\\s*[-–]\\s*(?:${resp})\\s*$`), '')
      .trim()
  }
  // Formato antigo da memória ("... PARCELA 1 6").
  s = s.replace(/\s+parcela(?:\s+\d+\s+\d+)?\s*$/, '')

  // Prefixo de maquininha: "mp *loja", "ifd*loja", "jim.com* loja".
  let adquirente: string | undefined
  const semPontos = s.replace(/\./g, ' ')
  for (const p of PREFIXOS) {
    const re = new RegExp(`^${p.replace(' ', '\\s+')}\\s*\\*\\s*`)
    if (re.test(semPontos)) {
      adquirente = p.replace(' com', '')
      s = semPontos.replace(re, '')
      break
    }
  }

  const chave = s
    .replace(/\*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ') // ids, CNPJ, número de pedido
    .replace(/\s+/g, ' ')
    .trim()

  const marketplace = MARKETPLACE.test(chave)
  const vendedorTokens = marketplace
    ? chave.split(' ').filter(t => t.length >= 3 && !RUIDO_MARKETPLACE.has(t) && !/^\d+$/.test(t))
    : []
  return {
    chave: chave || semAcento(String(descricao ?? '')).toLowerCase().trim(),
    adquirente,
    marketplace,
    generico: marketplace && vendedorTokens.length === 0,
    vendedor: vendedorTokens.length > 0 ? vendedorTokens.join(' ') : undefined,
  }
}

export const chaveEstabelecimento = (descricao: string) => normalizarEstabelecimento(descricao).chave

export function descreverAdquirente(adquirente?: string): string | undefined {
  return adquirente ? DESCRICAO_ADQUIRENTE[adquirente] : undefined
}

/** Palavras que não ajudam a dizer se dois estabelecimentos são o mesmo. */
const STOPWORDS = new Set([
  'parcela', 'parc', 'nupay', 'comercio', 'com', 'ltda', 'me', 'eireli', 'epp', 'sa', 'de', 'da', 'do', 'dos', 'das',
  'e', 'maringa', 'shopping', 'sh', 'loja', 'lojas', 'filial', 'centro', 'av', 'avenida', 'rua', 'br', 'brasil',
])

export function tokensInformativos(chave: string): string[] {
  return [...new Set(chave.split(' ').filter(t => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t)))]
}

export function similaridade(a: string, b: string): number {
  const ta = new Set(tokensInformativos(a))
  const tb = new Set(tokensInformativos(b))
  if (ta.size === 0 || tb.size === 0) return 0
  const inter = [...ta].filter(t => tb.has(t)).length
  return inter / new Set([...ta, ...tb]).size
}

/**
 * Chaves gravadas pelo sanitizador antigo perderam o asterisco ("MP MELIMAIS"):
 * tira o prefixo de maquininha mesmo sem ele. Só para a memória antiga — numa
 * descrição nova, "pg" sem asterisco pode ser parte do nome.
 */
export function chaveDeMemoriaAntiga(descricaoLimpa: string): string {
  const { chave } = normalizarEstabelecimento(descricaoLimpa)
  for (const p of PREFIXOS) {
    const re = new RegExp(`^${p.replace(' ', '\\s+')}\\s+`)
    if (re.test(chave) && chave.replace(re, '').trim()) return chave.replace(re, '').trim()
  }
  return chave
}

/** Dados mínimos para reconhecer parcelas da mesma compra. */
export interface IdentidadeCompra {
  descricao: string
  total_parcelas?: number | null
  responsavel?: string | null
  valor: number | string
}

/**
 * Duas linhas são parcelas da MESMA compra: mesmo estabelecimento, mesmo
 * número de parcelas, mesmo responsável e valor igual (tolerância de centavos
 * de arredondamento: 25,55 × 25,49).
 */
export function ehMesmaCompra(a: IdentidadeCompra, b: IdentidadeCompra): boolean {
  const ta = a.total_parcelas ?? 0
  const tb = b.total_parcelas ?? 0
  if (ta <= 1 || ta !== tb) return false
  if ((a.responsavel ?? '') !== (b.responsavel ?? '')) return false
  if (normalizarEstabelecimento(a.descricao).chave !== normalizarEstabelecimento(b.descricao).chave) return false
  const va = Math.abs(Number(a.valor) || 0)
  const vb = Math.abs(Number(b.valor) || 0)
  return Math.abs(va - vb) <= Math.max(0.1, va * 0.02)
}

/** Descrição sem o sufixo de parcela — para buscar as irmãs no banco. */
export function descricaoSemParcela(descricao: string): string {
  return descricao.replace(/\s*[-–]?\s*parc(?:ela)?\.?\s*\d+\s*\/\s*\d+\s*$/i, '').trim()
}
