/**
 * Preact adapter.
 *
 * `useSyncExternalStore` provides the read-before-subscribe lifecycle and
 * closes the subscription race. Binding methods are stable closures without a
 * `this` receiver, so they can be passed to hooks directly.
 *
 * @module wire-bridge/preact/use-wire-field
 */

import { useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';

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
