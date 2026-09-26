export type ProductCategory = 'fresh' | 'processed'
export type ProductAvailability = 'in-season' | 'coming-soon'

export interface ProductImage {
  src: string
  thumbnailSrc?: string
  alt: string
  caption: string
}

export interface Product {
  id: string
  name: string
  english: string
  category: ProductCategory
  categoryLabel: string
  images: readonly [ProductImage, ...ProductImage[]]
  imageNote?: string
  description: string
  unit: string
  price: number
  availability: ProductAvailability
  farm: string
  province: string
  origin: string
  storage: string
  ingredients?: string
}

export const availabilityLabels: Record<ProductAvailability, string> = {
  'in-season': 'อยู่ในฤดูกาล',
  'coming-soon': 'รอฤดูกาลถัดไป',
}

export const formatPrice = (price: number) =>
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(price)

const initialProducts = [
  {
    id: 'mango',
    name: 'มะม่วงสุก หวานพอดี',
    english: 'A little sunshine',
    category: 'fresh',
    categoryLabel: 'ผลไม้สด',
    images: [
      { src: '/images/mango.jpg', alt: 'มะม่วงสุกสีทองทั้งลูกและหั่นชิ้น', caption: 'ภาพประกอบผลไม้' },
      { src: '/images/products/mango/detail.webp', thumbnailSrc: '/images/products/mango/detail-thumb.webp', alt: 'มะม่วงสุกผ่าซีกหั่นเต๋า เห็นเนื้อสีทอง', caption: 'ภาพประกอบ: เนื้อมะม่วงสุก' },
      { src: '/images/products/mango/serving.webp', thumbnailSrc: '/images/products/mango/serving-thumb.webp', alt: 'มะม่วงสุกเสิร์ฟคู่กับข้าวเหนียวในจานเซรามิก', caption: 'ภาพประกอบวิธีเสิร์ฟ' },
    ],
    description:
      'ความหอมหวานที่อยากส่งต่อในทุกฤดูกาล เหมาะกับมื้อว่างง่าย ๆ หรือข้าวเหนียวมูนจานโปรด',
    unit: 'ตัวอย่างแพ็ก 1 กก.',
  },
  {
    id: 'orange',
    name: 'ส้ม สดชื่นทุกคำ',
    english: 'Your daily dose of fresh',
    category: 'fresh',
    categoryLabel: 'ผลไม้สด',
    images: [
      { src: '/images/orange.jpg', alt: 'ส้มสดสีส้มบนพื้นหลังสีอ่อน', caption: 'ภาพประกอบผลไม้' },
      { src: '/images/products/orange/detail.webp', thumbnailSrc: '/images/products/orange/detail-thumb.webp', alt: 'ส้มสดผ่าครึ่งและชิ้นส้มพร้อมใบเขียว', caption: 'ภาพประกอบ: เนื้อส้มสด' },
      { src: '/images/products/orange/serving.webp', thumbnailSrc: '/images/products/orange/serving-thumb.webp', alt: 'กลีบส้มสดในถ้วยเซรามิกพร้อมส้มทั้งผล', caption: 'ภาพประกอบวิธีเสิร์ฟ' },
    ],
    description: 'เติมความสดชื่นให้วันธรรมดาด้วยผลไม้รสหวานอมเปรี้ยว จะแบ่งกันกินหรือคั้นสดก็อร่อย',
    unit: 'ตัวอย่างแพ็ก 1 กก.',
  },
  {
    id: 'avocado',
    name: 'อะโวคาโด เนื้อละมุน',
    english: 'Good mornings start here',
    category: 'fresh',
    categoryLabel: 'ผลไม้สด',
    images: [
      { src: '/images/avocado.jpg', alt: 'อะโวคาโดผ่าครึ่งเห็นเมล็ด', caption: 'ภาพประกอบผลไม้' },
      { src: '/images/products/avocado/detail.webp', thumbnailSrc: '/images/products/avocado/detail-thumb.webp', alt: 'อะโวคาโดผ่าครึ่งและชิ้นอะโวคาโด เห็นเนื้อสีเขียว', caption: 'ภาพประกอบ: เนื้ออะโวคาโด' },
      { src: '/images/products/avocado/serving.webp', thumbnailSrc: '/images/products/avocado/serving-thumb.webp', alt: 'อะโวคาโดหั่นชิ้นเสิร์ฟบนจานพร้อมมะนาว', caption: 'ภาพประกอบวิธีเสิร์ฟ' },
    ],
    description: 'อีกหนึ่งวัตถุดิบเรียบง่ายสำหรับมื้อเช้า จับคู่กับขนมปัง สลัด หรือเมนูที่คุณชอบ',
    unit: 'ตัวอย่างแพ็ก 500 กรัม',
  },
  {
    id: 'dried-mango',
    name: 'มะม่วงอบแห้ง พกความอร่อย',
    english: 'A piece of the season',
    category: 'processed',
    categoryLabel: 'ผลิตภัณฑ์แปรรูป',
    images: [
      { src: '/images/mango.jpg', alt: 'มะม่วงสด วัตถุดิบของมะม่วงอบแห้ง', caption: 'ภาพวัตถุดิบประกอบ ไม่ใช่ภาพสินค้าจริง' },
      { src: '/images/products/dried-mango/detail.webp', thumbnailSrc: '/images/products/dried-mango/detail-thumb.webp', alt: 'ชิ้นมะม่วงอบแห้งวางคู่กับมะม่วงสด', caption: 'ภาพประกอบ: มะม่วงอบแห้ง' },
      { src: '/images/products/dried-mango/serving.webp', thumbnailSrc: '/images/products/dried-mango/serving-thumb.webp', alt: 'มะม่วงอบแห้งเสิร์ฟบนจานคู่กับชา', caption: 'ภาพประกอบวิธีเสิร์ฟ' },
    ],
    description:
      'แนวคิดการส่งต่อรสชาติของผลไม้ในรูปแบบที่เก็บได้นานขึ้น รายละเอียดส่วนผสมและวิธีผลิตจะแสดงเมื่อเปิดจำหน่าย',
    unit: 'ตัวอย่างแพ็ก 100 กรัม',
    imageNote: 'ภาพวัตถุดิบประกอบ ไม่ใช่ภาพสินค้าจริง',
  },
] as const


