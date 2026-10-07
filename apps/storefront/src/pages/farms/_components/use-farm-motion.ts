import type { RefObject } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export function useFarmMotion(scope: RefObject<HTMLElement | null>, contentKey: string): void {
  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const reveals = scope.current?.querySelectorAll<HTMLElement>('.farm-reveal')
      if (reveals?.length) gsap.from(reveals, { y: 20, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' })
      const words = scope.current?.querySelectorAll<HTMLElement>('.farm-reveal-word')
      if (words?.length) gsap.fromTo(words, { opacity: 0.18 }, {
        opacity: 1,
        stagger: 0.08,
        ease: 'none',
        scrollTrigger: { trigger: words[0], start: 'top 85%', end: 'bottom 55%', scrub: true },
      })
      const images = scope.current?.querySelectorAll<HTMLImageElement>('img')
      let refreshFrame: number | undefined
      const refresh = () => {
        if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
        refreshFrame = requestAnimationFrame(() => ScrollTrigger.refresh())
      }
      images?.forEach(image => {
        image.addEventListener('load', refresh)
        image.addEventListener('error', refresh)
      })
      return () => {
        images?.forEach(image => {
          image.removeEventListener('load', refresh)
          image.removeEventListener('error', refresh)
        })
        if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      }
    })
    media.add('(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)', () => {
      const cards = gsap.utils.toArray<HTMLElement>('.farm-stack-card', scope.current)
      cards.slice(0, -1).forEach((card, index) => {
        ScrollTrigger.create({ trigger: card, start: `top ${140 + index * 16}px`, endTrigger: scope.current, end: 'bottom 65%', pin: true, pinSpacing: false })
        if (cards[index + 1]) gsap.to(card, { scale: 0.97, opacity: 0.7, ease: 'none', scrollTrigger: { trigger: cards[index + 1], start: 'top 75%', end: 'top 150px', scrub: true } })
      })
    })
    return () => media.revert()
  }, { scope, dependencies: [contentKey], revertOnUpdate: true })
}
