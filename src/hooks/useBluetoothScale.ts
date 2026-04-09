'use client'

import { useState, useCallback, useRef } from 'react'

// ─── GATT-connectable scales (service + notify characteristic) ───────────────
// Each entry must include the full 128-bit service UUID so matching works for
// both standard short-UUID services (0000xxxx-...) and vendor 128-bit UUIDs
// like the Nordic UART Service used by the Assistrus B03H.
interface GattScaleDef {
  serviceUuid: string    // full 128-bit UUID (lowercase)
  notifyUuid?: string    // optional: pin to a specific notify characteristic
  parse(b: Uint8Array): number | null
}

const GATT_SCALES: Record<string, GattScaleDef> = {
  // Femmto BWS12: header=0xAC, weight at bytes[4:5] Big-Endian, raw/1000=kg
  femmto: {
    serviceUuid: '0000ffb0-0000-1000-8000-00805f9b34fb',
    parse(b) {
      if (b[0] !== 0xac || b.length < 6) return null
      return ((b[4] << 8) | b[5]) / 1000
    },
  },
  // Arboleaf QN-KS: header=0x10, weight at bytes[9:10] Big-Endian
  arboleaf: {
    serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb',
    parse(b) {
      if (b[0] !== 0x10 || b.length < 11) return null
      const raw = (b[9] << 8) | b[10]
      return (b[5] === 0x02 ? raw / 10 : raw) / 1000
    },
  },
  // Assistrus B03H (and similar NUS-based scales):
  //   Uses Nordic UART Service — scale pushes weight as ASCII text via
  //   the TX notify characteristic (6e400003-...).
  //
  // Common formats seen in NUS scales (auto-detected by parser below):
  //   "  75.150\r\n"        → kg assumed
  //   "75150\r\n"           → grams (>999 with no decimal → /1000)
  //   "75.15 KG\r\n"        → explicit kg label
  //   "75150 G\r\n"         → explicit grams label
  //   Binary 3-byte: [0x??, high, low] → needs calibration if ASCII fails
  //
  // The raw bytes and the decoded text are ALWAYS logged to the browser
  // console (label "[Scale NUS]") so the exact format can be confirmed
  // against what the scale's display shows. Update the parser once confirmed.
  assistrus_nus: {
    serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9f',
    notifyUuid:  '6e400003-b5a3-f393-e0a9-e50e24dcca9f',
    parse(b) {
      const hex = Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ')
      const text = new TextDecoder('utf-8', { fatal: false }).decode(b).trim()
      console.log('[Scale NUS] raw bytes:', hex)
      console.log('[Scale NUS] text decoded:', JSON.stringify(text))

      // ── Try ASCII path first (most NUS scales send human-readable text) ──
      // Match optional whitespace, a decimal number, optional unit
      const asciiMatch = text.match(/([0-9]+\.?[0-9]*)\s*(kg|g|lb)?/i)
      if (asciiMatch) {
        const num  = parseFloat(asciiMatch[1])
        const unit = (asciiMatch[2] ?? '').toLowerCase()

        let kg: number
        if (unit === 'g' || (!unit && num > 999)) {
          // No unit + large number → treat as grams
          kg = num / 1000
        } else if (unit === 'lb') {
          kg = num * 0.453592
        } else {
          // 'kg' or ambiguous small number → kg
          kg = num
        }

        if (kg > 0 && kg < 300) {
          console.log('[Scale NUS] parsed kg:', kg)
          return Math.round(kg * 1000) / 1000
        }
      }

      // ── Fallback: try binary candidates and log them for calibration ──────
      if (b.length >= 3) {
        const candidates = {
          'b[0:1]_BE /100': ((b[0] << 8) | b[1]) / 100,
          'b[1:2]_BE /100': ((b[1] << 8) | b[2]) / 100,
          'b[0:1]_LE /100': ((b[1] << 8) | b[0]) / 100,
          'b[1:2]_LE /100': ((b[2] << 8) | b[1]) / 100,
        }
        console.log('[Scale NUS] binary candidates:', candidates)
      }

      // Could not parse — data will appear once the format is confirmed
      return null
    },
  },
}

