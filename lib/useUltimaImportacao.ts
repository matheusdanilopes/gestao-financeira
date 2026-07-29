import { useEffect, useState } from 'react'

// Postgres/PostgREST às vezes devolve timestamp sem offset de fuso; sem 'Z'/±hh:mm,
// o JS interpretaria a string como horário local (errado), então assumimos UTC.
function parseTimestamp(ts: string): Date {
  const temFuso = /Z$|[+-]\d{2}:?\d{2}$/.test(ts)
  return new Date(temFuso ? ts : `${ts}Z`)
}

export function useUltimaImportacao() {
  const [ultimaImportacao, setUltimaImportacao] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelado = false
    fetch('/api/nubank/atividades?limit=1')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelado) return
        const ts = data?.atividades?.[0]?.created_at
        setUltimaImportacao(ts ? parseTimestamp(ts) : null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setLoading(false) })
    return () => { cancelado = true }
  }, [])

  return { ultimaImportacao, loading }
}
