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
      },
      colors: {
        // Azul navy — 600 é a cor principal da marca (#1e40af).
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#2563eb',
          600: '#1e40af',
          700: '#1e3a8a',
          800: '#1a2f6e',
          900: '#172554',
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
        // Sombras em base slate (16,24,40) — leitura mais sofisticada e fria que
        // o preto puro, com camadas (contato + ambiente) para profundidade real.
        'card':       '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.05)',
        // Card plano (estilo PicPay): sem borda, só um contato sutil com o fundo.
        'soft':       '0 1px 2px rgba(16,24,40,0.04), 0 2px 8px rgba(16,24,40,0.04)',
        'card-md':    '0 2px 4px rgba(16,24,40,0.05), 0 8px 24px rgba(16,24,40,0.08)',
        'card-hover': '0 4px 8px rgba(16,24,40,0.06), 0 16px 32px rgba(16,24,40,0.10)',
        'float':      '0 8px 16px rgba(16,24,40,0.08), 0 24px 48px rgba(16,24,40,0.16)',
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
