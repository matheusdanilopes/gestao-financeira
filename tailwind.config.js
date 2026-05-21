/** @type {import('tailwindcss').Config} */
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
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          400: '#A897FF',
          500: '#8B7AF5',
          600: '#7055E8',
          700: '#5A3ED4',
          900: '#150F3A',
        },
        cosmic: {
          bg:       '#07091A',
          surface:  '#0D1230',
          surface2: '#141A3A',
          border:   'rgba(255,255,255,0.10)',
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
        'card':       '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md':    '0 4px 16px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)',
        'card-hover': '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
        'float':      '0 20px 40px rgba(0,0,0,0.15), 0 4px 8px rgba(0,0,0,0.08)',
      },
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
}
