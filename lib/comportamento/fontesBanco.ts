/**
 * Fontes da Análise do Fin que o banco já entrega prontas.
 *
 * As views `vw_analise_*` (supabase/migration_analise_fin_views.sql) fazem no
 * Postgres o que as tabelas cruas não dizem e seria caro ou frágil refazer a
 * cada análise:
 *  - a chave estável de cada conta do planejamento ("Imposto de Renda 4/8" e
 *    "Prestação Giardini" viram "imposto de renda" e "giardini"), sem a qual
 *    contas parceladas ou renomeadas pareciam gasto fora da rotina;
 *  - receita recorrente × extraordinária (férias, 13º, cashback);
 *  - estorno ↔ compra original (a compra devolvida que ainda conta como gasto);
 *  - cobranças mensais no cartão × assinaturas cadastradas;
 *  - cobranças lançadas em dobro;
 *  - categorização duvidosa e faturas pagas sem compras importadas.
 *
 * Tudo aqui é complemento: se as views não existirem (migração não aplicada)
 * ou a leitura falhar, a análise segue com o cálculo de antes e um aviso.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { lerTabela } from '@/lib/ai/data/leitura'

export interface ContaBanco {
  chave: string
  tipo: 'receita' | 'cartao' | 'conta'
  parcelaAtual: number | null
  totalParcelas: number | null
  valorRecebido: number
  /** Só para receitas: null quando a linha não é receita. */
  receitaRecorrente: boolean | null
}

export type SituacaoEstorno = 'pareado' | 'original_ativo' | 'sem_par' | 'duplicado'

export interface EstornoBanco {
  id: string
  descricao: string
  valor: number
  data: string
  projetoFatura: string
  originalId: string | null
  originalDescricao: string | null
  situacao: SituacaoEstorno
}

export type SituacaoRecorrencia = 'cadastrada' | 'preco_diferente' | 'inativa_cobrada' | 'nao_cadastrada'

export interface RecorrenciaBanco {
  descricao: string
  tipo: 'iof' | 'cobranca'
  faturas: number
  valorUltimo: number
  ultimaData: string
  categoria: string | null
  categoriasUsadas: number
  listaCategorias: string | null
  responsavel: string | null
  assinaturaId: string | null
  assinaturaNome: string | null
  assinaturaValor: number | null
  situacao: SituacaoRecorrencia
}

export interface CobrancaDuplicadaBanco {
  descricao: string
  valor: number
  data: string
  projetoFatura: string
  vezes: number
  responsavel: string | null
  categoria: string | null
  valorAMais: number
}

export interface CategorizacaoBanco {
  /** 'YYYY-MM' */
  mes: string
  responsavel: string
  compras: number
  valor: number
  revisaoPendente: number
  revisaoPendenteValor: number
  semCategoria: number
  semCategoriaValor: number
}

export interface CoberturaFaturaBanco {
  /** 'YYYY-MM' */
  mes: string
  cartao: string
  paga: boolean
  valorPago: number
  valorImportado: number
  pctSemDetalhe: number | null
}

export interface FontesBanco {
  /** Por id da linha do planejamento. */
  planejamento: Map<string, ContaBanco>
  estornos: EstornoBanco[]
  recorrencias: RecorrenciaBanco[]
  duplicadas: CobrancaDuplicadaBanco[]
  categorizacao: CategorizacaoBanco[]
  cobertura: CoberturaFaturaBanco[]
  /** Views que não puderam ser lidas. */
  falhas: string[]
}

type Linha = Record<string, unknown>

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const numOuNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v))
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const strOuNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const mes = (v: unknown): string => str(v).substring(0, 7)

export function fontesVazias(falhas: string[] = []): FontesBanco {
  return {
    planejamento: new Map(),
    estornos: [],
    recorrencias: [],
    duplicadas: [],
    categorizacao: [],
    cobertura: [],
    falhas,
  }
}

