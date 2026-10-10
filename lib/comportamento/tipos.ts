/**
 * Tipos da Análise de Comportamento, compartilhados entre a rota
 * (/api/analise-comportamento) e a tela (/analise-comportamento).
 *
 * Fica separado do motor de métricas e do analista para a tela não arrastar
 * código de servidor (cliente do Gemini, leitura do banco) para o bundle.
 */

/**
 * Janela da análise em meses. `1` é especial: o último mês fechado, com todas
 * as compras das faturas pagas nele, comparado com os 6 meses anteriores (o
 * "normal" da pessoa).
 */
export const JANELAS_ANALISE = [1, 6, 12, 24] as const
export type JanelaAnalise = typeof JANELAS_ANALISE[number]
export const JANELA_ULTIMO_MES: JanelaAnalise = 1
/** Meses anteriores usados como base de comparação do último mês. */
export const MESES_BASE_ULTIMO_MES = 6

export function rotuloJanela(janela: number): string {
  return janela === JANELA_ULTIMO_MES ? 'Último mês' : `${janela} meses`
}

/** 'casal' = todos os responsáveis; um nome = só os lançamentos daquela pessoa. */
export type EscopoAnalise = 'casal' | 'Matheus' | 'Jeniffer'

export const OBJETIVOS_ANALISE = [
  { chave: 'entender', label: 'Entender meus padrões' },
  { chave: 'gastar_menos', label: 'Gastar menos' },
  { chave: 'poupar_mais', label: 'Poupar e investir mais' },
  { chave: 'sair_do_aperto', label: 'Sair do aperto / parcelas' },
  { chave: 'meta', label: 'Juntar para uma meta' },
] as const
export type ObjetivoAnalise = typeof OBJETIVOS_ANALISE[number]['chave']

export interface ParametrosAnalise {
  janela: JanelaAnalise
  escopo: EscopoAnalise
  objetivo: ObjetivoAnalise
  /** Contexto livre do usuário ("quero trocar de carro em 2027"). */
  contexto?: string
}

// ─── Métricas determinísticas ────────────────────────────────────────────────

export interface MesComportamento {
  /** 'YYYY-MM' */
  mes: string
  /** true para o mês corrente, ainda em andamento (fora das médias). */
  parcial: boolean
  receita: number
  gastoCartao: number
  contas: number
  gastoTotal: number
  saldo: number
  /** (receita - gasto) / receita, em %. null sem receita registrada. */
  taxaPoupanca: number | null
  aportes: number
  comprasNovas: number
  novosParcelamentos: number
}

export interface FatiaTempo {
  rotulo: string
  total: number
  quantidade: number
  /** % do valor das compras novas. */
  pctValor: number
  ticketMedio: number
}

export interface FaixaTicket {
  faixa: string
  quantidade: number
  total: number
  pctQuantidade: number
  pctValor: number
}

export interface Estabelecimento {
  nome: string
  categoria: string
  quantidade: number
  total: number
  ticketMedio: number
  /** Em quantos meses do período apareceu. */
  mesesPresente: number
}

export interface CategoriaComportamento {
  categoria: string
  total: number
  pct: number
  mediaMensal: number
  /** Média dos 3 meses fechados mais recentes. */
  mediaRecente: number
  /** Média dos meses fechados anteriores a esses 3. */
  mediaAnterior: number
  /** Variação % recente vs. anterior. null sem base. */
  variacaoPct: number | null
  /** Coeficiente de variação mensal (%): quanto o gasto oscila. */
  oscilacaoPct: number
  mesesComGasto: number
}

export interface CompraAtipica {
  data: string
  descricao: string
  categoria: string
  responsavel: string
  valor: number
  /** Quantas vezes a mediana das compras da mesma categoria. */
  vezesMediana: number
  parcelada: boolean
}

export interface ItemQueEstoura {
  item: string
  categoria: string
  mesesEstourados: number
  mesesAvaliados: number
  excessoMedio: number
}

export interface IndicadorSaude {
  chave: string
  nome: string
  /** 0–100 */
  nota: number
  /** Valor medido, já formatado para leitura. */
  medida: string
  referencia: string
}

/** Um valor do mês em foco e a média dos meses anteriores. */
export interface Comparativo {
  atual: number
  base: number
  /** Variação % atual vs. base. null sem base. */
  variacaoPct: number | null
}

/** Uma linha de fatura enviada ao analista no modo "último mês". */
export interface LancamentoFatura {
  /** Data registrada na linha. Numa parcela em andamento é a data de abertura da fatura, não a da compra. */
  data: string
  descricao: string
  categoria: string
  responsavel: string
  cartao: string
  valor: number
  /** "3/10" quando é parcela. */
  parcela: string | null
  tipo: 'compra_nova' | 'parcela_em_andamento'
}

export interface MesFoco {
  /** 'YYYY-MM' — mês fechado analisado (faturas pagas nele). */
  mes: string
  mesesBase: number
  /** Compras novas (à vista ou 1ª parcela, pelo valor cheio). */
  compras: { valor: Comparativo; quantidade: Comparativo; ticketMedio: Comparativo }
  /** Parcelas de compras antigas que caíram nesta fatura. */
  parcelasEmAndamento: { valor: Comparativo; quantidade: number }
  /** Total das faturas pagas no mês (compras novas pela parcela + parcelas em andamento). */
  faturas: Comparativo
  contas: Comparativo
  receita: Comparativo | null
  saldo: Comparativo | null
  microgastos: { valor: Comparativo; quantidade: Comparativo }
  novosParcelamentos: { quantidade: Comparativo; valorFinanciado: Comparativo }
  fimDeSemanaPctValor: Comparativo
  categorias: Array<{ categoria: string } & Comparativo>
  estabelecimentos: Array<{ nome: string; quantidade: number; total: number; quantidadeBase: number }>
  /** Categorias/lugares que apareceram agora e não existiam nos meses de base. */
  novidades: string[]
  /** Todas as linhas das faturas pagas no mês. */
  lancamentos: LancamentoFatura[]
}

