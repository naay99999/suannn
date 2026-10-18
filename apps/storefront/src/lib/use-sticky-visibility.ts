import { useEffect, useState, type RefObject } from 'react'

// Show a sticky bar only while neither the inline actions nor the site footer are on screen.
export function useStickyVisibility(actions: RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState({ actions: true, footer: false })

  useEffect(() => {
    const target = actions.current
    const footer = document.querySelector('footer')
    if (!target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      setOnScreen(current => {
        const next = { ...current }
        for (const entry of entries) {
          if (entry.target === target) next.actions = entry.isIntersecting
          else next.footer = entry.isIntersecting
        }
        return next
      })
    })
    observer.observe(target)
    if (footer) observer.observe(footer)
    return () => observer.disconnect()
  }, [actions])

  return !onScreen.actions && !onScreen.footer
}
