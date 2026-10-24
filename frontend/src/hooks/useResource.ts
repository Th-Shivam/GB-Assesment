import { useEffect, useState } from 'react'

type State<T> =
  | { key: string; status: 'loading' }
  | { key: string; status: 'success'; data: T }
  | { key: string; status: 'error'; error: Error }

export function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${key}:${attempt}`
  const [state, setState] = useState<State<T>>({ key: requestKey, status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ key: requestKey, status: 'success', data }) },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({
          key: requestKey, status: 'error',
          error: error instanceof Error ? error : new Error('The request failed.'),
        })
      },
    )
    return () => controller.abort()
  }, [requestKey, load])

  // Never display old-policy values under new controls, even for one render.
  const visible: State<T> = state.key === requestKey ? state : { key: requestKey, status: 'loading' }
  return { ...visible, retry: () => setAttempt((value) => value + 1) }
}