const details = {
  mango: { price: 129, farm: 'สวนแสงเช้า', province: 'ฉะเชิงเทรา', availability: 'in-season', storage: 'วางในที่อากาศถ่ายเท เมื่อสุกตามชอบแล้วให้แช่เย็นและรับประทานภายใน 3–5 วัน' },
  orange: { price: 99, farm: 'สวนลมเหนือ', province: 'เชียงใหม่', availability: 'in-season', storage: 'เก็บในช่องผักของตู้เย็น ล้างก่อนรับประทาน และหลีกเลี่ยงการเก็บผลที่ช้ำรวมกัน' },
  avocado: { price: 159, farm: 'สวนเนินเขียว', province: 'ตาก', availability: 'coming-soon', storage: 'พักที่อุณหภูมิห้องจนเนื้อนิ่มเล็กน้อย จากนั้นแช่เย็น หลังผ่าควรรับประทานทันที' },
  'dried-mango': { price: 89, farm: 'สวนแสงเช้า', province: 'ฉะเชิงเทรา', availability: 'in-season', storage: 'ปิดซองให้สนิท เก็บในที่แห้งและพ้นแสงแดด หลังเปิดควรรับประทานโดยเร็ว', ingredients: 'มะม่วง (ส่วนประกอบตัวอย่าง รายละเอียดจริงจะแสดงบนฉลาก)' },
} satisfies Record<(typeof initialProducts)[number]['id'], Pick<Product, 'price' | 'farm' | 'province' | 'availability' | 'storage' | 'ingredients'>>

