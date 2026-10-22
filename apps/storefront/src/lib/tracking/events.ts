export interface TrackedItem {
  productId: string
  variantId: string
  name: string
  price: number
  quantity: number
}

// There is deliberately no `purchase` member: purchases are sent server-side only.
export type BrowserEvent =
  | { name: 'page_view'; path: string }
  | { name: 'view_item'; item: TrackedItem }
  | { name: 'add_to_cart'; item: TrackedItem }
  | { name: 'begin_checkout'; items: TrackedItem[]; value: number }
