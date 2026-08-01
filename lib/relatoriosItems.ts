import type { LucideIcon } from 'lucide-react'
import { FileBarChart } from 'lucide-react'

export interface RelatorioDisponivel {
  href: string
  titulo: string
  descricao: string
  Icon: LucideIcon
  iconBg: string
  iconColor: string
}

// Catálogo de relatórios disponíveis em /relatorios. Para adicionar um novo
// relatório: crie a página em app/relatorios/<slug>/page.tsx e inclua uma
// entrada aqui — o hub em app/relatorios/page.tsx lista este array automaticamente.
export const RELATORIOS_DISPONIVEIS: RelatorioDisponivel[] = [
  {
    href: '/relatorios/mensal',
    titulo: 'Relatório Gerencial Mensal',
    descricao: 'Receitas, despesas, compras e investimentos do mês em PDF ou CSV',
    Icon: FileBarChart,
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
  },
]
