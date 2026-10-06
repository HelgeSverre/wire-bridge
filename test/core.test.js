import { describe, expect, it, vi } from 'vitest';

import { createWireBridge, DEBUG_STATE } from '../src/core.js';
import {
    WireBridgeCompatibilityError,
    WireBridgeDisposedError,
    WireBridgePathError,
    WireBridgeValueError,
} from '../src/json.js';

function defaultData() {
    return {
        name: 'Helge',
        country: 'NO',
        isPep: false,
        address: { city: 'Bergen', postalCode: '5000' },
        owners: [{ id: 'owner-1', name: 'Helge', share: 100 }],
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function splitPath(path) {
    return path === '' ? [] : path.split('.');
}

function readPath(root, path) {
    let current = root;

    for (const segment of splitPath(path)) {
        if (current === null || typeof current !== 'object') {
            return undefined;
        }

        current = current[segment];
    }

    return current;
}

function writePath(root, path, value) {
    const segments = splitPath(path);

    if (segments.length === 0) {
        return;
    }

    let current = root;

    for (let index = 0; index < segments.length - 1; index++) {
        const segment = segments[index];

        if (current[segment] === undefined) {
            current[segment] = {};
        }

        current = current[segment];
    }

    current[segments[segments.length - 1]] = value;
}

/**
 * A test double for Livewire's $wire with an explicit microtask notification
 * queue. It is deliberately dumb: no dependency tracking, no network.
 */
function createFakeWire({ data = defaultData(), watchReturnsDisposer = true } = {}) {
    const state = { data: clone(data) };

    const watchers = new Set();
    const queue = [];
    const calls = { commits: 0, calls: [] };
    const writes = [];
    const responseOverrides = new Map();

    let watcherId = 0;

    function enqueueWatchers(path) {
        for (const watcher of watchers) {
            const pathsOverlap = watcher.path === path
                || path.startsWith(`${watcher.path}.`)
                || watcher.path.startsWith(`${path}.`);

            if (pathsOverlap && !queue.includes(watcher)) {
                queue.push(watcher);
            }
        }

        if (queue.length > 0) {
            queueMicrotask(flush);
        }
    }

    function flush() {
        while (queue.length > 0) {
            const watcher = queue.shift();

            if (watcher !== undefined && watcher.active) {
                watcher.callback(readPath(state, watcher.path));
            }
        }
    }

    const wire = {
        $id: 'fake-component-1',

        $get(path) {
            return readPath(state, path);
        },

        $set(path, value, live = true) {
            writes.push({ path, value, live });
            writePath(state, path, value);

            // Livewire schedules watcher effects asynchronously.
            enqueueWatchers(path);

            if (live) {
                return wire.$commit();
            }

            return Promise.resolve();
        },

        $watch(path, callback) {
            if (!watchReturnsDisposer) {
                // Simulates a Livewire 3 style watcher with no disposer.
                const id = watcherId++;
                watchers.add({ id, path, callback, active: true });

                return undefined;
            }

            const watcher = { id: watcherId++, path, callback, active: true };
            watchers.add(watcher);

            return () => {
                watcher.active = false;
                watchers.delete(watcher);
            };
        },

        $commit() {
            calls.commits++;

            return responseOverrides.has('$commit')
                ? responseOverrides.get('$commit')
                : Promise.resolve({ committed: true });
        },

        $call(method, ...args) {
            calls.calls.push({ method, args });

            return responseOverrides.has(method)
                ? responseOverrides.get(method)
                : Promise.resolve({ method, args });
        },
    };

    return {
        wire,
        calls,
        writes,
        state,

        /** Simulate a server-side merge without a local write. */
        mutate(path, value) {
            writePath(state, path, value);
            enqueueWatchers(path);
        },

        /** Simulate PHP replacing the whole root. */
        replaceRoot(path, value) {
            state[path] = value;
            enqueueWatchers(path);
        },

        failNext(key, error) {
            responseOverrides.set(key, Promise.reject(error));
        },

        resolveWith(key, value) {
            responseOverrides.set(key, Promise.resolve(value));
        },

        flush,
        watcherCount: () => watchers.size,
        queuedCount: () => queue.length,
    };
}

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createWireBridge', () => {
    it('exposes the component id, root and the original $wire escape hatch', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        expect(bridge.id).toBe('fake-component-1');
        expect(bridge.root).toBe('data');
        expect(bridge.wire).toBe(fake.wire);
    });

    it('registers exactly one root watcher and verifies the disposer', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        expect(fake.watcherCount()).toBe(1);

        bridge.dispose();

        expect(fake.watcherCount()).toBe(0);
    });

    it('disposes the root watcher when initial snapshot capture fails', () => {
        const disposeWatcher = vi.fn();
        const wire = {
            $get: () => undefined,
            $set: () => {},
            $watch: () => disposeWatcher,
            $commit: () => {},
            $call: () => {},
        };

        expect(() => createWireBridge(wire, { root: 'data' })).toThrow(WireBridgeValueError);
        expect(disposeWatcher).toHaveBeenCalledOnce();
    });

    it('throws a visible compatibility error when $watch returns no disposer', () => {
        const fake = createFakeWire({ watchReturnsDisposer: false });

        expect(() => createWireBridge(fake.wire, { root: 'data' })).toThrow(WireBridgeCompatibilityError);
    });

    it('throws when $wire is missing bridge APIs', () => {
        expect(() => createWireBridge({}, { root: 'data' })).toThrow(WireBridgeCompatibilityError);
    });

    it('requires a root property path', () => {
        const fake = createFakeWire();

        expect(() => createWireBridge(fake.wire, {})).toThrow(WireBridgeCompatibilityError);
        expect(() => createWireBridge(fake.wire, { root: '' })).toThrow(WireBridgeCompatibilityError);
    });

    it('captures a frozen initial snapshot and returns it without allocating', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const snapshot = bridge.getSnapshot();

        expect(snapshot).toEqual(defaultData());
        expect(bridge.getSnapshot()).toBe(snapshot);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.address)).toBe(true);
        expect(Object.isFrozen(snapshot.owners[0])).toBe(true);
    });
});

