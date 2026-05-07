'use client'

import { useEffect, useRef, useState } from 'react'

// BarcodeDetector is a native Chrome API — not yet in TypeScript's DOM lib.
// Declare minimal types so we can use it without a third-party library.
interface BarcodeResult {
  rawValue: string
  format: string
}
interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<BarcodeResult[]>
}
declare const BarcodeDetector: {
  new(options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?(): Promise<string[]>
} | undefined

interface Props {
  onScan: (ean: string) => void
  onClose: () => void
}

// Full-screen camera overlay that scans EAN barcodes using the native
// BarcodeDetector API (Chrome 83+ on Android/desktop). Falls back to a
// manual-entry prompt on unsupported browsers (e.g. Firefox, older Chrome).
export default function BarcodeScanner({ onScan, onClose }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const rafRef     = useRef<number>(0)
  const [error, setError]       = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [lastCode, setLastCode] = useState<string | null>(null)

  // Stop camera + animation loop on unmount or close
  const stop = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    // BarcodeDetector API not available → fall back to manual entry
    if (typeof BarcodeDetector === 'undefined') {
      setError('Tu navegador no soporta el escáner automático.\nIngresa el EAN manualmente.')
      setScanning(false)
      return
    }

    const detector = new BarcodeDetector({
      // Covers EAN-13, EAN-8, UPC-A, UPC-E and Code-128 used in México
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
    })

    // Request rear camera — facingMode 'environment' prefers back camera on phones
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        videoRef.current.play()

        // Poll every animation frame — BarcodeDetector is async but fast on device
        const scan = async () => {
          if (!videoRef.current || !scanning) return
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue
              setLastCode(code)
              setScanning(false)
              stop()
              onScan(code)
              return
            }
          } catch { /* frame not ready yet — skip */ }
          rafRef.current = requestAnimationFrame(scan)
        }
        rafRef.current = requestAnimationFrame(scan)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Error de cámara'
        setError(`No se pudo acceder a la cámara.\n${msg}`)
        setScanning(false)
      })

    return stop
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => { stop(); onClose() }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm font-medium">
          {scanning ? 'Apunta la cámara al código de barras' : lastCode ? `✓ ${lastCode}` : 'Error'}
        </span>
        <button onClick={handleClose} className="text-white text-2xl leading-none">✕</button>
      </div>

      {/* Camera viewfinder */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
        />

        {/* Aiming reticle — visual guide for barcode alignment */}
        {scanning && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-32 border-2 border-green-400 rounded-lg opacity-80" />
          </div>
        )}

        {/* Error or manual-entry fallback */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="bg-white rounded-xl p-6 text-center max-w-xs">
              <p className="text-4xl mb-3">📷</p>
              <p className="text-gray-700 text-sm whitespace-pre-line">{error}</p>
              <button
                onClick={handleClose}
                className="mt-4 w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer hint */}
      {scanning && !error && (
        <div className="p-4 text-center">
          <p className="text-gray-400 text-xs">Soporta EAN-13, EAN-8, UPC-A, Code-128</p>
        </div>
      )}
    </div>
  )
}
