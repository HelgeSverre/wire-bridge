import { describe, expect, it } from 'vitest';

import * as core from '../src/index.js';
import * as livewire from '../src/livewire.js';
import * as preact from '../src/preact.js';
import * as react from '../src/react.js';
import * as solid from '../src/solid.js';
import * as svelte from '../src/svelte.js';
import * as vue from '../src/vue.js';

describe('package entry points', () => {
    it('core exposes the bridge factory, errors and path/value helpers', () => {
        expect(typeof core.createWireBridge).toBe('function');
        expect(typeof core.WireBridgeError).toBe('function');
        expect(typeof core.WireBridgePathError).toBe('function');
        expect(typeof core.WireBridgeValueError).toBe('function');
        expect(typeof core.WireBridgeDisposedError).toBe('function');
        expect(typeof core.WireBridgeCompatibilityError).toBe('function');
        expect(typeof core.parsePath).toBe('function');
        expect(typeof core.copyJsonValue).toBe('function');
        expect(typeof core.structurallyEqual).toBe('function');
    });

    it('core does not leak the Livewire/DOM integration', () => {
        expect(core.createBridgeRegistry).toBeUndefined();
        expect(core.createFrontendDirective).toBeUndefined();
    });

    it('livewire entry exposes the registry and directive factories', () => {
        expect(typeof livewire.createBridgeRegistry).toBe('function');
        expect(typeof livewire.createFrontendDirective).toBe('function');
    });

    it('adapter entries expose their hooks', () => {
        expect(typeof preact.useWireField).toBe('function');
        expect(typeof react.useWireField).toBe('function');
        expect(typeof solid.createWireField).toBe('function');
        expect(typeof svelte.wireField).toBe('function');
        expect(typeof vue.useWireField).toBe('function');
    });

    it('builds a bridge from the public entry over a $wire-shaped double', async () => {
        const state = { data: { name: 'Helge' } };
        let watcherCallback = null;

        const wire = {
            $id: 'entry-point-test',
            $get: (path) => state[path],
            $set: (path, value, live) => {
                expect(live).toBe(false);
                state[path] = value;

                return Promise.resolve();
            },
            $watch: (path, callback) => {
                watcherCallback = callback;

                return () => {
                    watcherCallback = null;
                };
            },
            $commit: () => Promise.resolve(),
            $call: () => Promise.resolve(),
        };

        const bridge = core.createWireBridge(wire, { root: 'data' });

        expect(bridge.id).toBe('entry-point-test');
        expect(bridge.field('name').getSnapshot()).toBe('Helge');
        expect(watcherCallback).toBeTypeOf('function');

        bridge.dispose();
        expect(watcherCallback).toBeNull();
    });
});

describe('svelte adapter store contract', () => {
    /**
     * The Svelte adapter is the only one carrying real logic: it has to invert
     * the subscription contract, because a Svelte store must call its
     * subscriber immediately while `binding.subscribe` never fires at subscribe
     * time.
     */
    function createHarness() {
        /** @type {Record<string, any>} */
        const state = { data: { name: 'Helge' } };

        /** @type {(() => void) | null} */
        let watcherCallback = null;

        const wire = {
            $id: 'svelte-store-test',
            $get: (/** @type {string} */ path) => state[path],
            $set: (/** @type {string} */ path, /** @type {unknown} */ value) => {
                // Livewire writes dotted paths into its own local state; the
                // bridge calls $set('data.name', ...), not $set('data', ...).
                const segments = path.split('.');
                const last = segments.pop();
                let target = state;

                for (const segment of segments) {
                    target = target[segment];
                }

                target[String(last)] = value;

                return Promise.resolve();
            },
            $watch: (/** @type {string} */ _path, /** @type {() => void} */ callback) => {
                watcherCallback = callback;

                return () => {
                    watcherCallback = null;
                };
            },
            $commit: () => Promise.resolve(),
            $call: () => Promise.resolve(),
        };

        const bridge = core.createWireBridge(wire, { root: 'data' });

        return {
            bridge,
            /** @param {unknown} value */
            pushFromServer(value) {
                state.data = { name: value };
                watcherCallback?.();
            },
        };
    }

    it('calls the subscriber immediately with the current value', () => {
        const { bridge } = createHarness();
        const store = svelte.wireField(bridge, 'name');

        /** @type {unknown[]} */
        const seen = [];
        store.subscribe((value) => seen.push(value));

        expect(seen).toEqual(['Helge']);

        bridge.dispose();
    });

    it('re-runs the subscriber when Livewire changes the value', () => {
        const { bridge, pushFromServer } = createHarness();
        const store = svelte.wireField(bridge, 'name');

        /** @type {unknown[]} */
        const seen = [];
        store.subscribe((value) => seen.push(value));

        pushFromServer('Ada');

        expect(seen).toEqual(['Helge', 'Ada']);

        bridge.dispose();
    });

    it('stops re-running after the returned unsubscribe is called', () => {
        const { bridge, pushFromServer } = createHarness();
        const store = svelte.wireField(bridge, 'name');

        /** @type {unknown[]} */
        const seen = [];
        const unsubscribe = store.subscribe((value) => seen.push(value));

        unsubscribe();
        pushFromServer('Ada');

        expect(seen).toEqual(['Helge']);

        bridge.dispose();
    });

    it('writes through binding.set without a Livewire round trip', async () => {
        const { bridge } = createHarness();
        const store = svelte.wireField(bridge, 'name');

        /** @type {unknown[]} */
        const seen = [];
        store.subscribe((value) => seen.push(value));

        await store.set('Ada');

        expect(seen).toEqual(['Helge', 'Ada']);

        bridge.dispose();
    });

    it('rejects a non-function subscriber', () => {
        const { bridge } = createHarness();
        const store = svelte.wireField(bridge, 'name');

        // @ts-expect-error deliberate misuse
        expect(() => store.subscribe('nope')).toThrow(TypeError);

        bridge.dispose();
    });
});
