import { describe, expect, it } from 'vitest';

import * as core from '../src/index.js';
import * as livewire from '../src/livewire.js';
import * as preact from '../src/preact.js';
import * as solid from '../src/solid.js';

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
        expect(typeof solid.createWireField).toBe('function');
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
