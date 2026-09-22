import { useCallback, useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoonIcon, Sun01Icon } from '@hugeicons/core-free-icons'
import { flushSync } from 'react-dom'
import { SidebarMenuButton } from '@workspace/ui/components/sidebar'

const themeStorageKey = 'admin-theme'

function getThemeTransitionClipPaths(
  cx: number,
  cy: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): [string, string] {
  const point = `${(cx / viewportWidth) * 100}% ${(cy / viewportHeight) * 100}%`
  const radius = `${(maxRadius / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`

  return [`circle(0% at ${point})`, `circle(${radius} at ${point})`]
}

export function AnimatedThemeToggler() {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const activeAnimationRef = useRef<Animation | null>(null)
  const isTransitioningRef = useRef(false)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  const cancelAnimation = useCallback(() => {
    activeAnimationRef.current?.cancel()
    activeAnimationRef.current = null
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const updateTheme = () => setIsDark(root.classList.contains('dark'))
    const observer = new MutationObserver(updateTheme)

    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      observer.disconnect()
      cancelAnimation()
      delete root.dataset.themeTransition
      root.style.removeProperty('--theme-transition-duration')
      root.style.removeProperty('--theme-transition-clip-from')
    }
  }, [cancelAnimation])

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current
    const root = document.documentElement
    if (!button || isTransitioningRef.current || root.dataset.themeTransition === 'active') return

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const { top, left, width, height } = button.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y),
    )

    const applyTheme = () => {
      const nextTheme = !root.classList.contains('dark')
      root.classList.toggle('dark', nextTheme)
      localStorage.setItem(themeStorageKey, nextTheme ? 'dark' : 'light')
      setIsDark(nextTheme)
    }

    if (typeof document.startViewTransition !== 'function') {
      applyTheme()
      return
    }

    const clipPath = getThemeTransitionClipPaths(x, y, maxRadius, viewportWidth, viewportHeight)
    const duration = 400
    const cleanup = () => {
      isTransitioningRef.current = false
      delete root.dataset.themeTransition
      root.style.removeProperty('--theme-transition-duration')
      root.style.removeProperty('--theme-transition-clip-from')
      cancelAnimation()
    }

    root.dataset.themeTransition = 'active'
    root.style.setProperty('--theme-transition-duration', `${duration}ms`)
    root.style.setProperty('--theme-transition-clip-from', clipPath[0])
    isTransitioningRef.current = true

    const transition = document.startViewTransition(() => flushSync(applyTheme))
    transition.finished.finally(cleanup).catch(() => {})

    transition.ready
      .then(() => {
        activeAnimationRef.current = root.animate(
          { clipPath },
          {
            duration,
            easing: 'ease-in-out',
            fill: 'forwards',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
      .catch(() => {})
  }, [cancelAnimation])

  return (
    <SidebarMenuButton
      ref={buttonRef}
      tooltip={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggleTheme}
    >
      <HugeiconsIcon icon={isDark ? Sun01Icon : MoonIcon} strokeWidth={2} />
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}