/** Converte as linhas cruas das views (também usado nos testes). */
export function montarFontes(linhas: {
  planejamento?: Linha[]
  estornos?: Linha[]
  recorrencias?: Linha[]
  duplicadas?: Linha[]
  categorizacao?: Linha[]
  cobertura?: Linha[]
}, falhas: string[] = []): FontesBanco {
  const fontes = fontesVazias(falhas)

  for (const l of linhas.planejamento ?? []) {
    const id = str(l.id)
    if (!id) continue
    const tipo = str(l.tipo)
    fontes.planejamento.set(id, {
      chave: str(l.chave),
      tipo: tipo === 'receita' || tipo === 'cartao' ? tipo : 'conta',
      parcelaAtual: numOuNull(l.parcela_atual),
      totalParcelas: numOuNull(l.total_parcelas),
      valorRecebido: num(l.valor_recebido),
      receitaRecorrente: typeof l.receita_recorrente === 'boolean' ? l.receita_recorrente : null,
    })
  }

  const situacoesEstorno: SituacaoEstorno[] = ['pareado', 'original_ativo', 'sem_par', 'duplicado']
  fontes.estornos = (linhas.estornos ?? []).map(l => ({
    id: str(l.id),
    descricao: str(l.descricao),
    valor: num(l.valor),
    data: str(l.data),
    projetoFatura: mes(l.projeto_fatura),
    originalId: strOuNull(l.original_id),
    originalDescricao: strOuNull(l.original_descricao),
    situacao: situacoesEstorno.includes(l.situacao as SituacaoEstorno) ? (l.situacao as SituacaoEstorno) : 'sem_par',
  }))

  const situacoesRec: SituacaoRecorrencia[] = ['cadastrada', 'preco_diferente', 'inativa_cobrada', 'nao_cadastrada']
  fontes.recorrencias = (linhas.recorrencias ?? [])
    .filter(l => situacoesRec.includes(l.situacao as SituacaoRecorrencia))
    .map(l => ({
      descricao: str(l.descricao),
      tipo: l.tipo === 'iof' ? 'iof' as const : 'cobranca' as const,
      faturas: num(l.faturas),
      valorUltimo: num(l.valor_ultimo),
      ultimaData: str(l.ultima_data),
      categoria: strOuNull(l.categoria),
      categoriasUsadas: num(l.categorias_usadas),
      listaCategorias: strOuNull(l.lista_categorias),
      responsavel: strOuNull(l.responsavel),
      assinaturaId: strOuNull(l.assinatura_id),
      assinaturaNome: strOuNull(l.assinatura_nome),
      assinaturaValor: numOuNull(l.assinatura_valor),
      situacao: l.situacao as SituacaoRecorrencia,
    }))

  fontes.duplicadas = (linhas.duplicadas ?? []).map(l => ({
    descricao: str(l.descricao),
    valor: num(l.valor),
    data: str(l.data),
    projetoFatura: mes(l.projeto_fatura),
    vezes: num(l.vezes),
    responsavel: strOuNull(l.responsavel),
    categoria: strOuNull(l.categoria),
    valorAMais: num(l.valor_a_mais),
  }))

  fontes.categorizacao = (linhas.categorizacao ?? []).map(l => ({
    mes: mes(l.mes),
    responsavel: str(l.responsavel),
    compras: num(l.compras),
    valor: num(l.valor),
    revisaoPendente: num(l.revisao_pendente),
    revisaoPendenteValor: num(l.revisao_pendente_valor),
    semCategoria: num(l.sem_categoria),
    semCategoriaValor: num(l.sem_categoria_valor),
  }))

  fontes.cobertura = (linhas.cobertura ?? []).map(l => ({
    mes: mes(l.mes),
    cartao: str(l.cartao),
    paga: l.paga === true,
    valorPago: num(l.valor_pago),
    valorImportado: num(l.valor_importado),
    pctSemDetalhe: numOuNull(l.pct_sem_detalhe),
  }))

  return fontes
}

const VIEWS = {
  planejamento: {
    tabela: 'vw_analise_planejamento',
    colunas: ['id', 'tipo', 'chave', 'parcela_atual', 'total_parcelas', 'valor_recebido', 'receita_recorrente'],
    ordem: [{ coluna: 'id', asc: true }],
  },
  estornos: {
    tabela: 'vw_analise_estornos',
    colunas: ['id', 'descricao', 'valor', 'data', 'projeto_fatura', 'original_id', 'original_descricao', 'situacao'],
    ordem: [{ coluna: 'id', asc: true }],
  },
  recorrencias: {
    tabela: 'vw_analise_recorrencias',
    colunas: ['descricao', 'tipo', 'faturas', 'valor_ultimo', 'ultima_data', 'categoria', 'categorias_usadas', 'lista_categorias', 'responsavel', 'assinatura_id', 'assinatura_nome', 'assinatura_valor', 'situacao'],
    ordem: [{ coluna: 'chave', asc: true }, { coluna: 'valor_ultimo', asc: true }],
  },
  duplicadas: {
    tabela: 'vw_analise_cobrancas_duplicadas',
    colunas: ['descricao', 'valor', 'data', 'projeto_fatura', 'vezes', 'responsavel', 'categoria', 'valor_a_mais'],
    ordem: [{ coluna: 'data', asc: false }, { coluna: 'descricao', asc: true }],
  },
  categorizacao: {
    tabela: 'vw_analise_categorizacao_mensal',
    colunas: ['mes', 'responsavel', 'compras', 'valor', 'revisao_pendente', 'revisao_pendente_valor', 'sem_categoria', 'sem_categoria_valor'],
    ordem: [{ coluna: 'mes', asc: true }, { coluna: 'responsavel', asc: true }],
  },
  cobertura: {
    tabela: 'vw_analise_faturas_cobertura',
    colunas: ['mes', 'cartao', 'paga', 'valor_pago', 'valor_importado', 'pct_sem_detalhe'],
    ordem: [{ coluna: 'mes', asc: true }, { coluna: 'cartao', asc: true }],
  },
} as const

/** Lê todas as views em paralelo. Nunca lança: o que falhar vai em `falhas`. */
export async function carregarFontesBanco(supabase: SupabaseClient): Promise<FontesBanco> {
  const falhas: string[] = []
  const ler = async (nome: keyof typeof VIEWS): Promise<Linha[]> => {
    const v = VIEWS[nome]
    try {
      const { linhas } = await lerTabela<Linha>(supabase, {
        tabela: v.tabela,
        colunas: [...v.colunas],
        ordem: v.ordem.map(o => ({ ...o })),
        maxPaginas: 10,
      })
      return linhas
    } catch (err) {
      console.error(`[analise-fin] ${v.tabela}:`, err instanceof Error ? err.message : err)
      falhas.push(v.tabela)
      return []
    }
  }

  const [planejamento, estornos, recorrencias, duplicadas, categorizacao, cobertura] = await Promise.all([
    ler('planejamento'), ler('estornos'), ler('recorrencias'),
    ler('duplicadas'), ler('categorizacao'), ler('cobertura'),
  ])
  return montarFontes({ planejamento, estornos, recorrencias, duplicadas, categorizacao, cobertura }, falhas)
}
