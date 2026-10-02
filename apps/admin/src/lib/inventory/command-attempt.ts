export type CommandAttemptState = 'idle' | 'prepared' | 'uncertain'

export type CommandAttemptSnapshot<T> = {
  state: CommandAttemptState
  command: string | null
  key: string | null
  payload: T | null
}

type PreparedCommand<T> = {
  command: string
  key: string
  payload: T
  identity: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]))
  }
  return value
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(freezeDeep)
  }
  return value
}

function clonePayload<T>(payload: T): T {
  return freezeDeep(structuredClone(payload))
}

function identity(command: string, payload: unknown): string {
  return `${command}\n${JSON.stringify(canonicalize(payload))}`
}

export function createCommandAttempt<T>() {
  let state: CommandAttemptState = 'idle'
  let prepared: PreparedCommand<T> | null = null

  function snapshot(): CommandAttemptSnapshot<T> {
    return {
      state,
      command: prepared?.command ?? null,
      key: prepared?.key ?? null,
      payload: prepared?.payload ?? null,
    }
  }

  return {
    prepare(command: string, payload: T): { key: string; payload: T } {
      const payloadIdentity = identity(command, payload)
      if (prepared) {
        if (prepared.identity !== payloadIdentity) throw new Error('UNRESOLVED_COMMAND')
        return { key: prepared.key, payload: prepared.payload }
      }

      prepared = {
        command,
        key: crypto.randomUUID(),
        payload: clonePayload(payload),
        identity: payloadIdentity,
      }
      state = 'prepared'
      return { key: prepared.key, payload: prepared.payload }
    },
    markUncertain() {
      if (prepared) state = 'uncertain'
    },
    complete() {
      prepared = null
      state = 'idle'
    },
    reject() {
      prepared = null
      state = 'idle'
    },
    snapshot,
  }
}
