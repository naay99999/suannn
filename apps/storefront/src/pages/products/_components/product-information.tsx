import type { StoreProductDetail } from '@/lib/store-products'

export function ProductInformation({ product }: { product: StoreProductDetail }) {
  if (!product.description && !product.originStory && !product.storageInstructions) return null

  return (
    <div className="mt-8 grid gap-5">
      {product.description && <section aria-labelledby="product-description-title">
        <h2 id="product-description-title" className="text-base font-semibold">รายละเอียดสินค้า</h2>
        <p className="mt-2 leading-7 text-muted-foreground">{product.description}</p>
      </section>}
      {product.storageInstructions && <section aria-labelledby="product-storage-title">
        <h2 id="product-storage-title" className="text-base font-semibold">การเก็บรักษา</h2>
        <p className="mt-2 leading-7 text-muted-foreground">{product.storageInstructions}</p>
      </section>}
      {product.originStory && <section aria-labelledby="product-origin-title">
        <h2 id="product-origin-title" className="text-base font-semibold">เรื่องราวของสินค้า</h2>
        <p className="mt-2 leading-7 text-muted-foreground">{product.originStory}</p>
      </section>}
    </div>
  )
}
