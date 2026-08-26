/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Serifada de exibição — reservada para títulos-âncora e o valor de saldo
        // principal do dashboard. Dá peso editorial a um app que, fora isso, é
        // predominantemente denso em dados/tabular.
        display: ['var(--font-fraunces)', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        // Petróleo profundo — substitui o indigo/roxo genérico de SaaS por uma cor
        // com identidade própria de "livro-razão": confiável, mas não bancária-fria.
        primary: {
          50:  '#EAF4F2',
          100: '#D2E7E3',
          200: '#A6D0C7',
          400: '#3F9686',
          500: '#227C6D',
          600: '#0F6B60',
          700: '#0B544C',
          900: '#062E2A',
        },
        // Latão/dourado — acento premium, usado com moderação (metas atingidas,
        // destaques de wishlist, toques de celebração).
        brass: {
          50:  '#FBF3E4',
          100: '#F4E2BC',
          400: '#CDA054',
          500: '#B8863C',
          600: '#976B2C',
        },
        matheus: {
          light: '#dbeafe',
          DEFAULT: '#1d4ed8',
          dark: '#1e3a8a',
        },
        jeniffer: {
          light: '#fce7f3',
          DEFAULT: '#be185d',
          dark: '#831843',
        },
      },
      boxShadow: {
        // Sombras em base ink quente (28,23,18) — mais aconchegante que o slate frio
        // padrão de dashboards genéricos, com camadas (contato + ambiente) reais.
        'card':       '0 1px 2px rgba(28,23,18,0.05), 0 4px 12px rgba(28,23,18,0.06)',
        'card-md':    '0 2px 4px rgba(28,23,18,0.06), 0 8px 24px rgba(28,23,18,0.09)',
        'card-hover': '0 4px 8px rgba(28,23,18,0.07), 0 16px 32px rgba(28,23,18,0.11)',
        'float':      '0 8px 16px rgba(28,23,18,0.09), 0 24px 48px rgba(28,23,18,0.18)',
      },
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      letterSpacing: {
        'tighter-2': '-0.02em',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        // Curva de saída suave (emphasized decelerate) p/ transições de estado/valor
        'smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        '400': '400ms',
      },
    },
  },
  plugins: [],
}
