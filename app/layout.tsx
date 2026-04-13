import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gestão Financeira Familiar',
  description: 'Controle de finanças com Matheus e Jeniffer',
  manifest: '/manifest.json',
  themeColor: '#000000',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=yes',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">
        <main className="max-w-md mx-auto relative">
          {children}
        </main>
      </body>
    </html>
  )
}