// All prices, farm names, availability and product claims below are illustrative.
export const products: Product[] = [
  ...initialProducts.map((product): Product => ({
    ...product,
    ...details[product.id],
    unit: product.unit.replace('ตัวอย่างแพ็ก ', ''),
    origin: 'ตัวอย่างเส้นทางผลผลิตจากสวนที่เราคัดเลือก เริ่มจากทำความรู้จักคนปลูก ดูแลการคัดขนาด และเตรียมผลผลิตสำหรับส่งต่อ ข้อมูลสวนและวิธีผลิตจริงจะยืนยันก่อนเปิดจำหน่าย',
  })),
  {
    id: 'orange-jam', name: 'แยมส้ม สดใสบนขนมปัง', english: 'Spread a little joy',
    category: 'processed', categoryLabel: 'ผลิตภัณฑ์แปรรูป',
    images: [
      { src: '/images/orange.jpg', alt: 'ส้มสด วัตถุดิบของแยมส้ม', caption: 'ภาพวัตถุดิบประกอบ ไม่ใช่ภาพสินค้าจริง' },
      { src: '/images/products/orange-jam/ingredient.webp', thumbnailSrc: '/images/products/orange-jam/ingredient-thumb.webp', alt: 'ส้มผ่าครึ่ง กลีบส้ม เปลือกส้ม และแยมในถ้วย', caption: 'ภาพประกอบ: วัตถุดิบส้ม' },
      { src: '/images/products/orange-jam/toast.webp', thumbnailSrc: '/images/products/orange-jam/toast-thumb.webp', alt: 'ขนมปังทาแยมส้มเสิร์ฟพร้อมชิ้นส้ม', caption: 'ภาพประกอบวิธีเสิร์ฟ' },
    ],
    imageNote: 'ภาพวัตถุดิบประกอบ ไม่ใช่ภาพสินค้าจริง',
    description: 'แนวคิดการเก็บความหอมของส้มไว้ในขวดเล็ก ๆ สำหรับขนมปังและมื้อเช้าเรียบง่าย',
    unit: '180 กรัม', price: 119, availability: 'in-season', farm: 'สวนลมเหนือ', province: 'เชียงใหม่',
    origin: 'ตัวอย่างการต่อยอดส้มจากสวนให้เป็นของอร่อยที่เก็บไว้ได้นานขึ้น โดยจะเปิดเผยแหล่งวัตถุดิบและผู้แปรรูปก่อนจำหน่ายจริง',
    storage: 'เก็บในที่เย็นและพ้นแสงแดด หลังเปิดให้แช่เย็น ใช้ช้อนสะอาดทุกครั้ง',
    ingredients: 'ส้ม น้ำตาล และน้ำมะนาว (สูตรตัวอย่าง ยังไม่ใช่ฉลากสินค้าจริง)',
  },
  {
    id: 'avocado-spread', name: 'อะโวคาโดสเปรด มื้อเช้าง่าย ๆ', english: 'A softer start',
    category: 'processed', categoryLabel: 'ผลิตภัณฑ์แปรรูป',
    images: [
      { src: '/images/avocado.jpg', alt: 'อะโวคาโดสด วัตถุดิบของอะโวคาโดสเปรด', caption: 'ภาพวัตถุดิบประกอบ ไม่ใช่ภาพสินค้าจริง' },
      { src: '/images/products/avocado-spread/ingredient.webp', thumbnailSrc: '/images/products/avocado-spread/ingredient-thumb.webp', alt: 'อะโวคาโดผ่าครึ่งกับเนื้ออะโวคาโดบดในถ้วย', caption: 'ภาพประกอบ: วัตถุดิบอะโวคาโด' },
      { src: '/images/products/avocado-spread/toast.webp', thumbnailSrc: '/images/products/avocado-spread/toast-thumb.webp', alt: 'ขนมปังทาอะโวคาโดสเปรดเสิร์ฟกับอะโวคาโดและมะนาว', caption: 'ภาพประกอบวิธีเสิร์ฟ' },
    ],
    imageNote: 'ภาพวัตถุดิบประกอบ ไม่ใช่ภาพสินค้าจริง',
    description: 'แนวคิดสเปรดเนื้อละมุนสำหรับจับคู่กับขนมปัง เพิ่มความอร่อยให้มื้อเช้าในแบบที่ชอบ',
    unit: '150 กรัม', price: 139, availability: 'coming-soon', farm: 'สวนเนินเขียว', province: 'ตาก',
    origin: 'ตัวอย่างผลิตภัณฑ์จากอะโวคาโดที่คัดระดับความสุกให้เหมาะกับการแปรรูป รายละเอียดกระบวนการผลิตจะยืนยันก่อนเปิดจำหน่าย',
    storage: 'ต้องเก็บในตู้เย็นและใช้ช้อนสะอาด รายละเอียดอายุสินค้ารอการยืนยันจากผู้ผลิต',
    ingredients: 'อะโวคาโด น้ำมะนาว และเกลือ (สูตรตัวอย่าง ยังไม่ใช่ฉลากสินค้าจริง)',
  },
]

export const featuredProducts = products.slice(0, 4)

export function readCatalogFilters(params: URLSearchParams) {
  const category = params.get('category')
  const availability = params.get('availability')
  const sort = params.get('sort')
  return {
    q: params.get('q') ?? '',
    category: category === 'fresh' || category === 'processed' ? category : 'all',
    availability: availability === 'in-season' || availability === 'coming-soon' ? availability : 'all',
    sort: sort === 'price-asc' || sort === 'price-desc' ? sort : 'recommended',
  }
}

export function filterProducts(params: URLSearchParams) {
  const filters = readCatalogFilters(params)
  const query = filters.q.trim().normalize('NFC').toLocaleLowerCase('th-TH')
  const result = products.filter(product =>
    (filters.category === 'all' || product.category === filters.category) &&
    (filters.availability === 'all' || product.availability === filters.availability) &&
    `${product.name} ${product.english}`.normalize('NFC').toLocaleLowerCase('th-TH').includes(query),
  )
  if (filters.sort !== 'recommended') {
    result.sort((a, b) => filters.sort === 'price-asc' ? a.price - b.price : b.price - a.price)
  }
  return result
}
