import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export function useProductMotion(key: string) {
  const scope = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const reveals = scope.current?.querySelectorAll('.catalog-reveal')
      if (reveals?.length) gsap.from(reveals, { y: 18, opacity: 0, duration: 0.65, stagger: 0.08, ease: 'power3.out' })
      const image = scope.current?.querySelector('.origin-image')
      if (image) gsap.from(image, { scale: 0.94, ease: 'none', scrollTrigger: { trigger: image, start: 'top bottom', end: 'center center', scrub: true } })
      const words = scope.current?.querySelectorAll('.origin-word')
      if (words?.length) gsap.from(words, { opacity: 0.2, stagger: 0.15, ease: 'none', scrollTrigger: { trigger: '.product-origin', start: 'top 85%', end: 'center 60%', scrub: true } })
    })
    return () => media.revert()
  }, { scope, dependencies: [key], revertOnUpdate: true })
  return scope
}
