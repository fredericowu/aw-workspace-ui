import { initialize } from 'launchdarkly-js-client-sdk'
import Observability from '@launchdarkly/observability'
import SessionReplay from '@launchdarkly/session-replay'

let _client = null

export function initLaunchDarkly(clientKey) {
  if (!clientKey || typeof window === 'undefined') return null
  const context = { kind: 'user', anonymous: true }
  _client = initialize(clientKey, context, {
    plugins: [new Observability(), new SessionReplay()],
  })
  return _client
}

export function getLDClient() {
  return _client
}
