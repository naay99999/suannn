import { useState, type ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@workspace/ui/components/input-group'

// A password field whose eye button reveals the value; the input keeps its own id, label and form registration.
export function PasswordInput({ id, ...props }: Omit<ComponentProps<'input'>, 'type'> & { id: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput id={id} type={visible ? 'text' : 'password'} spellCheck={false} autoCapitalize="none" {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => setVisible(value => !value)}
        >
          <HugeiconsIcon icon={visible ? ViewOffIcon : ViewIcon} strokeWidth={2} />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
