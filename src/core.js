/**
 * Framework-independent bridge between one mounted Livewire component and any
 * number of frontend renderers.
 *
 * The bridge caches read-only, structurally shared projections of Livewire
 * state. Those projections are never writable state: every write goes to
 * $wire, and every published snapshot is re-read from $wire.
 *
 * @module wire-bridge/core
 */

import {
    copyJsonValue,
    deepFreeze,
    getAtPath,
    parsePath,
    structurallyEqual,
    WireBridgeCompatibilityError,
    WireBridgeDisposedError,
    WireBridgeValueError,
} from './json.js';

/**
 * Internal debug-state accessor. This is demonstration instrumentation, not
 * part of the stable bridge contract.
 *
 * @type {symbol}
 */
export const DEBUG_STATE = Symbol('wire-bridge.debug-state');

/**
 * The subset of Livewire's $wire API this bridge relies on. The installed
 * version is verified against this contract during initialization.
 *
 * @typedef {object} WireLike
 * @property {(path: string) => unknown} $get
 * @property {(path: string, value: unknown, live?: boolean) => unknown} $set
 * @property {(path: string, callback: () => void) => unknown} $watch
 * @property {() => unknown} $commit
 * @property {(method: string, ...args: unknown[]) => unknown} $call
 * @property {string} [$id]
 */

/**
 * @typedef {object} WireBridgeOptions
 * @property {string} root root property path, fixed for the bridge lifetime
 * @property {(error: unknown, context: { operation: string, path?: string }) => void} [onListenerError]
 */

/**
 * @typedef {object} FieldBinding
 * @property {string} path
 * @property {() => unknown} getSnapshot
 * @property {(listener: () => void) => (() => void)} subscribe
 * @property {(nextValue: unknown) => Promise<void>} set
 */

/**
 * @typedef {object} WireBridge
 * @property {string | null} id
 * @property {string} root
 * @property {WireLike} wire
 * @property {() => unknown} getSnapshot
 * @property {(listener: () => void) => (() => void)} subscribe
 * @property {(path: string) => FieldBinding} field
 * @property {() => Promise<unknown>} commit
 * @property {(method: string, ...args: unknown[]) => Promise<unknown>} call
 * @property {() => void} dispose
 */

/**
 * Create one bridge per mounted Livewire component and root property.
 *
 * @param {WireLike} wire Livewire's $wire object for a mounted component
 * @param {WireBridgeOptions} options
 * @returns {WireBridge}
 */