// ─── Advertisement-only scales (Connectable: No in nRF Connect) ──────────────
// These scales broadcast weight in BLE advertisement manufacturer data.
// They cannot be GATT-connected — we use watchAdvertisements() instead.
//
// Protocol for "da" scale (company ID 0xE01D):
//   Manufacturer data bytes after company ID: [b0 b1 b2 b3 b4 b5 b6 b7 b8]
//   Best guess: bytes[2:3] little-endian = weight in grams (needs calibration).
//   Raw bytes are logged to console so the protocol can be verified against
//   the display weight and refined if needed.
const ADV_SCALES: Array<{
  companyId: number
  name: string
  parse(b: Uint8Array): number | null
}> = [
  {
    // Etekcity "da" scale — company 0x06D0 (Etekcity Corporation, nRF shows "<0x06D0>")
    // nRF manufacturer data sample: 5E 02 58 01 FE 00 38 85 FA (bytes 3-8 = MAC reversed)
    // b[0] likely header/status, b[1:2] = weight candidate, b[3:8] = MAC address
    // Protocol not yet confirmed — console logs candidates for calibration.
    // TODO: confirm correct byte pair + divisor by comparing console vs scale display.
    companyId: 0x06d0,
    name: 'da',
    parse(b: Uint8Array): number | null {
      if (b.length < 4) return null

      // Log all candidate interpretations so the correct one can be identified
      // by comparing the console output with what the scale's screen shows.
      const candidates = {
        'b[0:1]_BE /100': ((b[0] << 8) | b[1]) / 100,
        'b[0:1]_BE /10':  ((b[0] << 8) | b[1]) / 10,
        'b[1:2]_BE /100': ((b[1] << 8) | b[2]) / 100,
        'b[2:3]_BE /100': ((b[2] << 8) | b[3]) / 100,
        'b[2:3]_LE /100': ((b[3] << 8) | b[2]) / 100,
        'b[3:4]_BE /100': ((b[3] << 8) | b[4]) / 100,
        'b[5:6]_BE /100': ((b[5] << 8) | b[6]) / 100,
        'b[6:7]_BE /100': ((b[6] << 8) | b[7]) / 100,
      }
      console.log(
        '[Scale] adv bytes:',
        Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' '),
        '\nCandidates:', candidates
      )

      // Protocol not yet confirmed — need 2+ calibration points (different weights).
      // With 75.15 kg → bytes [65 02 58 01 FE 00 38 85 FA]:
      //   Closest candidate: b[1:2] BE = 0x0258 = 600 → 600/8 = 75.0 (off by 0.15)
      // Using /8 as best approximation until a second reading confirms the divisor.
      // Check the console "Candidates" log to identify the correct byte pair + divisor.
      const raw = (b[1] << 8) | b[2]
      const kg = raw / 8
      return kg > 0 && kg < 200 ? Math.round(kg * 10) / 10 : null
    },
  },
]

export type ScaleStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ScaleReading {
  value: number  // always in kg
  unit: 'kg'
}

export interface ScaleHookReturn {
  status: ScaleStatus
  reading: ScaleReading | null
  // Normalized to kg — use this for all price calculations
  weightKg: number
  deviceName: string | null
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
}