describe('field bindings', () => {
    it('returns a stable cached binding per path', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        expect(bridge.field('name')).toBe(bridge.field('name'));
        expect(bridge.field('name')).not.toBe(bridge.field('country'));
    });

    it('reads scalar, nested, array-index and root paths', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        expect(bridge.field('name').getSnapshot()).toBe('Helge');
        expect(bridge.field('address.city').getSnapshot()).toBe('Bergen');
        expect(bridge.field('owners.0.name').getSnapshot()).toBe('Helge');
        expect(bridge.field('owners').getSnapshot()).toEqual([{ id: 'owner-1', name: 'Helge', share: 100 }]);
        expect(bridge.field('').getSnapshot()).toBe(bridge.getSnapshot());
        expect(bridge.field('missing').getSnapshot()).toBeUndefined();
    });

    it('rejects malformed and unsafe paths', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        for (const path of ['__proto__', 'address.__proto__.x', 'constructor', 'prototype', 'a..b', '.name', 'name.', 'a[0]', 'address.city-name', 42]) {
            expect(() => bridge.field(path), String(path)).toThrow(WireBridgePathError);
        }
    });
});

describe('local writes', () => {
    it('writes through $set(path, value, false) and never requests', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        await bridge.field('name').set('Ada');

        expect(fake.writes).toEqual([{ path: 'data.name', value: 'Ada', live: false }]);
        expect(fake.calls.commits).toBe(0);
        expect(fake.calls.calls).toHaveLength(0);
        expect(bridge.field('name').getSnapshot()).toBe('Ada');
    });

    it('writes nested paths and whole arrays', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        await bridge.field('address.city').set('Oslo');
        await bridge.field('owners').set([{ id: 'owner-9', name: 'Kari', share: 50 }]);

        expect(fake.writes.map((write) => write.path)).toEqual(['data.address.city', 'data.owners']);
        expect(bridge.field('address.city').getSnapshot()).toBe('Oslo');
        expect(bridge.field('owners.0.id').getSnapshot()).toBe('owner-9');
    });

    it('can replace the whole root through field("")', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const replacement = { ...defaultData(), name: 'Ada' };
        await bridge.field('').set(replacement);

        expect(fake.writes[0].path).toBe('data');
        expect(bridge.getSnapshot()).toEqual(replacement);
    });

    it('copies caller-owned values so later mutation cannot reach Livewire', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const owners = [{ id: 'owner-2', name: 'Kari', share: 60 }];
        await bridge.field('owners').set(owners);

        owners[0].name = 'MUTATED';
        owners.push({ id: 'owner-3', name: 'Ola', share: 30 });

        expect(bridge.field('owners.0.name').getSnapshot()).toBe('Kari');
        expect(bridge.field('owners').getSnapshot()).toHaveLength(1);
    });

    it('rejects writes to missing descendant paths without calling $set', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        expect(() => bridge.field('missing.field').set('x')).toThrow(WireBridgeValueError);
        expect(() => bridge.field('owners.5.name').set('x')).toThrow(WireBridgeValueError);
        expect(() => bridge.field('address.unknown').set('x')).toThrow(WireBridgeValueError);
        expect(fake.writes).toHaveLength(0);
    });

    it('rejects values that cannot survive JSON without losing meaning', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const cyclic = {};
        cyclic.self = cyclic;

        const invalidValues = [
            { member: undefined },
            [undefined],
            () => {},
            Symbol('s'),
            10n,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            new Date(),
            new Map(),
            cyclic,
        ];

        for (const value of invalidValues) {
            expect(() => bridge.field('name').set(value), String(value)).toThrow(WireBridgeValueError);
        }

        expect(fake.writes).toHaveLength(0);
    });

    it('accepts null, booleans, finite numbers, strings, arrays and plain objects', () => {
        const fake = createFakeWire({ data: { value: 1 } });
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        expect(() => bridge.field('value').set(null)).not.toThrow();
        expect(() => bridge.field('value').set(true)).not.toThrow();
        expect(() => bridge.field('value').set(-2.5)).not.toThrow();
        expect(() => bridge.field('value').set('text')).not.toThrow();
        expect(() => bridge.field('value').set([1, { a: null }])).not.toThrow();
        expect(() => bridge.field('value').set({ a: { b: false } })).not.toThrow();
    });

    it('propagates a rejected $set promise and still refreshes the cache', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const original = fake.wire.$set;
        fake.wire.$set = (path, value, live) => {
            original(path, value, live);

            return Promise.reject(new Error('network'));
        };

        await expect(bridge.field('name').set('Ada')).rejects.toThrow('network');
        // The local mutation happened synchronously, so the cache reflects it.
        expect(bridge.field('name').getSnapshot()).toBe('Ada');

        fake.wire.$set = original;
    });
});

