'use client'

import { memo, type ReactNode } from 'react'

/**
 * Renderizador de markdown do chat.
 *
 * Escopo deliberadamente pequeno (sem dependência externa): o modelo é
 * instruído a responder com markdown enxuto, então cobrimos títulos, listas,
 * citações, regras, blocos de código, tabelas simples e ênfase — o suficiente
 * para uma resposta financeira, sem carregar um parser inteiro no bundle.
 */

/** Divide uma linha em trechos com ênfase, código e valores monetários. */
function parseInline(linha: string): ReactNode[] {
  const partes = linha.split(
    /(\*\*[^*]+(?:\*[^*]+)*\*\*|__[^_]+__|\*[^*]+\*|`[^`]+`|R\$\s?-?[\d.]+(?:,\d{2})?)/g
  )

  return partes.filter(Boolean).map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900 dark:text-gray-50">{parte.slice(2, -2)}</strong>
    }
    if (parte.startsWith('__') && parte.endsWith('__')) {
      return <strong key={i} className="font-semibold text-gray-900 dark:text-gray-50">{parte.slice(2, -2)}</strong>
    }
    if (parte.startsWith('*') && parte.endsWith('*') && parte.length > 2) {
      return <em key={i} className="text-gray-600 dark:text-gray-400">{parte.slice(1, -1)}</em>
    }
    if (parte.startsWith('`') && parte.endsWith('`')) {
      return (
        <code key={i} className="bg-gray-100 dark:bg-gray-700/70 px-1.5 py-0.5 rounded-md text-[0.8em] font-mono">
          {parte.slice(1, -1)}
        </code>
      )
    }
    if (/^R\$\s?-?[\d.]+(?:,\d{2})?$/.test(parte)) {
      return <span key={i} className="font-semibold num value-tight text-gray-900 dark:text-gray-50">{parte}</span>
    }
    return <span key={i}>{parte}</span>
  })
}

const CELULA = 'px-3 py-2 text-left whitespace-nowrap'

function Tabela({ linhas }: { linhas: string[] }) {
  const celulas = (linha: string) =>
    linha.replace(/^\||\|$/g, '').split('|').map(c => c.trim())

  const [cabecalho, ...resto] = linhas
  const corpo = resto.filter(l => !/^\|?[\s:-]+\|[\s:|-]*$/.test(l))

  return (
    <div className="my-2 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-800/80">
          <tr>
            {celulas(cabecalho).map((c, i) => (
              <th key={i} className={`${CELULA} font-semibold text-gray-700 dark:text-gray-300`}>{parseInline(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {corpo.map((linha, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60">
              {celulas(linha).map((c, j) => (
                <td key={j} className={`${CELULA} text-gray-700 dark:text-gray-300`}>{parseInline(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const MarkdownMessage = memo(function MarkdownMessage({ texto }: { texto: string }) {
  const linhas = texto.split('\n')
  const blocos: ReactNode[] = []
  let i = 0

  while (i < linhas.length) {
    const linha = linhas[i]

    // Bloco de código cercado
    if (linha.trimStart().startsWith('```')) {
      const conteudo: string[] = []
      i++
      while (i < linhas.length && !linhas[i].trimStart().startsWith('```')) {
        conteudo.push(linhas[i])
        i++
      }
      i++
      blocos.push(
        <pre key={`code-${i}`} className="my-2 overflow-x-auto rounded-xl bg-gray-900 dark:bg-black/40 p-3 text-[11px] leading-relaxed text-gray-100">
          <code>{conteudo.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Tabela
    if (linha.trim().startsWith('|') && linha.includes('|', 1)) {
      const tabela: string[] = []
      while (i < linhas.length && linhas[i].trim().startsWith('|')) {
        tabela.push(linhas[i].trim())
        i++
      }
      blocos.push(<Tabela key={`tbl-${i}`} linhas={tabela} />)
      continue
    }

    // Lista não ordenada
    if (/^\s*[-*•]\s+/.test(linha)) {
      const itens: ReactNode[] = []
      while (i < linhas.length && /^\s*[-*•]\s+/.test(linhas[i])) {
        itens.push(
          <li key={i} className="leading-relaxed marker:text-primary-400">
            {parseInline(linhas[i].replace(/^\s*[-*•]\s+/, ''))}
          </li>
        )
        i++
      }
      blocos.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1 my-2 text-gray-700 dark:text-gray-300">{itens}</ul>
      )
      continue
    }

    // Lista ordenada
    if (/^\s*\d+[.)]\s+/.test(linha)) {
      const itens: ReactNode[] = []
      while (i < linhas.length && /^\s*\d+[.)]\s+/.test(linhas[i])) {
        itens.push(
          <li key={i} className="leading-relaxed marker:text-primary-400 marker:font-semibold">
            {parseInline(linhas[i].replace(/^\s*\d+[.)]\s+/, ''))}
          </li>
        )
        i++
      }
      blocos.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-1 my-2 text-gray-700 dark:text-gray-300">{itens}</ol>
      )
      continue
    }

    if (/^#{1,3}\s/.test(linha)) {
      const nivel = linha.match(/^#+/)![0].length
      const conteudo = parseInline(linha.replace(/^#+\s/, ''))
      blocos.push(
        nivel === 1
          ? <h3 key={i} className="text-[15px] font-bold text-gray-900 dark:text-gray-50 mt-3 mb-1 tracking-tight">{conteudo}</h3>
          : <h4 key={i} className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-2.5 mb-1">{conteudo}</h4>
      )
      i++
      continue
    }

    if (linha.startsWith('> ')) {
      blocos.push(
        <blockquote key={i} className="my-2 border-l-2 border-primary-300 dark:border-primary-400 pl-3 text-gray-600 dark:text-gray-400 italic">
          {parseInline(linha.slice(2))}
        </blockquote>
      )
      i++
      continue
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(linha)) {
      blocos.push(<hr key={i} className="my-3 border-gray-200 dark:border-gray-700" />)
      i++
      continue
    }

    if (linha.trim() === '') {
      i++
      continue
    }

    blocos.push(
      <p key={i} className="leading-relaxed text-gray-800 dark:text-gray-200">{parseInline(linha)}</p>
    )
    i++
  }

  return <div className="text-sm space-y-1">{blocos}</div>
})
