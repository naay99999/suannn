import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { clearOrderAttempt, readOrderAttempt, saveOrderAttempt, type OrderAttempt } from '@/lib/orders/attempt-storage'
import { ordersApi, type OrderCommand, type OrderDetail } from '@/lib/orders/api'
import { invalidateOrders, orderQuery } from '@/lib/orders/queries'

export function useOrderCommand({ staffId, orderId }: { staffId: string; orderId: string }) {
  const queryClient = useQueryClient()
  const identity = `${staffId}:${orderId}`
  const attemptRef = useRef<{ identity: string; attempt: OrderAttempt | null } | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [reviewRequired, setReviewRequired] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OrderDetail | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    const attempt = readOrderAttempt(staffId, orderId)
    attemptRef.current = { identity, attempt }
    setUncertain(Boolean(attempt))
    setError(null)
    setResult(null)
    setReviewRequired(false)
    setStorageAvailable(true)
  }, [identity, orderId, staffId])

  useEffect(() => {
    if (!uncertain || storageAvailable) return
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLeave)
    return () => window.removeEventListener('beforeunload', preventLeave)
  }, [storageAvailable, uncertain])

  const run = useCallback(async (attempt: OrderAttempt): Promise<OrderDetail | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setIsPending(true)
    setError(null)
    setResult(null)
    try {
      try {
        const response = await ordersApi.execute(orderId, attempt.command, attempt.key)
        await invalidateOrders(queryClient, orderId)
        const current = await queryClient.fetchQuery({ ...orderQuery(orderId), staleTime: 0 })
        clearOrderAttempt(staffId, orderId)
        attemptRef.current = { identity, attempt: null }
        setUncertain(false)
        setReviewRequired(false)
        setResult(current ?? response)
        return current ?? response
      } catch (requestError) {
        const status = requestError instanceof ApiRequestError ? requestError.status : 0
        setError(status === 409 ? 'ข้อมูลคำสั่งซื้อเปลี่ยนแล้ว ตรวจสอบสถานะล่าสุดก่อนดำเนินการต่อ' : apiErrorMessage(requestError))
        if (status === 0 || status >= 500) {
          attemptRef.current = { identity, attempt }
          setUncertain(true)
        } else {
          clearOrderAttempt(staffId, orderId)
          attemptRef.current = { identity, attempt: null }
          setUncertain(false)
          if (status === 401) {
            queryClient.setQueryData(authSessionQuery.queryKey, null)
          }
          await invalidateOrders(queryClient, orderId)
          if (status === 409) {
            try {
              await queryClient.fetchQuery({ ...orderQuery(orderId), staleTime: 0 })
              setReviewRequired(true)
            } catch {
              setReviewRequired(true)
              setError('ข้อมูลเปลี่ยนแล้วและโหลดสถานะล่าสุดไม่ได้ กรุณารีเฟรชก่อนดำเนินการต่อ')
            }
          }
        }
        return undefined
      }
    } finally {
      pendingRef.current = false
      setIsPending(false)
    }
  }, [identity, orderId, queryClient, staffId])

  const submit = useCallback((command: OrderCommand): Promise<OrderDetail | undefined> => {
    if (pendingRef.current) return Promise.resolve(undefined)
    if (reviewRequired) {
      setError('ตรวจสอบสถานะคำสั่งซื้อปัจจุบันก่อนเริ่มคำสั่งใหม่')
      return Promise.resolve(undefined)
    }
    if (attemptRef.current?.identity !== identity) {
      const recovered = readOrderAttempt(staffId, orderId)
      attemptRef.current = { identity, attempt: recovered }
      setUncertain(Boolean(recovered))
    }
    if (attemptRef.current?.attempt) {
      setError('คำสั่งก่อนหน้ายังรอการยืนยัน กรุณาส่งคำขอเดิมซ้ำก่อน')
      setUncertain(true)
      return Promise.resolve(undefined)
    }
    const attempt: OrderAttempt = { staffId, orderId, command: structuredClone(command), key: crypto.randomUUID() }
    const persisted = saveOrderAttempt(attempt)
    setStorageAvailable(persisted)
    attemptRef.current = { identity, attempt }
    return run(attempt)
  }, [identity, orderId, reviewRequired, run, staffId])

  const retry = useCallback((): Promise<OrderDetail | undefined> => {
    const attempt = attemptRef.current?.attempt
    if (!attempt || pendingRef.current) return Promise.resolve(undefined)
    return run(attempt)
  }, [run])

  const acknowledgeReview = useCallback(() => { setReviewRequired(false); setError(null) }, [])

  return { submit, retry, isPending, uncertain, error, result, storageAvailable, reviewRequired, acknowledgeReview, pendingCommand: uncertain ? attemptRef.current?.attempt?.command.kind ?? null : null }
}