describe('snapshot and notification semantics', () => {
    it('does not invoke subscribers at subscribe time', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });
        const listener = vi.fn();

        bridge.field('name').subscribe(listener);

        expect(listener).not.toHaveBeenCalled();
    });

    it('notifies only field subscribers whose value changed', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const nameListener = vi.fn();
        const countryListener = vi.fn();

        bridge.field('name').subscribe(nameListener);
        bridge.field('country').subscribe(countryListener);

        await bridge.field('name').set('Ada');
        await tick();

        expect(nameListener).toHaveBeenCalledTimes(1);
        expect(countryListener).not.toHaveBeenCalled();
    });

    it('does not emit when a structurally equal value is written', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        bridge.field('name').subscribe(listener);

        const before = bridge.getSnapshot();

        await bridge.field('name').set('Helge');
        await tick();

        expect(listener).not.toHaveBeenCalled();
        expect(bridge.getSnapshot()).toBe(before);
    });

    it('ignores object key ordering when comparing values', async () => {
        const fake = createFakeWire({
            data: { nested: { a: 1, b: 2 } },
        });
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        bridge.subscribe(listener);

        const before = bridge.getSnapshot();

        await bridge.field('nested').set({ b: 2, a: 1 });
        await tick();

        expect(listener).not.toHaveBeenCalled();
        expect(bridge.getSnapshot()).toBe(before);
    });

    it('preserves snapshot identity for unchanged fields (structural sharing)', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const addressBefore = bridge.field('address').getSnapshot();
        const ownersBefore = bridge.field('owners').getSnapshot();

        await bridge.field('name').set('Ada');
        await tick();

        expect(bridge.field('address').getSnapshot()).toBe(addressBefore);
        expect(bridge.field('owners').getSnapshot()).toBe(ownersBefore);
    });

    it('publishes new immutable snapshots for changed subtrees', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const addressBefore = bridge.field('address').getSnapshot();

        await bridge.field('address.city').set('Oslo');
        await tick();

        const addressAfter = bridge.field('address').getSnapshot();

        expect(addressAfter).not.toBe(addressBefore);
        expect(addressAfter).toEqual({ city: 'Oslo', postalCode: '5000' });
        expect(Object.isFrozen(addressAfter)).toBe(true);
    });

    it('observes server-side merges and root replacement', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        bridge.field('name').subscribe(listener);

        fake.mutate('data.name', 'Server');
        await tick();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(bridge.field('name').getSnapshot()).toBe('Server');

        fake.replaceRoot('data', { ...defaultData(), name: 'Replaced' });
        await tick();

        expect(bridge.field('name').getSnapshot()).toBe('Replaced');
    });

    it('rejects invalid server-side values before structural comparison', () => {
        const fake = createFakeWire({ data: {} });
        createWireBridge(fake.wire, { root: 'data' });

        // Date and an empty plain object both have no enumerable keys, but a
        // Date is not a JSON-compatible bridge snapshot.
        fake.mutate('data', new Date());

        expect(() => fake.flush()).toThrow(WireBridgeValueError);
    });

    it('keeps existing subscriptions working after root replacement', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        bridge.field('country').subscribe(listener);

        fake.replaceRoot('data', { ...defaultData(), country: 'SE' });
        await tick();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(bridge.field('country').getSnapshot()).toBe('SE');

        await bridge.field('country').set('DK');
        await tick();

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('isolates throwing listeners and reports them', async () => {
        const errors = [];
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, {
            root: 'data',
            onListenerError: (error, context) => errors.push({ error, context }),
        });

        const second = vi.fn();

        bridge.field('name').subscribe(() => {
            throw new Error('listener boom');
        });
        bridge.field('name').subscribe(second);

        await bridge.field('name').set('Ada');
        await tick();

        expect(second).toHaveBeenCalledTimes(1);
        expect(errors).toHaveLength(1);
        expect(errors[0].error.message).toBe('listener boom');
    });

    it('is safe to unsubscribe during notification', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const second = vi.fn();
        const firstBinding = bridge.field('name');
        const unsubscribeSecond = firstBinding.subscribe(second);

        firstBinding.subscribe(() => {
            unsubscribeSecond();
        });

        await firstBinding.set('Ada');
        await tick();

        // Notifications run from a stable copy, so the current pass still
        // reaches every listener that was registered when it started...
        expect(second).toHaveBeenCalledTimes(1);

        // ...but the removed listener is gone for later notifications.
        await firstBinding.set('Grace');
        await tick();

        expect(second).toHaveBeenCalledTimes(1);
    });

    it('makes unsubscribe idempotent', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        const unsubscribe = bridge.field('name').subscribe(listener);

        unsubscribe();
        unsubscribe();

        await bridge.field('name').set('Ada');
        await tick();

        expect(listener).not.toHaveBeenCalled();
    });

    it('updates all caches before notifying any listener', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const observed = [];

        bridge.field('address.city').subscribe(() => {
            observed.push(bridge.field('address.postalCode').getSnapshot());
        });
        bridge.field('address').subscribe(() => {
            observed.push(bridge.field('address.city').getSnapshot());
        });

        await bridge.field('address').set({ city: 'Oslo', postalCode: '0001' });
        await tick();

        expect(observed).toEqual(['0001', 'Oslo']);
    });
});

