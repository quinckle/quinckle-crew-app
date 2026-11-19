/**
 * Offer engine — "buy N get M" counting. Pure, no imports, no IO.
 *
 * This file is copied verbatim into the web app (lib/offer-engine.ts) and the
 * crew app (services/offer-engine.ts) so the diner nudge and the crew progress
 * chip show exactly what the server will charge. The server stays the
 * authority: change it here first, then copy it over.
 *
 * Model
 *   trigger  — `triggerQty` units drawn from triggerItemIds ∪ triggerItemId ∪
 *              any item in triggerCategories. Combo lines never count.
 *   reward   — how many reward units that buys, by `rewardMode`:
 *                ONCE        n ≥ triggerQty            → freeItemQty
 *                REPEAT      ⌊n / triggerQty⌋ × freeItemQty, capped at maxRewardQty
 *                MILESTONES  rewardQty of the highest milestone with buyQty ≤ n
 *   free     — only reward items actually on the order are made free (cheapest
 *              first). An earned reward nobody added is "unclaimed", which the
 *              apps turn into an "Add free Kebab" prompt.
 *   overlap  — when the reward item is also a trigger item (buy 2 biryani, get
 *              1 biryani), a unit made free stops counting toward the trigger,
 *              so 3 biryanis = pay for 2.
 */

export type RewardMode = 'ONCE' | 'REPEAT' | 'MILESTONES'
export type Milestone = { buyQty: number; rewardQty: number }

export type EngineOffer = {
  type?: string
  minOrderValue?: number | string | null
  triggerItemId?: string | null
  triggerItemIds?: string[] | null
  triggerCategories?: string[] | null
  triggerQty?: number | null
  rewardMode?: string | null
  maxRewardQty?: number | null
  milestones?: unknown
  freeItemId?: string | null
  freeItemIds?: string[] | null
  freeItemQty?: number | null
}

export type EngineLine = {
  menuItemId: string
  quantity: number
  unitPrice: number
  category?: string | null
  isCombo?: boolean
}

export type FreeResult = {
  /** Reward units made free on these lines. */
  freeQty: number
  /** ₹ value of those units (their own line prices, cheapest first). */
  freeValue: number
  /** Trigger units still counting after freed overlap units are removed. */
  triggerUnits: number
}

export type OfferProgress = {
  triggerUnits: number
  /** Reward units the trigger has earned, whether or not they are on the order. */
  earned: number
  /** Earned units that are actually on the order (= free). */
  freeQty: number
  /** Earned but not on the order yet — "add N free". */
  unclaimed: number
  /** Next step up, or null when the reward cannot grow. */
  next: { needMore: number; rewardQty: number } | null
}

const toNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const posInt = (v: unknown, fallback: number): number => {
  const n = Math.floor(toNum(v))
  return n >= 1 ? n : fallback
}

export function triggerItemSet(o: EngineOffer): Set<string> {
  const s = new Set<string>((o.triggerItemIds ?? []).filter(Boolean))
  if (o.triggerItemId) s.add(o.triggerItemId)
  return s
}

export function freeItemSet(o: EngineOffer): Set<string> {
  const s = new Set<string>((o.freeItemIds ?? []).filter(Boolean))
  if (o.freeItemId) s.add(o.freeItemId)
  return s
}

/** True when the offer is unlocked by buying a quantity of items (not spend alone). */
export function hasQtyTrigger(o: EngineOffer): boolean {
  return triggerItemSet(o).size > 0 || (o.triggerCategories ?? []).length > 0
}

export function rewardModeOf(o: EngineOffer): RewardMode {
  return o.rewardMode === 'REPEAT' || o.rewardMode === 'MILESTONES' ? o.rewardMode : 'ONCE'
}

