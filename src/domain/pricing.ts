export interface PricedSeat {
  price: number;
}

export interface Totals {
  subtotal: number;
  fees: number;
  total: number;
}

/** Fee is rounded per seat so the per-seat price shown always adds up. */
export function seatFee(price: number, feeRate: number): number {
  return Math.round(price * feeRate);
}

export function seatTotal(price: number, feeRate: number): number {
  return price + seatFee(price, feeRate);
}

export function basketTotals(items: PricedSeat[], feeRate: number): Totals {
  let subtotal = 0;
  let fees = 0;
  for (const item of items) {
    subtotal += item.price;
    fees += seatFee(item.price, feeRate);
  }
  return { subtotal, fees, total: subtotal + fees };
}

export function canAddToBasket(currentCount: number, max: number): boolean {
  return currentCount < max;
}
