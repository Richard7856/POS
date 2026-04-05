'use client'

/**
 * TicketReceipt
 *
 * Printable/shareable receipt shown after a successful payment.
 * Rendered as step 2 of CheckoutModal — the cart is NOT cleared until the
 * cashier closes this screen (via the "Cerrar" or print/share buttons).
 *
 * Print: window.print() isolates only #ticket-print via @media print CSS
 * Share: navigator.share() (mobile) or clipboard copy (desktop)
 */

import type { CompletedSale } from '@/components/CheckoutModal'

interface Props {
  sale: CompletedSale
  onClose: () => void
}

const METODO_LABEL: Record<string, string> = {
  efectivo:      'Efectivo',
  tarjeta:       'Tarjeta',
  transferencia: 'Transferencia',
  mixto:         'Pago mixto',
}

// Short folio from UUID last 8 chars — e.g. "a3f7c219"
function folio(ventaId: string) {
  return ventaId.replace(/-/g, '').slice(-8).toUpperCase()
}

function fmtTime(date: Date) {
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(date: Date) {
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildShareText(sale: CompletedSale): string {
  const lines: string[] = [
    sale.sucursalNombre || 'Recaudería',
    `${fmtDate(sale.fecha)}  ${fmtTime(sale.fecha)}  Folio: ${folio(sale.ventaId)}`,
    '─'.repeat(32),
    ...sale.items.map(
      (i) => `${i.product.nombre.padEnd(18).slice(0, 18)} ${String(i.cantidad).padStart(6)} ${i.product.unidad.padEnd(4)}  $${i.subtotal.toFixed(2)}`
    ),
    '─'.repeat(32),
    ...(sale.descuento > 0 ? [`Descuento:              −$${sale.descuento.toFixed(2)}`] : []),
    `TOTAL:                   $${sale.total.toFixed(2)}`,
    '─'.repeat(32),
    sale.metodo === 'mixto'
      ? 'Pago mixto:\n' + sale.pagos.map((p) => `  ${METODO_LABEL[p.metodo]}: $${p.monto.toFixed(2)}`).join('\n')
      : `Pago: ${METODO_LABEL[sale.metodo] ?? sale.metodo}`,
    '─'.repeat(32),
    'Gracias por su compra 🌿',
  ]
  return lines.join('\n')
}

export default function TicketReceipt({ sale, onClose }: Props) {
  const handlePrint = () => window.print()

  const handleShare = async () => {
    const text = buildShareText(sale)
    if (navigator.share) {
      try {
        await navigator.share({ title: `Ticket ${folio(sale.ventaId)}`, text })
      } catch {
        // User dismissed share sheet — that's fine
      }
    } else {
      await navigator.clipboard.writeText(text)
      alert('Ticket copiado al portapapeles ✓')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      {/* Overlay click → close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">

        {/* Screen-only header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 print:hidden">
          <span className="font-bold text-gray-800">🧾 Ticket</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* ── Ticket content — this section is printed ── */}
        <div id="ticket-print" className="px-5 py-4 font-mono text-xs text-gray-800 space-y-0.5">

          {/* Store name */}
          <p className="text-center font-bold text-sm mb-0.5">
            {sale.sucursalNombre || 'Recaudería'}
          </p>

          {/* Date / folio */}
          <p className="text-center text-gray-500">
            {fmtDate(sale.fecha)} {fmtTime(sale.fecha)}
          </p>
          <p className="text-center text-gray-500 mb-2">
            Folio: #{folio(sale.ventaId)}
          </p>

          <p className="border-t border-dashed border-gray-300 my-2" />

          {/* Items */}
          {sale.items.map((item) => (
            <div key={item.id} className="flex justify-between gap-2">
              <span className="truncate flex-1">{item.product.nombre}</span>
              <span className="whitespace-nowrap text-gray-500">
                {item.cantidad} {item.product.unidad}
              </span>
              <span className="whitespace-nowrap font-semibold">
                ${item.subtotal.toFixed(2)}
              </span>
            </div>
          ))}

          <p className="border-t border-dashed border-gray-300 my-2" />

          {/* Discount */}
          {sale.descuento > 0 && (
            <div className="flex justify-between">
              <span>Descuento</span>
              <span className="text-gray-600">−${sale.descuento.toFixed(2)}</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between font-bold text-base mt-1">
            <span>TOTAL</span>
            <span>${sale.total.toFixed(2)}</span>
          </div>

          <p className="border-t border-dashed border-gray-300 my-2" />

          {/* Payment method */}
          {sale.metodo === 'mixto' ? (
            <div>
              <p className="text-gray-600">Pago mixto:</p>
              {sale.pagos.map((p) => (
                <div key={p.metodo} className="flex justify-between pl-2">
                  <span>{METODO_LABEL[p.metodo]}</span>
                  <span>${p.monto.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p>Pago: {METODO_LABEL[sale.metodo] ?? sale.metodo}</p>
          )}

          <p className="border-t border-dashed border-gray-300 my-2" />

          {/* Footer */}
          <p className="text-center text-gray-500 py-1">Gracias por su compra 🌿</p>
        </div>

        {/* Screen-only action buttons */}
        <div className="flex gap-3 px-5 pb-5 print:hidden">
          <button
            onClick={handlePrint}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            🖨️ Imprimir
          </button>
          <button
            onClick={handleShare}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            📲 Compartir
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 active:scale-95 transition-all"
          >
            ✓ Cerrar
          </button>
        </div>

      </div>
    </div>
  )
}
