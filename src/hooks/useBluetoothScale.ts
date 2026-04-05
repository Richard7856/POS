'use client'

import { useState, useCallback, useRef } from 'react'

// ─── GATT-connectable scales (service + notify characteristic) ───────────────
// These scales accept a GATT connection and push weight via BLE notifications.
const GATT_SCALES = {
  // Femmto BWS12: header=0xAC, weight at bytes[4:5] Big-Endian, raw/1000=kg
  femmto: {
    serviceShort: 'ffb0',
    parse(b: Uint8Array): number | null {
      if (b[0] !== 0xac || b.length < 6) return null
      return ((b[4] << 8) | b[5]) / 1000 // kg
    },
  },
  // Arboleaf QN-KS: header=0x10, weight at bytes[9:10] Big-Endian
  arboleaf: {
    serviceShort: 'fff0',
    parse(b: Uint8Array): number | null {
      if (b[0] !== 0x10 || b.length < 11) return null
      const raw = (b[9] << 8) | b[10]
      return (b[5] === 0x02 ? raw / 10 : raw) / 1000 // normalize to kg
    },
  },
} as const

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
    // Assistrust "da" scale — company 0xE01D (nRF shows "<1DE0>": bytes 0x1D 0xE0 = 0xE01D LE)
    // Protocol calibrated with sample: weight=75.15kg → bytes 65 02 58 01 FE 00 38 85 FA
    // b[0]=0x65 likely header, b[1]=0x02 likely unit/mode flag
    // Weight = b[0:1] big-endian (0x6502=25858) / 344.1 ≈ 75.15 — but divisor unclear.
    // TODO: confirm with console log vs display when bytes change across readings.
    companyId: 0xe01d,
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
      // optionalServices needed for GATT access; optionalManufacturerData
      // tells the browser to include manufacturer data in advertisement events.
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '0000ffb0-0000-1000-8000-00805f9b34fb', // femmto
          '0000fff0-0000-1000-8000-00805f9b34fb', // arboleaf
        ],
        // Declare the company IDs we want to receive advertisement data from.
        // Without this the browser may filter out manufacturer data events.
        optionalManufacturerData: ADV_SCALES.map((s) => s.companyId),
      } as RequestDeviceOptions) // cast: optionalManufacturerData is not yet in TS types

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
      const shortId = svc.uuid.slice(4, 8)

      const scaleDef = Object.values(GATT_SCALES).find(
        (s) => s.serviceShort === shortId
      )
      if (!scaleDef) continue

      let chars: BluetoothRemoteGATTCharacteristic[] = []
      try {
        chars = await svc.getCharacteristics()
      } catch {
        continue
      }

      const notifyChar = chars.find(
        (c) => c.properties.notify || c.properties.indicate
      )
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
