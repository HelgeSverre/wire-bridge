/**
 * Solid adapter.
 *
 * The subscription direction stays explicit: external changes update the
 * signal, user handlers call `binding.set()`. There is deliberately no effect
 * that writes the signal back into Livewire, which would create an echo loop.
 *
 * @module wire-bridge/solid/create-wire-field
 */

import { createSignal, onCleanup } from 'solid-js';

/**
 * Must be called inside an active Solid owner. The bridge and path are fixed
 * for the binding's lifetime; remount to change them.
 *
 * @param {import('./core.js').WireBridge} bridge
 * @param {string} path field path relative to the bridge root
 * @returns {[() => unknown, (nextValue: unknown) => Promise<void>]}
 */
export function createWireField(bridge, path) {
    const binding = bridge.field(path);

    const [value, setValue] = createSignal(binding.getSnapshot());

    const sync = () => setValue(() => binding.getSnapshot());

    const unsubscribe = binding.subscribe(sync);

    // Close any initialization/subscription gap.
    sync();

    onCleanup(unsubscribe);

    return [value, binding.set];
}