/** Valid milestones, ascending by buyQty, one per buyQty. Bad entries are dropped. */
export function normalizeMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return []
  const byBuy = new Map<number, number>()
  for (const m of raw) {
    const buyQty = Math.floor(toNum((m as any)?.buyQty))
    const rewardQty = Math.floor(toNum((m as any)?.rewardQty))
    if (buyQty >= 1 && rewardQty >= 1) byBuy.set(buyQty, rewardQty)
  }
  return [...byBuy.entries()].sort((a, b) => a[0] - b[0]).map(([buyQty, rewardQty]) => ({ buyQty, rewardQty }))
}

/** Reward units earned by `n` trigger units. */
export function rewardForCount(o: EngineOffer, n: number): number {
  if (n <= 0) return 0
  const q = posInt(o.triggerQty, 1)
  const m = posInt(o.freeItemQty, 1)
  const mode = rewardModeOf(o)
  if (mode === 'MILESTONES') {
    let best = 0
    for (const ms of normalizeMilestones(o.milestones)) if (ms.buyQty <= n) best = ms.rewardQty
    return best
  }
  if (mode === 'REPEAT') {
    const r = Math.floor(n / q) * m
    const cap = o.maxRewardQty != null && toNum(o.maxRewardQty) >= 1 ? Math.floor(toNum(o.maxRewardQty)) : Infinity
    return Math.min(r, cap)
  }
  return n >= q ? m : 0
}

/** The next trigger count that raises the reward, relative to `n`. */
export function nextStep(o: EngineOffer, n: number): { needMore: number; rewardQty: number } | null {
  const now = rewardForCount(o, n)
  const mode = rewardModeOf(o)
  let target: number | null = null
  if (mode === 'MILESTONES') {
    const ms = normalizeMilestones(o.milestones).find((x) => x.buyQty > n && x.rewardQty > now)
    target = ms ? ms.buyQty : null
  } else {
    const q = posInt(o.triggerQty, 1)
    const t = (Math.floor(n / q) + 1) * q
    target = rewardForCount(o, t) > now ? t : null
  }
  return target == null ? null : { needMore: target - n, rewardQty: rewardForCount(o, target) }
}

function isTriggerLine(o: EngineOffer, l: EngineLine, items: Set<string>, cats: Set<string>): boolean {
  if (l.isCombo) return false
  if (items.has(l.menuItemId)) return true
  return !!l.category && cats.has(l.category)
}

/** Raw trigger units on these lines (no overlap adjustment). */
export function countTriggerUnits(o: EngineOffer, lines: EngineLine[]): number {
  const items = triggerItemSet(o)
  const cats = new Set(o.triggerCategories ?? [])
  let n = 0
  for (const l of lines) if (isTriggerLine(o, l, items, cats)) n += Math.max(0, Math.floor(l.quantity))
  return n
}

/**
 * How many reward units on `lines` are free.
 *
 * `spendBase` is the ₹ amount that counts toward `minOrderValue` (the caller
 * applies exclusions and earlier rounds). Freed units don't count toward the
 * minimum, so a free kebab can't be what unlocks itself.
 */
