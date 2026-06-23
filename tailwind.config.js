/** @type {import('tailwindcss').Config} */
// ───────────────────────────────────────────────────────────────
// tailwind.config.js — SUBSTITUA O ARQUIVO INTEIRO POR ESTE.
//
// Mudanças-chave vs. o atual:
//  • fontFamily.sans → Hanken Grotesk (var --font-sans); adicionado fontFamily.num → Space Grotesk
//  • colors.primary → escala VERDE-MENTA autoral (substitui o indigo genérico).
//    Como o app usa primary-600 / primary-50 etc. em todo lugar, isso já
//    re-tinge botões, FAB, badges e acentos sem tocar nos componentes.
//  • matheus / jeniffer refinados para os tons usados no redesign.
//  • boxShadow muito mais suave (a "cara de IA" vem de sombras pesadas;
//    aqui priorizamos hairlines de 1px — ver globals tokens).
// ───────────────────────────────────────────────────────────────
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // use em valores monetários: className="font-num" (a classe .num em globals já aponta pra cá)
        num:  ['var(--font-num)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Verde-menta autoral — substitui o indigo. Light usa 600 (#0e9e6e),
        // dark usa o tom mais claro/vibrante via tokens (#3ce0a0).
        primary: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          400: '#34d39a',
          500: '#16b07c',
          600: '#0e9e6e',
          700: '#0b7d57',
          900: '#053d2b',
        },
        matheus: {
          light: '#dbe6ff',
          DEFAULT: '#3b6fe0',
          dark: '#1e3a8a',
        },
        jeniffer: {
          light: '#fbe1ee',
          DEFAULT: '#d85c97',
          dark: '#831843',
        },
      },
      boxShadow: {
        // Sombras suavizadas — peso visual mora nas hairlines (--color-border).
        'card':       '0 1px 2px rgba(16,24,40,0.03), 0 1px 3px rgba(16,24,40,0.04)',
        'card-md':    '0 1px 3px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.05)',
        'card-hover': '0 2px 6px rgba(16,24,40,0.05), 0 10px 24px rgba(16,24,40,0.07)',
        'float':      '0 6px 16px rgba(16,24,40,0.07), 0 18px 40px rgba(16,24,40,0.12)',
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
        'smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        '400': '400ms',
      },
    },
  },
  plugins: [],
}
