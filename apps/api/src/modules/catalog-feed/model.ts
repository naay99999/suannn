import { t } from 'elysia'

export const catalogFeedModels = {
  'catalogFeed.summary': t.Object({
    brandName: t.String(),
    warnings: t.Array(t.Union([t.Literal('shipping_fee_unset'), t.Literal('checkout_disabled'), t.Literal('no_items_in_feed')])),
    counts: t.Object({
      total: t.Number(),
      inFeed: t.Number(),
      inStock: t.Number(),
      outOfStock: t.Number(),
      excluded: t.Number(),
    }, { additionalProperties: false }),
    problems: t.Array(t.Object({
      productId: t.String(),
      variantId: t.String(),
      productName: t.String(),
      variantName: t.String(),
      code: t.Union([
        t.Literal('no_image'),
        t.Literal('title_truncated'),
        t.Literal('no_description'),
        t.Literal('image_missing_alt'),
      ]),
      excluded: t.Boolean(),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
}
