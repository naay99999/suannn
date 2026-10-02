import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { invalidateInventory } from '@/lib/inventory/queries'
import { createCommandAttempt } from '@/lib/inventory/command-attempt'

type InventoryCommandOptions<TInput, TResult> = {
  command: string
  execute: (input: TInput, key: string) => Promise<TResult>
}

export function useInventoryCommand<TInput, TResult>({ command, execute }: InventoryCommandOptions<TInput, TResult>) {
  const queryClient = useQueryClient()
  const attempt = useRef(createCommandAttempt<TInput>())
  const pendingRef = useRef(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [result, setResult] = useState<TResult | null>(null)

  const run = useCallback(async (prepared: { key: string; payload: TInput }): Promise<TResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setIsPending(true)
    setError(null)
    setResult(null)

    try {
      let value: TResult
      try {
        value = await execute(prepared.payload, prepared.key)
      } catch (requestError) {
        const status = requestError instanceof ApiRequestError ? requestError.status : 0
        setError(status === 409
          ? 'ข้อมูลสต็อกเปลี่ยนแปลงบนเซิร์ฟเวอร์ กรุณาตรวจสอบรายการล่าสุดก่อนดำเนินการใหม่'
          : apiErrorMessage(requestError))
        if (status === 0 || status >= 500) {
          attempt.current.markUncertain()
          setUncertain(true)
        } else {
          attempt.current.reject()
          setUncertain(false)
          await invalidateInventory(queryClient).catch(() => undefined)
        }
        return undefined
      }

      attempt.current.complete()
      setUncertain(false)
      setResult(value)
      await invalidateInventory(queryClient).catch(() => undefined)
      return value
    } finally {
      pendingRef.current = false
      setIsPending(false)
    }
  }, [execute, queryClient])

  const submit = useCallback((input: TInput): Promise<TResult | undefined> => {
    if (pendingRef.current) return Promise.resolve(undefined)
    if (attempt.current.snapshot().state !== 'idle') {
      setError('ผลคำสั่งล่าสุดยังไม่ทราบแน่ชัด กรุณาส่งคำขอเดิมซ้ำก่อน')
      return Promise.resolve(undefined)
    }
    try {
      return run(attempt.current.prepare(command, input))
    } catch (prepareError) {
      setError(prepareError instanceof Error && prepareError.message === 'UNRESOLVED_COMMAND'
        ? 'ผลคำสั่งล่าสุดยังไม่ทราบแน่ชัด กรุณาส่งคำขอเดิมซ้ำก่อน'
        : 'ไม่สามารถเตรียมคำสั่งได้ กรุณาลองอีกครั้ง')
      return Promise.resolve(undefined)
    }
  }, [command, run])

  const retry = useCallback((): Promise<TResult | undefined> => {
    if (pendingRef.current) return Promise.resolve(undefined)
    const saved = attempt.current.snapshot()
    if (saved.state !== 'uncertain' || !saved.key || saved.payload === null) return Promise.resolve(undefined)
    return run({ key: saved.key, payload: saved.payload })
  }, [run])

  return { submit, retry, isPending, error, uncertain, result }
}
