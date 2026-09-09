// Product catalog - the "diesel today, more later" design.
//
// MPower trades diesel only right now, and plans to expand. Two ways to build
// that, and only one of them is safe:
//
//   (a) Wait, and add a products table when the second product arrives. Every
//       purchase, sale and stock figure in the System would then need a
//       backfill and a migration, on a live database, under time pressure.
//
//   (b) Carry `productId` on transactions from the start, but let it be blank -
//       blank meaning diesel. Nothing in the UI has to show a product picker
//       while there is only one product to pick, and no record ever needs
//       rewriting when the second one arrives.
//
// This is (b). `DEFAULT_PRODUCT` is a built-in, not a database row, so the
// products table can stay completely empty until MPower actually expands. On the
// day it does, an administrator adds the new product in Settings and the picker
// appears on its own (see `hasCatalog` below) - existing diesel records keep
// working untouched, because blank still means diesel.

import { DEFAULT_PRODUCT_ID, type ID, type Product } from '../data/types'

/** The implicit product every existing record belongs to. Not stored - resolved. */
export const DEFAULT_PRODUCT: Product = {
  id: DEFAULT_PRODUCT_ID,
  name: 'Diesel',
  unit: 'liter',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** Normalises a possibly-blank product id. Blank means diesel - the whole
 * "diesel today, more later" scheme rests on this one line, so every read path
 * that cares about products should go through it rather than testing for
 * undefined itself. */
export const productKey = (productId?: ID): ID => productId || DEFAULT_PRODUCT_ID

/** Resolves an id to a product, falling back to the built-in default. Never
 * returns undefined: a record pointing at a deleted product still renders as
 * something sensible rather than blank. */
export function resolveProduct(products: Product[] | undefined, productId?: ID): Product {
  const key = productKey(productId)
  if (key === DEFAULT_PRODUCT_ID) return DEFAULT_PRODUCT
  return products?.find((p) => p.id === key) ?? { ...DEFAULT_PRODUCT, id: key, name: 'Unknown product' }
}

export const productName = (products: Product[] | undefined, productId?: ID): string =>
  resolveProduct(products, productId).name

/**
 * Every product that can be picked, default first.
 *
 * The default is always included even though it has no database row, so a
 * catalog containing only user-added products still lets someone choose diesel.
 */
export function productOptions(products: Product[] | undefined): Product[] {
  const extra = (products ?? []).filter((p) => p.active && p.id !== DEFAULT_PRODUCT_ID)
  return [DEFAULT_PRODUCT, ...extra]
}

/**
 * Is there more than one product to choose between?
 *
 * Screens use this to decide whether to show a product picker at all. While
 * MPower trades diesel only this is false and the forms stay exactly as simple
 * as they are today; the day a second product is added it flips to true and the
 * pickers appear without a code change.
 */
export function hasCatalog(products: Product[] | undefined): boolean {
  return productOptions(products).length > 1
}

/** Groups anything carrying an optional productId by resolved product id - the
 * shape stock-by-product reporting wants. */
export function groupByProduct<T extends { productId?: ID }>(items: T[]): Map<ID, T[]> {
  const out = new Map<ID, T[]>()
  for (const item of items) {
    const key = productKey(item.productId)
    out.set(key, [...(out.get(key) ?? []), item])
  }
  return out
}
