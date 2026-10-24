import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Deterministic unit/component tests never fetch live Elexon or use live results.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Outbound network forbidden in frontend unit tests'))))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
