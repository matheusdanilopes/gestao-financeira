import type { LucideIcon } from 'lucide-react'
import {
  FileBarChart, CreditCard, Tags, RepeatIcon, CalendarRange, Target, Database,
} from 'lucide-react'

export type GrupoRelatorio = 'mes' | 'tendencias' | 'cartao' | 'dados'

export interface RelatorioDisponivel {
  href: string
  titulo: string
  descricao: string
  Icon: LucideIcon
  iconBg: string
  iconColor: string
  grupo: GrupoRelatorio
  /** Período coberto, mostrado como chip no card. */
  periodo: string
  /** Perguntas que o relatório responde — aparecem no card e alimentam a busca. */
  responde: string[]
}

export const GRUPOS_RELATORIOS: { chave: GrupoRelatorio; titulo: string; descricao: string }[] = [
  { chave: 'mes', titulo: 'O mês', descricao: 'Fechamento e execução do mês corrente' },
  { chave: 'tendencias', titulo: 'Tendências', descricao: 'Como os números se movem ao longo do tempo' },
  { chave: 'cartao', titulo: 'Cartão e recorrentes', descricao: 'Fatura, parcelas e cobranças que se repetem' },
  { chave: 'dados', titulo: 'Dados brutos', descricao: 'Exportação para planilha ou para outra IA' },
]

// Catálogo de relatórios disponíveis em /relatorios. Para adicionar um novo
// relatório: crie a página em app/relatorios/<slug>/page.tsx e inclua uma
// entrada aqui — o hub em app/relatorios/page.tsx lista este array automaticamente.
export const RELATORIOS_DISPONIVEIS: RelatorioDisponivel[] = [
  {
    href: '/relatorios/mensal',
    titulo: 'Relatório Gerencial Mensal',
    descricao: 'Receitas, despesas, compras e investimentos do mês, com comparação com o mês anterior',
    Icon: FileBarChart,
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
    grupo: 'mes',
    periodo: 'Mês selecionado',
    responde: ['Como fechei o mês?', 'O que ainda falta pagar?', 'Quanto sobrou?'],
  },
  {
    href: '/relatorios/orcamento',
    titulo: 'Previsto x Realizado',
    descricao: 'Aderência ao orçamento, maiores desvios e itens que estouram todo mês',
    Icon: Target,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    grupo: 'mes',
    periodo: '3, 6 ou 12 meses',
    responde: ['Meu planejamento está calibrado?', 'O que sempre estoura?'],
  },
  {
    href: '/relatorios/categorias',
    titulo: 'Raio-X por Categoria',
    descricao: 'Ranking de categorias, tendência contra a própria média e gastos que se repetem',
    Icon: Tags,
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
    grupo: 'tendencias',
    periodo: '3, 6 ou 12 meses',
    responde: ['Para onde vai meu dinheiro?', 'O que subiu no último mês?'],
  },
  {
    href: '/relatorios/anual',
    titulo: 'Fechamento Anual',
    descricao: 'Os 12 meses lado a lado, taxa de poupança e comparação com o ano anterior',
    Icon: CalendarRange,
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
    grupo: 'tendencias',
    periodo: 'Ano civil',
    responde: ['Como foi o ano?', 'Gastei mais que no ano passado?'],
  },
  {
    href: '/relatorios/cartoes',
    titulo: 'Gastos no Cartão',
    descricao: 'Histórico da fatura, categorias, projeção de parcelas e parcelamentos em aberto',
    Icon: CreditCard,
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
    grupo: 'cartao',
    periodo: '6, 12 ou 24 meses',
    responde: ['Quanto vou pagar de fatura?', 'Quanto já está comprometido?'],
  },
  {
    href: '/relatorios/assinaturas',
    titulo: 'Assinaturas',
    descricao: 'Custo mensal e anual das recorrentes, reajustes do ano e economia com pausas',
    Icon: RepeatIcon,
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
    grupo: 'cartao',
    periodo: 'Mês atual + 12 meses',
    responde: ['Quanto gasto em assinaturas por ano?', 'O que reajustou?'],
  },
  {
    href: '/relatorios/dados-ia',
    titulo: 'Dados para IA',
    descricao: 'Exporta os dados do app em Markdown ou JSON, com dicionário e perguntas prontas',
    Icon: Database,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-600',
    grupo: 'dados',
    periodo: '1 a 12 meses',
    responde: ['Quero analisar meus dados em outra IA', 'Preciso dos dados em planilha'],
  },
]
