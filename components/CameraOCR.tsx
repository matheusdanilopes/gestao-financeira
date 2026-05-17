'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Camera, X, RotateCcw, Check, Loader2, AlertCircle, Zap, ZapOff } from 'lucide-react'
import ModalPortal from './ModalPortal'

type Status = 'requesting' | 'preview' | 'processing' | 'result' | 'error'
type ErrorKind = 'permission' | 'device' | 'notfound' | 'network'

type Props = {
  onConfirmar: (preco: number) => void
  onClose: () => void
}

// Tamanho CSS do guide box (w-72 h-28)
const GUIDE_CSS_W = 288
const GUIDE_CSS_H = 112

export function CameraOCR({ onConfirmar, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const precoInputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<Status>('requesting')
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null)
  const [precoEditado, setPrecoEditado] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setStatus('requesting')
    setErrorKind(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      const caps = track.getCapabilities?.() as Record<string, unknown> | undefined
      setTorchSupported(!!caps?.torch)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStatus('preview')
    } catch (err) {
      const isPermission =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      setErrorKind(isPermission ? 'permission' : 'device')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => stopStream()
  }, [startCamera, stopStream])

  const handleClose = useCallback(() => {
    stopStream()
    onClose()
  }, [stopStream, onClose])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch { /* device doesn't support torch */ }
  }, [torchOn])

  const processImage = useCallback(async (base64: string) => {
    const tryOCR = async () => {
      const res = await fetch('/api/ocr-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      })
      if (!res.ok) throw new Error('api')
      const json = await res.json()
      return json.preco as number | null
    }
    try {
      let preco = await tryOCR()
      if (preco === null) preco = await tryOCR() // retry silencioso
      if (preco != null) {
        navigator.vibrate?.([50])
        setPrecoEditado(preco.toFixed(2).replace('.', ','))
        setStatus('result')
        setTimeout(() => precoInputRef.current?.focus(), 150)
      } else {
        setErrorKind('notfound')
        setStatus('error')
      }
    } catch {
      setErrorKind('network')
      setStatus('error')
    }
  }, [])

  const capture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return
    setStatus('processing')

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dw = video.offsetWidth
    const dh = video.offsetHeight
    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720

    // Recortar apenas a área do guide box — reduz payload ~85%
    const coverScale = Math.max(dw / vw, dh / vh)
    const guideVW = Math.round(GUIDE_CSS_W / coverScale)
    const guideVH = Math.round(GUIDE_CSS_H / coverScale)
    canvas.width = guideVW
    canvas.height = guideVH
    ctx.filter = 'grayscale(1) contrast(1.3)'
    ctx.drawImage(
      video,
      Math.round((vw - guideVW) / 2), Math.round((vh - guideVH) / 2),
      guideVW, guideVH,
      0, 0, guideVW, guideVH,
    )
    ctx.filter = 'none'

    await processImage(canvas.toDataURL('image/jpeg', 0.65).split(',')[1])
  }, [processImage])

  const retake = useCallback(() => {
    setPrecoEditado('')
    setErrorKind(null)
    if (streamRef.current) {
      setStatus('preview') // stream ainda vivo — retomada instantânea
    } else {
      startCamera()
    }
  }, [startCamera])

  const confirmar = useCallback(() => {
    const num = parseFloat(precoEditado.replace(',', '.').trim())
    if (!isNaN(num) && num > 0) {
      stopStream()
      onConfirmar(num)
      onClose()
    }
  }, [precoEditado, onConfirmar, stopStream, onClose])

  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[400] flex flex-col bg-black">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
        >
          <button
            type="button"
            onClick={handleClose}
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-white font-semibold text-sm">Ler preço</span>
          {torchSupported ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Desligar lanterna' : 'Ligar lanterna'}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
            >
              {torchOn ? <ZapOff className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
            </button>
          ) : (
            <div className="w-11" />
          )}
        </div>

        {/* Viewfinder */}
        <div
          className="flex-1 relative overflow-hidden bg-black"
          onClick={status === 'preview' ? capture : undefined}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />

          {/* Overlay com guide box */}
          {(status === 'preview' || status === 'processing') && (
            <>
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'rgba(0,0,0,0.45)' }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="w-72 h-28 rounded-2xl relative overflow-hidden"
                  style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
                >
                  {status === 'preview' && (
                    <div className="absolute inset-x-0 h-0.5 bg-green-400/80 rounded-full animate-scan-line" />
                  )}
                  {status === 'processing' && (
                    <div className="absolute inset-0 bg-white/10 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-white/80 animate-spin" />
                    </div>
                  )}
                  <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-[3px] border-l-[3px] border-white rounded-tl-2xl" />
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-[3px] border-r-[3px] border-white rounded-tr-2xl" />
                  <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-[3px] border-l-[3px] border-white rounded-bl-2xl" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-[3px] border-r-[3px] border-white rounded-br-2xl" />
                </div>
              </div>
              {status === 'preview' && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
                  <p className="text-white/75 text-xs bg-black/40 py-1.5 px-4 rounded-full">
                    Aponte a etiqueta e toque para capturar
                  </p>
                </div>
              )}
            </>
          )}

          {status === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-white/60 text-sm">Acessando câmera…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-4 px-8">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              {errorKind === 'permission' && (
                <div className="text-center">
                  <p className="text-white text-sm font-semibold mb-2">Permissão de câmera negada</p>
                  <p className="text-white/60 text-xs leading-relaxed">
                    {isIOS
                      ? 'Vá em Ajustes › Safari › Câmera e permita o acesso.'
                      : 'Toque no ícone de câmera na barra de endereços e permita o acesso.'}
                  </p>
                </div>
              )}
              {errorKind === 'notfound' && (
                <div className="text-center">
                  <p className="text-white text-sm font-semibold mb-1">Preço não encontrado</p>
                  <p className="text-white/60 text-xs">Aproxime mais da etiqueta ou melhore a iluminação.</p>
                </div>
              )}
              {errorKind === 'network' && (
                <div className="text-center">
                  <p className="text-white text-sm font-semibold mb-1">Erro de conexão</p>
                  <p className="text-white/60 text-xs">Verifique o sinal e tente novamente.</p>
                </div>
              )}
              {errorKind === 'device' && (
                <p className="text-white text-sm text-center">
                  Não foi possível acessar a câmera neste dispositivo.
                </p>
              )}
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Área inferior — varia por estado */}
        <div className="bg-black" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          {status === 'result' && (
            <div className="px-4 pt-4">
              <div className="bg-white rounded-3xl px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-7 h-7 rounded-full bg-green-50 flex items-center justify-center flex-none">
                    <Check className="w-3.5 h-3.5 text-green-500" strokeWidth={2.5} />
                  </div>
                  <p className="text-xs font-semibold text-gray-600">Preço detectado — edite se necessário</p>
                </div>
                <div className="relative mb-3">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
                    R$
                  </span>
                  <input
                    ref={precoInputRef}
                    type="text"
                    inputMode="decimal"
                    value={precoEditado}
                    onChange={e => setPrecoEditado(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmar()}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-2xl font-bold
                               text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={retake}
                    className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-gray-100
                               text-gray-700 text-sm font-semibold active:bg-gray-200 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Refazer
                  </button>
                  <button
                    type="button"
                    onClick={confirmar}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500
                               text-white text-sm font-bold active:bg-green-600 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Confirmar R$ {precoEditado || '0,00'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="px-5 pt-4 flex gap-3">
              {errorKind !== 'permission' && (
                <button
                  type="button"
                  onClick={retake}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/10
                             text-white text-sm font-semibold active:bg-white/20 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Tentar novamente
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 flex items-center justify-center py-3.5 rounded-2xl bg-white/10
                           text-white text-sm font-semibold active:bg-white/20 transition-colors"
              >
                Digitar manualmente
              </button>
            </div>
          )}

          {status === 'preview' && (
            <div className="px-5 pt-4">
              <button
                type="button"
                onClick={capture}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white
                           text-gray-900 text-sm font-bold active:bg-gray-100 transition-colors"
              >
                <Camera className="w-5 h-5" />
                Capturar
              </button>
            </div>
          )}

          {status === 'processing' && (
            <div className="px-5 pt-4">
              <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/10">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
                <span className="text-white text-sm font-medium">Detectando preço…</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
