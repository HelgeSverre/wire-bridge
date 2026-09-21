/**
 * Vue adapter.
 *
 * `shallowRef` is deliberate: snapshots are deep-frozen, and handing a frozen
 * object to `ref()`/`reactive()` builds a deep proxy over values that can never
 * be written through. The shallow ref holds the snapshot as one opaque value
 * and replaces it wholesale, which is exactly the bridge's update granularity.
 *
 * The subscription direction stays explicit: external changes update the ref,
 * user handlers call `binding.set()`. There is deliberately no watcher that
 * writes the ref back into Livewire, which would create an echo loop.
 *
 * @module wire-bridge/vue/use-wire-field
 */

import { onScopeDispose, shallowRef } from 'vue';

/**
 * Must be called inside an active effect scope (a `setup()` body or an explicit
 * `effectScope`). The bridge and path are fixed for the binding's lifetime;
 * remount to change them.
 *
 * @param {import('./core.js').WireBridge} bridge
 * @param {string} path field path relative to the bridge root
 * @returns {[import('vue').ShallowRef<unknown>, (nextValue: unknown) => Promise<void>]}
 */
export function useWireField(bridge, path) {
    const binding = bridge.field(path);

    const value = shallowRef(binding.getSnapshot());

    const sync = () => {
        value.value = binding.getSnapshot();
    };

    const unsubscribe = binding.subscribe(sync);

    // Close any initialization/subscription gap.
    sync();

    onScopeDispose(unsubscribe);

    return [value, binding.set];
}
