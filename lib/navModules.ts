import { IconeFin, type IconeCompativel } from '@/components/chat/IconeFin'
import {
  IconeCarteira, IconeCartao, IconeChecklist, IconeEngrenagem,
  IconeDespesas, IconeReceitas, IconeCofrinho,
  IconeCarrinho, IconeAssinaturas, IconeParcelas, IconeComprasPrevistas,
  IconeCoracao, IconeCesta, IconeCoroa,
  IconeRelatorio, IconeGrafico,
} from '@/components/icones/IconesIlustrados'

export interface NavModuleItem {
  href: string
  label: string
  Icon: IconeCompativel
  iconBg: string
  /** Só aparece no dropdown desktop — ex: Analytics, pensado pra tela larga. */
  desktopOnly?: boolean
}

export interface NavModule {
  key: string
  label: string
  Icon: IconeCompativel
  items: NavModuleItem[]
}

const financas: NavModule = {
  key: 'financas',
  label: 'Finanças',
  Icon: IconeCarteira,
  items: [
    { href: '/financas?tab=despesas', label: 'Despesas', Icon: IconeDespesas, iconBg: 'bg-red-50' },
    { href: '/financas?tab=receitas', label: 'Receitas', Icon: IconeReceitas, iconBg: 'bg-green-50' },
    { href: '/financas?tab=investimentos', label: 'Investimentos', Icon: IconeCofrinho, iconBg: 'bg-blue-50' },
    { href: '/analise-comportamento', label: 'Análise do Fin', Icon: IconeFin, iconBg: 'bg-violet-50 dark:bg-violet-900/20' },
  ],
}

const cartao: NavModule = {
  key: 'cartao',
  label: 'Cartão',
  Icon: IconeCartao,
  items: [
    { href: '/compras', label: 'Compras', Icon: IconeCarrinho, iconBg: 'bg-orange-50 dark:bg-orange-900/20' },
    { href: '/assinaturas', label: 'Assinaturas', Icon: IconeAssinaturas, iconBg: 'bg-indigo-50 dark:bg-indigo-900/20' },
    { href: '/parcelamentos', label: 'Parcelamentos', Icon: IconeParcelas, iconBg: 'bg-teal-50 dark:bg-teal-900/20' },
    { href: '/compras-previstas', label: 'Compras previstas', Icon: IconeComprasPrevistas, iconBg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  ],
}

const listas: NavModule = {
  key: 'listas',
  label: 'Listas & Desejos',
  Icon: IconeChecklist,
  items: [
    { href: '/wishlist', label: 'Wishlist', Icon: IconeCoracao, iconBg: 'bg-pink-50 dark:bg-pink-900/20' },
    { href: '/lista-mercado', label: 'Mercado', Icon: IconeCesta, iconBg: 'bg-green-50 dark:bg-green-900/20' },
    { href: '/listas-compras', label: 'Princesa', Icon: IconeCoroa, iconBg: 'bg-amber-50 dark:bg-amber-900/20' },
  ],
}

const relatorios: NavModule = {
  key: 'relatorios',
  label: 'Relatórios',
  Icon: IconeRelatorio,
  items: [
    { href: '/relatorios', label: 'Relatórios', Icon: IconeRelatorio, iconBg: 'bg-sky-50 dark:bg-sky-900/20' },
    { href: '/analytics', label: 'Analytics', Icon: IconeGrafico, iconBg: 'bg-violet-50 dark:bg-violet-900/20', desktopOnly: true },
  ],
}

// Todos os ícones são ilustrados (components/icones/IconesIlustrados.tsx), no
// mesmo estilo do Fin — que aparece como ele mesmo, o robô do chat.
const ia: NavModule = {
  key: 'ia',
  label: 'Assistente',
  Icon: IconeFin,
  items: [
    { href: '/chat', label: 'Fin', Icon: IconeFin, iconBg: 'bg-primary-50' },
  ],
}

const configuracoes: NavModule = {
  key: 'configuracoes',
  label: 'Configurações',
  Icon: IconeEngrenagem,
  items: [
    { href: '/configuracoes', label: 'Configurações', Icon: IconeEngrenagem, iconBg: 'bg-gray-100' },
  ],
}

// Catálogo único de módulos de navegação, consumido tanto pelos popovers do
// bottom nav mobile quanto pelos dropdowns da barra superior desktop — evita
// que os dois divergam com o tempo.
export const NAV_MODULES = { financas, cartao, listas, relatorios, ia, configuracoes }

export type NavModuleKey = keyof typeof NAV_MODULES
