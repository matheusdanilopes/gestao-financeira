/**
 * Leitor de Server-Sent Events sobre um ReadableStream de bytes.
 *
 * Sem dependências de propósito: a fronteira dos chunks de rede não coincide
 * com a fronteira dos eventos, então o buffer precisa ser tratado com cuidado
 * — um evento pode chegar partido no meio de um caractere multibyte ou de uma
 * linha `data:`. Isolado aqui para poder ser testado sem subir a tela.
 */

export interface EventoSSE {
  tipo: string
  dados: Record<string, unknown>
}

export async function* lerSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<EventoSSE> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const extrairBlocos = function* (): Generator<EventoSSE> {
    // Blocos SSE terminam em linha em branco. Aceita \n\n e \r\n\r\n.
    let corte = proximoCorte(buffer)
    while (corte) {
      const bloco = buffer.slice(0, corte.inicio)
      buffer = buffer.slice(corte.fim)
      const evento = interpretarBloco(bloco)
      if (evento) yield evento
      corte = proximoCorte(buffer)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      yield* extrairBlocos()
    }
    // Flush do decoder e de um último bloco sem linha em branco final.
    buffer += decoder.decode()
    yield* extrairBlocos()
    const resto = interpretarBloco(buffer)
    if (resto) yield resto
  } finally {
    try { await reader.cancel() } catch { /* stream já encerrado */ }
  }
}

function proximoCorte(buffer: string): { inicio: number; fim: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { inicio: crlf, fim: crlf + 4 }
  return { inicio: lf, fim: lf + 2 }
}

function interpretarBloco(bloco: string): EventoSSE | null {
  if (!bloco.trim()) return null

  let tipo = 'message'
  const dados: string[] = []

  for (const linha of bloco.split(/\r?\n/)) {
    if (linha.startsWith(':')) continue // comentário/keep-alive
    if (linha.startsWith('event:')) tipo = linha.slice(6).trim()
    else if (linha.startsWith('data:')) dados.push(linha.slice(5).trim())
  }

  if (dados.length === 0) return null
  try {
    const parsed = JSON.parse(dados.join('\n'))
    return { tipo, dados: parsed && typeof parsed === 'object' ? parsed : { valor: parsed } }
  } catch {
    return null
  }
}
