import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@workspace/ui/components/breadcrumb'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { ProductForm } from './_components/product-form'

export function Component() {
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const confirmationDialog = useUnsavedChanges(dirty)

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 lg:px-6">
      <header className="flex flex-col gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink render={<Link to="/products" />}>สินค้า</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>สร้างสินค้า</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-col gap-1">
          <h1 className="text-headline font-semibold tracking-tight">สร้างสินค้า</h1>
          <p className="text-muted-foreground">สร้างสินค้าเป็นฉบับร่างก่อนเพิ่มรูปแบบและเผยแพร่</p>
        </div>
      </header>
      <ProductForm mode="create" onCreated={(productId) => navigate(`/products/${productId}`, { replace: true })} onDirtyChange={setDirty} />
      {confirmationDialog}
    </section>
  )
}