export function useBluetoothScale(): ScaleHookReturn {
  const [status, setStatus] = useState<ScaleStatus>('disconnected')
  const [reading, setReading] = useState<ScaleReading | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const deviceRef = useRef<BluetoothDevice | null>(null)

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setError('Web Bluetooth no disponible. Usa Chrome o Edge en Android/Mac/Windows.')
      setStatus('error')
      return
    }

    try {
      setStatus('connecting')
      setError(null)

      // acceptAllDevices lets the user pick any scale.
      // optionalServices must list every GATT service we might access — the
      // browser blocks access to services not declared here even if GATT-connected.
      //
      // optionalManufacturerData tells Chrome which company IDs to expose in
      // advertisementreceived events (needed for advertisement-only scales like 'da').
      // Some older Chrome builds throw NotSupportedError if this key is present, so
      // we try with it first and silently retry without it on failure.
      // Definite assignment assertion: TypeScript can't see that device is always
      // assigned before use — either the first requestDevice succeeds, the retry
      // succeeds, or the outer catch handles the error before device is accessed.
      let device!: BluetoothDevice
      const baseOptions = {
        acceptAllDevices: true,
        optionalServices: [
          ...Object.values(GATT_SCALES).map((s) => s.serviceUuid),
        ],
      }
      try {
        device = await navigator.bluetooth.requestDevice({
          ...baseOptions,
          optionalManufacturerData: ADV_SCALES.map((s) => s.companyId),
        } as RequestDeviceOptions)
      } catch (firstErr) {
        const firstMsg = firstErr instanceof Error ? firstErr.message : ''
        // If the user cancelled, propagate immediately — don't show the picker again
        if (firstMsg.toLowerCase().includes('cancel') || firstMsg.toLowerCase().includes('chose')) {
          throw firstErr
        }
        // NotSupportedError likely means optionalManufacturerData isn't supported —
        // retry without it (advertisement data may not be received, but GATT scales work)
        console.warn('[Scale] requestDevice with optionalManufacturerData failed, retrying without:', firstMsg)
        device = await navigator.bluetooth.requestDevice(baseOptions)
      }

      deviceRef.current = device
      setDeviceName(device.name ?? 'Báscula')

      // ── Path A: try GATT connection (connectable scales) ──────────────────
      const gattOk = await tryGattConnect(device, setReading)

      if (gattOk) {
        setStatus('connected')
        device.addEventListener('gattserverdisconnected', () => {
          setStatus('disconnected')
          setReading(null)
          setDeviceName(null)
        })
        return
      }

      // ── Path B: advertisement-only scale (Connectable: No) ────────────────
      // watchAdvertisements() makes the browser deliver advertisement events
      // for this device without establishing a GATT connection.
      if (!('watchAdvertisements' in device)) {
        throw new Error(
          'Tu navegador no soporta watchAdvertisements(). Usa Chrome 79+ en Android o Mac.'
        )
      }

      await (device as BluetoothDevice & {
        watchAdvertisements(): Promise<void>
      }).watchAdvertisements()

      device.addEventListener('advertisementreceived', (rawEvent: Event) => {
        // Cast: BluetoothAdvertisingEvent is not fully typed in TS lib
        const event = rawEvent as Event & {
          manufacturerData: Map<number, DataView>
        }

        for (const scaleDef of ADV_SCALES) {
          const dataView = event.manufacturerData?.get(scaleDef.companyId)
          if (!dataView) continue

          const bytes = new Uint8Array(dataView.buffer)
          const kg = scaleDef.parse(bytes)
          if (kg !== null) {
            setReading({ value: kg, unit: 'kg' })
          }
          break
        }
      })

      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected')
        setReading(null)
        setDeviceName(null)
      })

      setStatus('connected')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      // User cancelled the device picker — not an error
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('chose')) {
        setStatus('disconnected')
      } else {
        setError(msg)
        setStatus('error')
      }
    }
  }, [])

  const disconnect = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect()
    }
    // Stop advertisement watching if supported
    const dev = deviceRef.current as (BluetoothDevice & {
      unwatchAdvertisements?(): void
    }) | null
    dev?.unwatchAdvertisements?.()

    deviceRef.current = null
    setStatus('disconnected')
    setReading(null)
    setDeviceName(null)
    setError(null)
  }, [])

  const weightKg = reading?.value ?? 0

  return { status, reading, weightKg, deviceName, error, connect, disconnect }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Attempts a GATT connection and hooks up the notify characteristic.
// Returns true if a known scale was found and paired, false otherwise.
async function tryGattConnect(
  device: BluetoothDevice,
  setReading: (r: ScaleReading) => void
): Promise<boolean> {
  try {
    const server = await device.gatt!.connect()
    const services = await server.getPrimaryServices()

    for (const svc of services) {
      // Match by full 128-bit UUID — works for both standard (0000xxxx-...) and
      // vendor UUIDs like the Nordic UART Service (6e400001-...).
      const scaleDef = Object.values(GATT_SCALES).find(
        (s) => s.serviceUuid === svc.uuid
      )
      if (!scaleDef) continue

      let chars: BluetoothRemoteGATTCharacteristic[] = []
      try {
        chars = await svc.getCharacteristics()
      } catch {
        continue
      }

      // If the scale def specifies a particular notify characteristic (e.g. NUS TX),
      // use that; otherwise fall back to the first notify/indicate characteristic.
      const notifyChar = scaleDef.notifyUuid
        ? chars.find((c) => c.uuid === scaleDef.notifyUuid)
        : chars.find((c) => c.properties.notify || c.properties.indicate)

      if (!notifyChar) continue

      notifyChar.addEventListener('characteristicvaluechanged', (e: Event) => {
        const b = new Uint8Array(
          (e.target as BluetoothRemoteGATTCharacteristic).value!.buffer
        )
        const kg = scaleDef.parse(b)
        if (kg !== null) setReading({ value: kg, unit: 'kg' })
      })

      await notifyChar.startNotifications()
      return true
    }

    // No known service found — disconnect cleanly before trying advertisement mode
    server.disconnect()
    return false
  } catch {
    // GATT connection refused (device not connectable) — caller will try advertisement mode
    return false
  }
}