export function computeFree(o: EngineOffer, lines: EngineLine[], spendBase?: number): FreeResult {
  const tItems = triggerItemSet(o)
  const tCats = new Set(o.triggerCategories ?? [])
  const rItems = freeItemSet(o)
  const qtyTrigger = hasQtyTrigger(o)
  const minOrder = o.minOrderValue == null || o.minOrderValue === '' ? null : toNum(o.minOrderValue)
  const spendFree = minOrder != null && spendBase != null ? posInt(o.freeItemQty, 1) : 0

  let triggerOnly = 0
  const rewardOnly: number[] = []
  const both: number[] = []
  for (const l of lines) {
    if (l.isCombo) continue
    const qty = Math.max(0, Math.floor(l.quantity))
    if (qty === 0) continue
    const t = qtyTrigger && isTriggerLine(o, l, tItems, tCats)
    const r = rItems.has(l.menuItemId)
    const price = Math.max(0, toNum(l.unitPrice))
    for (let i = 0; i < qty; i++) {
      if (t && r) both.push(price)
      else if (r) rewardOnly.push(price)
      else if (t) triggerOnly++
    }
  }
  rewardOnly.sort((a, b) => a - b)
  both.sort((a, b) => a - b)

  const earned = (trig: number, freedValue: number): number => {
    const byQty = qtyTrigger ? rewardForCount(o, trig) : 0
    const bySpend = spendFree > 0 && (spendBase as number) - freedValue >= (minOrder as number) ? spendFree : 0
    return Math.max(byQty, bySpend)
  }

  // Prefix sums so each candidate is O(1).
  const pre = (a: number[]) => a.reduce<number[]>((acc, v) => (acc.push((acc[acc.length - 1] ?? 0) + v), acc), [0])
  const preR = pre(rewardOnly)
  const preB = pre(both)

  for (let f = rewardOnly.length + both.length; f >= 1; f--) {
    const fr = Math.min(f, rewardOnly.length)
    const fb = f - fr
    if (fb > both.length) continue
    const freedValue = (preR[fr] ?? 0) + (preB[fb] ?? 0)
    const trig = triggerOnly + both.length - fb
    if (f <= earned(trig, freedValue)) return { freeQty: f, freeValue: freedValue, triggerUnits: trig }
  }
  return { freeQty: 0, freeValue: 0, triggerUnits: triggerOnly + both.length }
}

/** Progress for a nudge: what is earned, what is free, what is unclaimed, what is next. */
export function offerProgress(o: EngineOffer, lines: EngineLine[], spendBase?: number): OfferProgress {
  const free = computeFree(o, lines, spendBase)
  const minOrder = o.minOrderValue == null || o.minOrderValue === '' ? null : toNum(o.minOrderValue)
  const bySpend = minOrder != null && spendBase != null && spendBase - free.freeValue >= minOrder ? posInt(o.freeItemQty, 1) : 0
  const earned = Math.max(hasQtyTrigger(o) ? rewardForCount(o, free.triggerUnits) : 0, bySpend)
  return {
    triggerUnits: free.triggerUnits,
    earned,
    freeQty: free.freeQty,
    unclaimed: Math.max(0, earned - free.freeQty),
    next: hasQtyTrigger(o) ? nextStep(o, free.triggerUnits) : null,
  }
}

/**
 * Reward units to make free on THIS order, given the table's earlier rounds.
 *
 * Stateless on purpose: free(prior + cart) − free(prior). Earlier rounds that
 * already took this offer got free(prior); if they took a different offer or
 * none, the delta can only under-give, never double-give. The delta is priced
 * from this order's reward units first (cheapest first), then earlier ones.
 */
export function freeForThisOrder(
  o: EngineOffer,
  priorLines: EngineLine[],
  cartLines: EngineLine[],
  spendBaseAll?: number,
  spendBasePrior?: number,
): { freeQty: number; freeValue: number } {
  const all = computeFree(o, [...priorLines, ...cartLines], spendBaseAll)
  const before = priorLines.length > 0 || spendBasePrior != null ? computeFree(o, priorLines, spendBasePrior) : { freeQty: 0 }
  const delta = Math.max(0, all.freeQty - before.freeQty)
  if (delta === 0) return { freeQty: 0, freeValue: 0 }

  const rItems = freeItemSet(o)
  const unitPrices = (lines: EngineLine[]) => {
    const out: number[] = []
    for (const l of lines) {
      if (l.isCombo || !rItems.has(l.menuItemId)) continue
      for (let i = 0; i < Math.max(0, Math.floor(l.quantity)); i++) out.push(Math.max(0, toNum(l.unitPrice)))
    }
    return out.sort((a, b) => a - b)
  }
  const pool = [...unitPrices(cartLines), ...unitPrices(priorLines)]
  const qty = Math.min(delta, pool.length)
  let value = 0
  for (let i = 0; i < qty; i++) value += pool[i] ?? 0
  return { freeQty: qty, freeValue: value }
}
