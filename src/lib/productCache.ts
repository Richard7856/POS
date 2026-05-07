// Offline-first product cache stored in localStorage.
// Serves stale data immediately while a background fetch runs in the real page logic.
// Key format: { ts: timestamp_ms, data: Product[] }

import type { Product } from './types'

const CACHE_KEY = 'pos_products_v1'

export function saveProductsCache(products: Product[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: products }))
  } catch { /* quota exceeded or private browsing — silently ignore */ }
}

// Returns cached products (can be empty array) — never throws.
export function getProductsCache(): Product[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { ts: number; data: Product[] }
    return parsed.data ?? []
  } catch {
    return []
  }
}

// Update or insert a single product in the cache without a full reload.
// Used after an offline write so local state stays consistent.
export function upsertProductCache(product: Product): void {
  try {
    const products = getProductsCache()
    const idx = products.findIndex((p) => p.id === product.id)
    if (idx >= 0) {
      products[idx] = product
    } else {
      products.push(product)
    }
    saveProductsCache(products)
  } catch { /* ignore */ }
}