export function createWireBridge(wire, options) {
    if (wire === null || typeof wire !== 'object') {
        throw new WireBridgeCompatibilityError(
            'createWireBridge(wire, ...) expects Livewire\'s $wire object as its first argument',
        );
    }

    const root = options?.root;

    if (typeof root !== 'string' || root === '') {
        throw new WireBridgeCompatibilityError(
            'createWireBridge requires a non-empty "root" property path, for example { root: "data" }',
        );
    }

    parsePath(root);

    const wireApi = /** @type {Record<string, unknown>} */ (wire);

    const missing = ['$get', '$set', '$watch', '$commit', '$call'].filter(
        (method) => typeof wireApi[method] !== 'function',
    );

    if (missing.length > 0) {
        throw new WireBridgeCompatibilityError(
            `This Livewire $wire object is missing ${missing.join(', ')}. ` +
                'The bridge needs a Livewire 4 build whose watcher returns an unsubscribe function.',
        );
    }

    const listenerErrorHandler = typeof options.onListenerError === 'function'
        ? options.onListenerError
        : defaultListenerErrorHandler;

    /** @type {WireBridge['id']} */
    const id = typeof wire.$id === 'string' ? wire.$id : null;

    let disposed = false;
    let revision = 0;
    /** @type {unknown} */
    let snapshot;
    /** @type {(() => void) | null} */
    let watcherDisposer = null;
    let refreshing = false;
    let refreshQueued = false;

    /** @type {Set<() => void>} */
    const rootListeners = new Set();

    /**
     * @typedef {object} FieldState
     * @property {string} path
     * @property {string[]} segments
     * @property {unknown} snapshot
     * @property {Set<() => void>} listeners
     * @property {FieldBinding} binding
     */

    /** @type {Map<string, FieldState>} */
    const fieldStates = new Map();

    /**
     * @param {string} operation
     */
    function assertAlive(operation) {
        if (disposed) {
            throw new WireBridgeDisposedError(operation);
        }
    }

    function readRootFromWire() {
        return wire.$get(root);
    }

    function captureInitialSnapshot() {
        snapshot = deepFreeze(copyJsonValue(readRootFromWire(), `$wire.${root}`));
    }

    /**
     * Re-read the root from $wire, update every cache first, then notify the
     * listeners whose selected values actually changed.
     */
    function refreshFromWire() {
        if (disposed) {
            return;
        }

        if (refreshing) {
            refreshQueued = true;

            return;
        }

        refreshing = true;

        try {
            do {
                refreshQueued = false;

                const liveValue = readRootFromWire();

                if (structurallyEqual(liveValue, snapshot)) {
                    continue;
                }

                snapshot = deepFreeze(copyJsonValue(liveValue, `$wire.${root}`));
                revision++;

                /** @type {FieldState[]} */
                const changedFields = [];

                for (const state of fieldStates.values()) {
                    const selected = state.path === '' ? snapshot : getAtPath(snapshot, state.segments);

                    if (!structurallyEqual(selected, state.snapshot)) {
                        state.snapshot = selected;
                        changedFields.push(state);
                    }
                }

                for (const state of changedFields) {
                    notify([...state.listeners], `field "${state.path}"`);
                }

                notify([...rootListeners], `root "${root}"`);
            } while (refreshQueued && !disposed);
        } finally {
            refreshing = false;
        }
    }

    /**
     * @param {Array<() => void>} listeners
     * @param {string} context
     */
    function notify(listeners, context) {
        for (const listener of listeners) {
            if (disposed) {
                return;
            }

            try {
                listener();
            } catch (error) {
                listenerErrorHandler(error, { operation: 'notify', path: context });
            }
        }
    }

    /**
     * @param {unknown} error
     * @param {{ operation: string, path?: string }} context
     */
    function defaultListenerErrorHandler(error, context) {
        console.error(`[wire-bridge] listener failed during ${context.operation} (${context.path})`, error);
    }

    /**
     * @param {FieldState} state
     * @param {unknown} nextValue
     * @returns {Promise<void>}
     */
    function setFieldValue(state, nextValue) {
        assertAlive('field.set');

        const copied = copyJsonValue(nextValue, `field "${state.path}" next value`);

        if (state.path !== '') {
            const current = state.snapshot;

            if (current === undefined) {
                throw new WireBridgeValueError(
                    `Cannot write to missing field path "${state.path}"; ` +
                        'add, remove, or reorder members by replacing the containing object or array',
                );
            }
        }

        const absolutePath = state.path === '' ? root : `${root}.${state.path}`;

        let result;

        try {
            result = wire.$set(absolutePath, copied, false);
        } catch (error) {
            refreshFromWire();

            return Promise.reject(error);
        }

        // $set(path, value, false) mutates Livewire's local state
        // synchronously; publish that local edit immediately.
        refreshFromWire();

        return Promise.resolve(result).then(
            () => {
                refreshFromWire();
            },
            (error) => {
                refreshFromWire();

                throw error;
            },
        );
    }

    /**
     * Return a stable cached field binding for a path relative to the root.
     *
     * - `field('')` selects the whole root and can replace it.
     * - `field('owners')` selects the whole array.
     * - `field('owners.0.name')` uses a numeric array index, so it follows the
     *   index after reordering, not the owner's identity. Dynamic repeater
     *   identity management is out of scope; render stable `owner.id` keys.
     *
     * @param {string} path
     * @returns {FieldBinding}
     */
    function field(path) {
        assertAlive('field');

        const existing = fieldStates.get(path);

        if (existing !== undefined) {
            return existing.binding;
        }

        const segments = parsePath(path);

        /** @type {FieldState} */
        let state;

        /** @type {FieldBinding} */
        const binding = {
            path,
            getSnapshot() {
                assertAlive('getSnapshot');

                return state.snapshot;
            },
            subscribe(listener) {
                assertAlive('subscribe');

                if (typeof listener !== 'function') {
                    throw new TypeError('field.subscribe(listener) expects a function');
                }

                state.listeners.add(listener);

                return () => {
                    state.listeners.delete(listener);
                };
            },
            set: (nextValue) => setFieldValue(state, nextValue),
        };

        state = {
            path,
            segments,
            snapshot: path === '' ? snapshot : getAtPath(snapshot, segments),
            listeners: new Set(),
            binding,
        };

        fieldStates.set(path, state);

        return binding;
    }

    function getSnapshot() {
        assertAlive('getSnapshot');

        return snapshot;
    }

    /**
     * @param {() => void} listener
     * @returns {() => void}
     */
    function subscribe(listener) {
        assertAlive('subscribe');

        if (typeof listener !== 'function') {
            throw new TypeError('bridge.subscribe(listener) expects a function');
        }

        rootListeners.add(listener);

        return () => {
            rootListeners.delete(listener);
        };
    }

    function commit() {
        assertAlive('commit');

        let result;

        try {
            result = wire.$commit();
        } catch (error) {
            refreshFromWire();

            return Promise.reject(error);
        }

        return Promise.resolve(result).then(
            (value) => {
                refreshFromWire();

                return value;
            },
            (error) => {
                refreshFromWire();

                throw error;
            },
        );
    }

    /**
     * @param {string} method
     * @param {...unknown} args
     */
    function call(method, ...args) {
        assertAlive('call');

        let result;

        try {
            result = wire.$call(method, ...args);
        } catch (error) {
            refreshFromWire();

            return Promise.reject(error);
        }

        return Promise.resolve(result).then(
            (value) => {
                refreshFromWire();

                return value;
            },
            (error) => {
                refreshFromWire();

                throw error;
            },
        );
    }

    function dispose() {
        if (disposed) {
            return;
        }

        disposed = true;

        const disposer = watcherDisposer;
        watcherDisposer = null;

        if (typeof disposer === 'function') {
            try {
                disposer();
            } catch (error) {
                defaultListenerErrorHandler(error, { operation: 'dispose' });
            }
        }

        rootListeners.clear();

        for (const state of fieldStates.values()) {
            state.listeners.clear();
        }

        fieldStates.clear();
    }

    // Register the root watcher, capture its disposer, then cache the current
    // root. The watcher exists while the bridge is alive, even when no field
    // listener is attached, so a newly mounted renderer always reads the
    // latest cached value.
    const disposer = wire.$watch(root, () => {
        refreshFromWire();
    });

    if (typeof disposer !== 'function') {
        const message =
            'The installed Livewire build returned no unsubscribe function from $watch(). ' +
            'wire-bridge requires that behavior (Livewire 4); it will not fall back to private fields.';

        disposed = true;

        throw new WireBridgeCompatibilityError(message);
    }

    watcherDisposer = /** @type {() => void} */ (disposer);

    captureInitialSnapshot();

    /** @type {WireBridge} */
    const bridge = {
        id,
        root,
        wire,
        getSnapshot,
        subscribe,
        field,
        commit,
        call,
        dispose,
    };

    Object.defineProperty(bridge, DEBUG_STATE, {
        value: () => ({
            id,
            root,
            revision,
            watcherActive: !disposed && typeof watcherDisposer === 'function',
            fieldCount: fieldStates.size,
            fieldSubscribers: [...fieldStates.values()].reduce(
                (total, state) => total + state.listeners.size,
                0,
            ),
            rootSubscribers: rootListeners.size,
            disposed,
        }),
    });

    return bridge;
}
