import { useRef, useState, type ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Button } from '@workspace/ui/components/button'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const notes = [
  'เลือกผลไม้และของอร่อยจากสวนได้ในจังหวะของคุณ',
  'เก็บที่อยู่สำหรับการจัดส่งครั้งถัดไป',
  'ย้อนดูคำสั่งซื้อและรายละเอียดได้ในที่เดียว',
]

export function AuthPageFrame({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  const scope = useRef<HTMLDivElement>(null)
  const [activeNote, setActiveNote] = useState(0)

  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.auth-story-image', { scale: 0.8, opacity: 0.7 }, {
        scale: 1, opacity: 1, ease: 'none',
        scrollTrigger: { trigger: '.auth-story', start: 'top bottom', end: 'center center', scrub: true },
      })
      gsap.to('.auth-story-image', {
        opacity: 0.2, ease: 'none',
        scrollTrigger: { trigger: '.auth-story', start: 'center center', end: 'bottom top', scrub: true },
      })
    })
    media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      ScrollTrigger.create({
        trigger: '.auth-story', start: 'top 120px', end: 'bottom bottom',
        pin: '.auth-story-title', pinSpacing: false,
      })
    })
    return () => media.revert()
  }, { scope })

  return (
    <div ref={scope} className="w-full max-w-full overflow-x-hidden">
      <section className="grid min-h-[min(760px,calc(100svh-150px))] items-center gap-12 py-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-20 lg:py-16">
        <div className="mx-auto w-full max-w-xl lg:mx-0 lg:max-w-5xl">
          <p className="mb-5 text-sm font-medium text-primary-ink">ยินดีต้อนรับสู่ suannn</p>
          <h1 className="max-w-5xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl xl:text-6xl">{title}</h1>
          <p className="mt-5 max-w-lg text-base leading-8 text-muted-foreground">{description}</p>
          <div className="mt-9">{children}</div>
        </div>
        <div className="group relative hidden min-h-[560px] overflow-hidden rounded-[2rem] bg-accent lg:block">
          <img
            src="/images/fruit-hero.jpg"
            alt="ผลไม้สดที่คัดจากสวน"
            className="absolute inset-0 size-full object-cover contrast-125 transition-transform duration-700 ease-out group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 via-transparent to-transparent" />
          <p className="absolute bottom-10 left-10 right-10 max-w-md text-3xl font-medium leading-snug tracking-tight text-white">ความสดจากสวน รออยู่ในทุกฤดูกาล</p>
        </div>
      </section>

      <section className="grid grid-flow-dense gap-4 border-t py-24 sm:grid-cols-3 md:py-32" aria-label="สิ่งที่ทำได้ในบัญชี">
        {[
          ['เลือกของอร่อย', 'เดินดูผลผลิตและเรื่องราวจากสวน'],
          ['จัดการที่อยู่', 'เก็บปลายทางที่ใช้เป็นประจำ'],
          ['ติดตามรายการ', 'ย้อนกลับมาดูคำสั่งซื้อได้เสมอ'],
        ].map(([heading, copy]) => (
          <div key={heading} className="rounded-3xl bg-accent p-7 md:p-9">
            <h2 className="text-xl font-semibold">{heading}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{copy}</p>
          </div>
        ))}
      </section>

      <section className="auth-story grid gap-10 py-20 lg:min-h-[680px] lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:py-32">
        <div className="auth-story-title self-start">
          <h2 className="max-w-5xl text-3xl font-semibold leading-tight tracking-tight md:text-5xl">พื้นที่เล็ก ๆ ที่ทำให้การเลือกของจากสวนง่ายขึ้น</h2>
          <p className="mt-5 max-w-md text-muted-foreground">เริ่มจากบัญชีของคุณ แล้วกลับมาเลือกสิ่งที่ชอบเมื่อไรก็ได้</p>
        </div>
        <div className="overflow-hidden rounded-[2rem] bg-accent">
          <img src="/images/mango.jpg" alt="มะม่วงจากสวน" className="auth-story-image h-full min-h-96 w-full object-cover" />
        </div>
      </section>

      <div className="overflow-hidden border-y py-5" aria-hidden="true">
        <div className="flex w-max animate-marquee gap-12 whitespace-nowrap text-xl font-semibold text-primary-ink motion-reduce:animate-none" style={{ '--duration': '28s', '--gap': '3rem' } as React.CSSProperties}>
          {Array.from({ length: 2 }, (_, index) => <span key={index}>จากสวนถึงคุณ · คัดด้วยความตั้งใจ · เลือกในแบบของคุณ · </span>)}
        </div>
      </div>

      <section className="py-24 text-center md:py-32">
        <h2 className="mx-auto max-w-5xl text-3xl font-semibold leading-tight tracking-tight md:text-5xl">
          ให้ทุกครั้งที่กลับมา <span className="mx-2 inline-block h-9 w-20 overflow-hidden rounded-full align-middle md:h-12 md:w-28"><img src="/images/orange.jpg" alt="" className="size-full object-cover" /></span> รู้สึกคุ้นเคย
        </h2>
        <p className="mx-auto mt-7 max-w-xl text-muted-foreground" aria-live="polite">{notes[activeNote]}</p>
        <div className="mt-7 flex justify-center gap-3" aria-label="ข้อความแนะนำ">
          {notes.map((_, index) => (
            <Button key={index} type="button" size="sm" variant={activeNote === index ? 'default' : 'outline'} onClick={() => setActiveNote(index)} aria-label={`แสดงข้อความ ${index + 1}`}>{index + 1}</Button>
          ))}
        </div>
      </section>
    </div>
  )
}