describe('commit and call', () => {
    it('commit calls $commit once, preserves the result and refreshes', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        fake.resolveWith('$commit', { committed: 'yes' });
        fake.mutate('data.name', 'FromServer');

        await expect(bridge.commit()).resolves.toEqual({ committed: 'yes' });

        expect(fake.calls.commits).toBe(1);
        expect(bridge.field('name').getSnapshot()).toBe('FromServer');
    });

    it('call forwards the method and args, preserves the result and refreshes', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        fake.resolveWith('normalize', { normalized: true });
        fake.mutate('data.name', 'Trimmed');

        await expect(bridge.call('normalize', 1, 'x')).resolves.toEqual({ normalized: true });

        expect(fake.calls.calls).toEqual([{ method: 'normalize', args: [1, 'x'] }]);
        expect(bridge.field('name').getSnapshot()).toBe('Trimmed');
    });

    it('rethrows rejection and still refreshes the cache', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        fake.failNext('save', new Error('server exploded'));
        fake.mutate('data.name', 'Partial');

        await expect(bridge.call('save')).rejects.toThrow('server exploded');
        expect(bridge.field('name').getSnapshot()).toBe('Partial');
    });

    it('never writes a server snapshot back into $wire', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        fake.mutate('data.name', 'FromServer');
        await tick();
        await bridge.commit();
        await bridge.call('normalize');

        expect(fake.writes).toHaveLength(0);
    });
});

