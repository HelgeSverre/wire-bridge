/**
 * Svelte adapter.
 *
 * A Svelte store is duck-typed, so this adapter imports nothing from Svelte and
 * has no peer dependency. The returned object works with `$store` auto-
 * subscription in any Svelte version.
 *
 * The one thing worth knowing: the two subscription contracts are inverted.
 * A Svelte store MUST call its subscriber immediately with the current value;
 * `binding.subscribe` deliberately never fires at subscribe time. Calling
 * `run()` before delegating reconciles the two and closes the race in one step.
 *
 * The subscription direction stays explicit: external changes call `run`, user
 * handlers call `set()`. There is deliberately no path that writes the store
 * back into Livewire on notification, which would create an echo loop.
 *
 * @module wire-bridge/svelte/wire-field
 */

/**
 * @param {import('./core.js').WireBridge} bridge
 * @param {string} path field path relative to the bridge root
 * @returns {{
 *   subscribe: (run: (value: unknown) => void) => (() => void),
 *   set: (nextValue: unknown) => Promise<void>,
 * }}
 */
export function wireField(bridge, path) {
    const binding = bridge.field(path);

    return {
        subscribe(run) {
            if (typeof run !== 'function') {
                throw new TypeError('wireField(...).subscribe(run) expects a function');
            }

            run(binding.getSnapshot());

            return binding.subscribe(() => run(binding.getSnapshot()));
        },

        set: binding.set,
    };
}
