/* eslint-disable no-console */

const REACT_PASSIVE_EFFECT_PATTERNS = [
  'commitPassiveMountOnFiber',
  'recursivelyTraversePassiveMountEffects',
  'flushPassiveEffects',
  'reconnectPassiveEffects',
  'recursivelyTraverseReconnectPassiveEffects',
  'doubleInvokeEffectsOnFiber',
  'recursivelyTraverseAndDoubleInvokeEffectsInDEV',
]

const CLOUDFLARE_DEV_NOISE_PATTERNS = [
  // More specific patterns to avoid suppressing legitimate fetch errors
  'undici/index.js',
  'miniflare/dist/src/index.js',
  'ProxyClientBridge.dispatchFetch',
  '@cloudflare/vite-plugin/dist/index.js',
  // Only suppress "fetch failed" if it's in the Cloudflare/Miniflare context
  /fetch failed[\s\S]*miniflare|fetch failed[\s\S]*@cloudflare\/vite-plugin|fetch failed[\s\S]*ProxyClientBridge/,
]

export function silenceReactDevNoise() {
  if (process.env.NODE_ENV !== 'development') return

  const originalError = console.error
  const originalWarn = console.warn
  const originalLog = console.log

  function shouldSuppress(args: unknown[]): boolean {
    return args.some(arg => {
      // Check string arguments for React patterns
      if (typeof arg === 'string') {
        if (REACT_PASSIVE_EFFECT_PATTERNS.some(pattern => arg.includes(pattern))) {
          return true
        }
        // Check for Cloudflare/Miniflare dev noise (handle both string and regex patterns)
        if (CLOUDFLARE_DEV_NOISE_PATTERNS.some(pattern => {
          if (typeof pattern === 'string') {
            return arg.includes(pattern)
          }
          if (pattern instanceof RegExp) {
            return pattern.test(arg)
          }
          return false
        })) {
          return true
        }
      }

      // Check error objects for stack traces and messages
      if (arg instanceof Error) {
        // Combine stack, message, and string representation for comprehensive checking
        const errorText = [arg.stack, arg.message, String(arg)].filter(Boolean).join('\n')
        if (REACT_PASSIVE_EFFECT_PATTERNS.some(pattern => errorText.includes(pattern))) {
          return true
        }
        // Check for Cloudflare/Miniflare dev noise in error stacks/messages
        if (CLOUDFLARE_DEV_NOISE_PATTERNS.some(pattern => {
          if (typeof pattern === 'string') {
            return errorText.includes(pattern)
          }
          if (pattern instanceof RegExp) {
            return pattern.test(errorText)
          }
          return false
        })) {
          return true
        }
      }

      // Check objects with stack property
      if (arg && typeof arg === 'object' && 'stack' in arg) {
        const stack = String((arg as any).stack)
        if (REACT_PASSIVE_EFFECT_PATTERNS.some(pattern => stack.includes(pattern))) {
          return true
        }
        // Check for Cloudflare/Miniflare dev noise
        if (CLOUDFLARE_DEV_NOISE_PATTERNS.some(pattern => {
          if (typeof pattern === 'string') {
            return stack.includes(pattern)
          }
          if (pattern instanceof RegExp) {
            return pattern.test(stack)
          }
          return false
        })) {
          return true
        }
      }

      // Check JSON stringified content (guarded, for objects/arrays)
      if (arg && typeof arg === 'object') {
        try {
          const jsonStr = JSON.stringify(arg)
          // Only check if stringified result is reasonable size (avoid huge objects)
          if (jsonStr.length < 10000) {
            if (REACT_PASSIVE_EFFECT_PATTERNS.some(pattern => jsonStr.includes(pattern))) {
              return true
            }
            // Check for Cloudflare/Miniflare dev noise
            if (CLOUDFLARE_DEV_NOISE_PATTERNS.some(pattern => {
              if (typeof pattern === 'string') {
                return jsonStr.includes(pattern)
              }
              if (pattern instanceof RegExp) {
                return pattern.test(jsonStr)
              }
              return false
            })) {
              return true
            }
          }
        } catch {
          // Ignore JSON.stringify errors (circular refs, etc.)
        }
      }

      return false
    })
  }

  console.error = (...args: unknown[]) => {
    if (shouldSuppress(args)) return
    originalError(...args)
  }

  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(args)) return
    originalWarn(...args)
  }

  console.log = (...args: unknown[]) => {
    if (shouldSuppress(args)) return
    originalLog(...args)
  }
}