export interface MetricasComportamento {
  geradoEm: string
  escopo: EscopoAnalise
  /** 'meses' = vários meses fechados; 'ultimo_mes' = foco no último mês fechado (os anteriores viram contexto). */
  modo: 'meses' | 'ultimo_mes'
  /** Só no modo 'ultimo_mes'. */
  mesFoco: MesFoco | null
  periodo: {
    inicio: string
    fim: string
    mesesFechados: number
    mesParcial: string
    /** Mês mais antigo com dados no banco ('YYYY-MM'), para a IA saber se o histórico é curto. */
    primeiroMesComDados: string | null
  }
  mensal: MesComportamento[]
  resumo: {
    receitaMedia: number
    gastoMedio: number
    saldoMedio: number
    taxaPoupancaMedia: number | null
    mesesNoVermelho: number
    /** Gasto médio dos 3 meses fechados mais recentes vs. os 3 anteriores (%). */
    tendenciaGastoPct: number | null
    /** Coeficiente de variação do gasto mensal (%). */
    oscilacaoGastoPct: number
    mesMaisCaro: { mes: string; valor: number } | null
    mesMaisBarato: { mes: string; valor: number } | null
  }
  saude: { nota: number; indicadores: IndicadorSaude[] }
  quando: {
    diasSemana: FatiaTempo[]
    fimDeSemanaPctValor: number
    fasesDoMes: FatiaTempo[]
    /** Em média, quantas compras por dia com compra. */
    comprasPorDiaAtivo: number
    diasComCompra: number
    /** Dias com 5 ou mais compras novas — sinal de "dia de farra". */
    diasIntensos: Array<{ data: string; quantidade: number; total: number }>
    /**
     * Compras feitas até 6 dias depois de um recebimento de receita. Uma
     * semana é ~23% do mês: bem acima disso, o dinheiro "queima" ao entrar.
     */
    semanaDoRecebimento: { pctValor: number; esperadoPct: number; diasDeRecebimento: number[] } | null
  }
  ticket: {
    faixas: FaixaTicket[]
    ticketMedio: number
    ticketMediano: number
    microgastos: { limite: number; quantidade: number; total: number; mediaMensal: number; pctDoValor: number }
  }
  estabelecimentos: Estabelecimento[]
  categorias: CategoriaComportamento[]
  responsaveis: Array<{ nome: string; total: number; pct: number; quantidade: number; ticketMedio: number }>
  parcelamentos: {
    comprasParceladas: number
    pctComprasParceladas: number
    valorFinanciado: number
    mediaParcelas: number
    /** Parcelas já contratadas para os próximos meses. */
    compromissoFuturo: Array<{ mes: string; valor: number }>
    /** Parcela do próximo mês como % da receita média. */
    pctReceitaProximoMes: number | null
  }
  planejamento: {
    previstoMedio: number
    realizadoMedio: number
    /** Realizado / previsto das contas pagas, em %. */
    aderenciaPct: number | null
    itensQueEstouram: ItemQueEstoura[]
    contasPagas: number
    pagasComAtraso: number
    atrasoMedioDias: number
    vencidasEmAberto: number
  }
  assinaturas: {
    ativas: number
    custoMensal: number
    pctDaReceita: number | null
    maiores: Array<{ nome: string; valor: number; categoria: string }>
  }
  investimentos: {
    totalAportado: number
    mediaMensal: number
    mesesComAporte: number
    pctDaReceita: number | null
    saldoInformado: number | null
  }
  comprasAtipicas: CompraAtipica[]
  estornos: { quantidade: number; total: number }
  desejos: { pendentes: number; valorPendente: number; realizadosNoPeriodo: number; valorRealizado: number }
  qualidade: { comprasSemCategoriaPct: number; comprasAnalisadas: number; avisos: string[] }
}

// ─── Leitura do analista (IA) ────────────────────────────────────────────────

export type Nivel = 'alta' | 'media' | 'baixa'

export interface AnaliseIA {
  manchete: string
  resumo: string
  perfil: { nome: string; descricao: string; tracos: string[] }
  padroes: Array<{
    titulo: string
    descricao: string
    evidencia: string
    impacto: 'positivo' | 'negativo' | 'neutro'
    relevancia: Nivel
  }>
  gatilhos: Array<{ titulo: string; descricao: string; evidencia: string }>
  pontosFortes: Array<{ titulo: string; descricao: string }>
  riscos: Array<{ titulo: string; descricao: string; probabilidade: Nivel }>
  planoDeAcao: Array<{
    acao: string
    porque: string
    economiaMensal: number
    dificuldade: 'facil' | 'media' | 'dificil'
    prazo: string
  }>
  metas: Array<{ meta: string; indicador: string; alvo: string; prazo: string }>
  perguntas: string[]
  limitacoes: string[]
}

export interface ResultadoAnalise {
  parametros: ParametrosAnalise
  metricas: MetricasComportamento
  analise: AnaliseIA
  geradaEm: string
}
