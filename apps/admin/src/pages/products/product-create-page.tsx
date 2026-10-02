import { Link, useNavigate } from 'react-router'
import { buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { ProductForm } from './_components/product-form'

export function Component() {
  const navigate = useNavigate()

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/products">กลับไปหน้าสินค้า</Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">สร้างสินค้า</h1>
          <p className="text-muted-foreground">สร้างสินค้าเป็นฉบับร่างก่อนเพิ่มรูปแบบและเผยแพร่</p>
        </div>
      </div>
      <ProductForm mode="create" onCreated={(productId) => navigate(`/products/${productId}`, { replace: true })} />
    </section>
  )
}
