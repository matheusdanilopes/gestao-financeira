// Shared image utilities — used by wishlist/page.tsx and FabQuickLaunchSheet

export async function fileToBase64(source: File | ArrayBuffer): Promise<{ base64: string; mimeType: string }> {
  const buf = source instanceof File ? await source.arrayBuffer() : source
  const mimeType = source instanceof File ? (source.type || 'image/jpeg') : 'image/jpeg'
  const uint8 = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < uint8.length; i += 8192) {
    binary += String.fromCharCode(...uint8.subarray(i, i + 8192))
  }
  return { base64: btoa(binary), mimeType }
}

// iOS < 15.4 doesn't support AbortSignal.timeout — silent fallback
export function abortTimeout(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof (AbortSignal as { timeout?: unknown }).timeout !== 'function') return undefined
  return AbortSignal.timeout(ms)
}

// Resize large images before uploading (iOS camera = 8-12 MP)
export async function compressImage(file: File, maxDim = 1920): Promise<{ base64: string; mimeType: string }> {
  if (typeof window === 'undefined') return fileToBase64(file)
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.width <= maxDim && img.height <= maxDim) { fileToBase64(file).then(resolve); return }
      const scale = Math.min(maxDim / img.width, maxDim / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { fileToBase64(file).then(resolve); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        if (!blob) { fileToBase64(file).then(resolve); return }
        blob.arrayBuffer().then(buf => {
          const u8 = new Uint8Array(buf)
          let bin = ''
          for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192))
          resolve({ base64: btoa(bin), mimeType: 'image/jpeg' })
        })
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => { URL.revokeObjectURL(url); fileToBase64(file).then(resolve) }
    img.src = url
  })
}

export type AnalyzeResult = {
  status: string
  nome?: string
  descricao?: string | null
  preco?: number | null
  debug?: string
}

// Calls /api/share-receiver/analyze — the canonical AI identification service
export async function callAnalyze(
  id: string,
  imageBase64: string,
  imageMimeType: string,
  criado_por: string | null,
): Promise<AnalyzeResult> {
  const res = await fetch('/api/share-receiver/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, imageBase64, imageMimeType, ...(criado_por ? { criado_por } : {}) }),
    signal: abortTimeout(28000),
  })
  return res.json()
}
