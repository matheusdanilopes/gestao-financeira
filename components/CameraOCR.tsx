'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Camera, X, RotateCcw, Check, Loader2, AlertCircle } from 'lucide-react'
import ModalPortal from './ModalPortal'

type Status = 'requesting' | 'preview' | 'capturing' | 'processing' | 'result' | 'error'

type Props = {
  onPrecoDetectado: (preco: number) => void
  onClose: () => void
}

export function CameraOCR({ onPrecoDetectado, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<Status>('requesting')
  const [errorMsg, setErrorMsg] = useState('')
  const [precoDetectado, setPrecoDetectado] = useState<number | null>(null)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setStatus('requesting')
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStatus('preview')
    } catch (err) {
      const isPermission = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      setErrorMsg(
        isPermission
          ? 'Permissão de câmera negada. Habilite nas configurações do navegador.'
          : 'Não foi possível acessar a câmera neste dispositivo.',
      )
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

  const capture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return
    setStatus('capturing')

    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    canvas.getContext('2d')?.drawImage(video, 0, 0)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setCapturedDataUrl(dataUrl)
    stopStream()

    setStatus('processing')
    try {
      const base64 = dataUrl.split(',')[1]
      const res = await fetch('/api/ocr-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      })
      const json = await res.json()
      if (json.preco != null) {
        setPrecoDetectado(json.preco)
        setStatus('result')
      } else {
        setErrorMsg('Nenhum preço detectado. Tente novamente mais próximo da etiqueta.')
        setStatus('error')
      }
    } catch {
      setErrorMsg('Erro ao processar a imagem. Verifique sua conexão.')
      setStatus('error')
    }
  }, [stopStream])

  const retake = useCallback(async () => {
    setCapturedDataUrl(null)
    setPrecoDetectado(null)
    setErrorMsg('')
    await startCamera()
  }, [startCamera])

  const confirmar = useCallback(() => {
    if (precoDetectado != null) {
      onPrecoDetectado(precoDetectado)
      stopStream()
      onClose()
    }
  }, [precoDetectado, onPrecoDetectado, stopStream, onClose])

  const formatPreco = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[400] flex flex-col bg-black">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 safe-top" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <button
            type="button"
            onClick={handleClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-white font-semibold text-sm">Ler preço com câmera</span>
          <div className="w-10" />
        </div>

        {/* Viewfinder */}
        <div className="flex-1 relative overflow-hidden bg-black">
          {capturedDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capturedDataUrl} alt="Captura" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />
          )}

          {/* Guide overlay */}
          {status === 'preview' && (
            <>
              <div
                className="absolute inset-0"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-72 h-28 rounded-2xl border-2 border-white relative"
                  style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}
                >
                  {/* Corner accents */}
                  <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-[3px] border-l-[3px] border-white rounded-tl-2xl" />
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-[3px] border-r-[3px] border-white rounded-tr-2xl" />
                  <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-[3px] border-l-[3px] border-white rounded-bl-2xl" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-[3px] border-r-[3px] border-white rounded-br-2xl" />
                </div>
              </div>
              <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                <p className="text-white/80 text-xs bg-black/40 py-1.5 px-4 rounded-full">
                  Aponte para a etiqueta de preço
                </p>
              </div>
            </>
          )}

          {status === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-white/60 text-sm">Acessando câmera…</p>
            </div>
          )}

          {status === 'processing' && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <p className="text-white text-sm font-medium">Detectando preço…</p>
            </div>
          )}

          {status === 'result' && precoDetectado != null && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-8">
              <div className="bg-white rounded-3xl px-8 py-6 text-center shadow-2xl w-full max-w-xs">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-5 h-5 text-green-500" strokeWidth={2.5} />
                </div>
                <p className="text-xs text-gray-500 font-medium mb-1">Preço detectado</p>
                <p className="text-4xl font-bold text-gray-900 tabular-nums">
                  R$ {formatPreco(precoDetectado)}
                </p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 px-8">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-white text-sm text-center font-medium leading-relaxed">{errorMsg}</p>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Controls */}
        <div
          className="px-5 pt-4 flex gap-3 bg-black"
          style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        >
          {(status === 'error' || status === 'result') && (
            <button
              type="button"
              onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/10 text-white text-sm font-semibold active:bg-white/20 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Tirar outra
            </button>
          )}

          {status === 'preview' && (
            <button
              type="button"
              onClick={capture}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white text-gray-900 text-sm font-bold active:bg-gray-100 transition-colors"
            >
              <Camera className="w-5 h-5" />
              Capturar
            </button>
          )}

          {status === 'result' && precoDetectado != null && (
            <button
              type="button"
              onClick={confirmar}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-green-500 text-white text-sm font-bold active:bg-green-600 transition-colors"
            >
              <Check className="w-4 h-4" />
              Usar R$ {formatPreco(precoDetectado)}
            </button>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
