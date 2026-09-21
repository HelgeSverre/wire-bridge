/**
 * React adapter.
 *
 * `useSyncExternalStore` provides the read-before-subscribe lifecycle and
 * closes the subscription race. Binding methods are stable closures without a
 * `this` receiver, so they can be passed to hooks directly.
 *
 * This is also the adapter for React meta-frameworks: a Next, Remix or Waku
 * client component is plain React, so `'use client'` plus this hook is the
 * whole integration. Their server halves own the route and cannot live inside
 * a Livewire island.
 *
 * @module wire-bridge/react/use-wire-field
 */

import { useMemo, useSyncExternalStore } from 'react';

/**
 * @param {import('./core.js').WireBridge} bridge
 * @param {string} path field path relative to the bridge root
 * @returns {[unknown, (nextValue: unknown) => Promise<void>]}
 */
export function useWireField(bridge, path) {
    const binding = useMemo(() => bridge.field(path), [bridge, path]);

    const value = useSyncExternalStore(binding.subscribe, binding.getSnapshot);

    return [value, binding.set];
}
