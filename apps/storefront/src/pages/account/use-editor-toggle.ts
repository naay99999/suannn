import { useEffect, useRef, useState } from 'react'

// Returns focus to the row's action button after its editor closes.
export function useEditorToggle() {
  const [editing, setEditing] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const closing = useRef(false)
  useEffect(() => {
    if (!editing && closing.current) { trigger.current?.focus(); closing.current = false }
  }, [editing])
  return { editing, trigger, open: () => setEditing(true), close: () => { closing.current = true; setEditing(false) } }
}