describe('disposal', () => {
    it('stops the watcher, clears listeners and releases bindings', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        bridge.field('name').subscribe(listener);

        bridge.dispose();

        expect(fake.watcherCount()).toBe(0);

        fake.mutate('data.name', 'Later');
        await tick();

        expect(listener).not.toHaveBeenCalled();
    });

    it('is idempotent and keeps already-issued unsubscribes safe', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const unsubscribe = bridge.field('name').subscribe(() => {});
        const unsubscribeRoot = bridge.subscribe(() => {});

        bridge.dispose();
        bridge.dispose();

        expect(() => unsubscribe()).not.toThrow();
        expect(() => unsubscribeRoot()).not.toThrow();
    });

    it('throws a clear disposed error for every bridge operation', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const binding = bridge.field('name');
        bridge.dispose();

        expect(() => bridge.getSnapshot()).toThrow(WireBridgeDisposedError);
        expect(() => bridge.subscribe(() => {})).toThrow(WireBridgeDisposedError);
        expect(() => bridge.field('name')).toThrow(WireBridgeDisposedError);
        expect(() => bridge.commit()).toThrow(WireBridgeDisposedError);
        expect(() => bridge.call('normalize')).toThrow(WireBridgeDisposedError);
        expect(() => binding.getSnapshot()).toThrow(WireBridgeDisposedError);
        expect(() => binding.subscribe(() => {})).toThrow(WireBridgeDisposedError);
        expect(() => binding.set('x')).toThrow(WireBridgeDisposedError);
    });

    it('silences callbacks queued before disposal', async () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });

        const listener = vi.fn();
        bridge.field('name').subscribe(listener);

        fake.mutate('data.name', 'Queued');
        bridge.dispose();

        await tick();

        expect(listener).not.toHaveBeenCalled();
        expect(fake.queuedCount()).toBe(0);
    });

    it('exposes debug state only as instrumentation', () => {
        const fake = createFakeWire();
        const bridge = createWireBridge(fake.wire, { root: 'data' });
        const binding = bridge.field('name');
        binding.subscribe(() => {});

        const debug = bridge[DEBUG_STATE]();

        expect(debug.root).toBe('data');
        expect(debug.watcherActive).toBe(true);
        expect(debug.fieldCount).toBe(1);
        expect(debug.fieldSubscribers).toBe(1);
        expect(debug.rootSubscribers).toBe(0);
        expect(debug.disposed).toBe(false);
    });
});
