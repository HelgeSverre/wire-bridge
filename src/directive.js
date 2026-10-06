/**
 * The `wire:frontend` Livewire directive.
 *
 * The directive attaches a frontend renderer to a `wire:ignore` host element.
 * Documented Livewire custom-directive arguments are used throughout:
 * `{ el, directive, component, $wire, cleanup }`. No private Livewire fields
 * are touched.
 *
 * Lifecycle rules:
 * - the bridge lease is acquired from a registry keyed by component ID + root
 * - cleanup is registered immediately, before any asynchronous module import
 * - a renderer that resolves after its host was removed is never mounted
 * - every cleanup step is idempotent
 *
 * @module wire-bridge/directive
 */

import { createWireBridge } from './core.js';

/**
 * @typedef {object} FrontendRenderer
 * @property {() => Promise<{ mount: (host: Element, bridge: import('./core.js').WireBridge, config: { mode: string }) => { destroy?: () => void } | void }>} load
 */

/**
 * @typedef {object} LivewireDirectiveContext
 * @property {Element} el
 * @property {{ expression?: string, raw?: string }} directive
 * @property {{ id: string, $wire?: import('./core.js').WireLike }} component
 * @property {import('./core.js').WireLike} [$wire]
 * @property {(callback: () => void) => void} cleanup
 */

/**
 * @typedef {object} LivewireGlobal
 * @property {(name: string, callback: (context: LivewireDirectiveContext) => void) => void} directive
 */

/**
 * @typedef {object} FrontendDirectiveHooks
 * @property {(name: string, el: Element) => void} [onMountStarted]
 * @property {(name: string, el: Element, bridge: import('./core.js').WireBridge) => void} [onMounted]
 * @property {(name: string, el: Element, outcome: { didMount: boolean }) => void} [onUnmounted]
 * @property {(error: unknown, context: object) => void} [onError]
 */

/**
 * @param {object} options
 * @param {() => LivewireGlobal | undefined} options.getLivewire returns the global Livewire object
 * @param {ReturnType<import('./registry.js').createBridgeRegistry>} options.registry
 * @param {Record<string, FrontendRenderer>} options.renderers fixed application-owned renderer map
 * @param {string} [options.root]
 * @param {FrontendDirectiveHooks} [options.hooks]
 */
export function createFrontendDirective({ getLivewire, registry, renderers, root = 'data', hooks = {} }) {
    /**
     * @typedef {object} HostState
     * @property {boolean} canceled
     * @property {boolean} cleaned
     * @property {boolean} didMount
     * @property {(() => void) | null} destroy
     * @property {{ release: () => void }} lease
     * @property {string} name
     * @property {Element} el
     */

    /** @type {WeakMap<Element, HostState>} */
    const hosts = new WeakMap();

    let registered = false;

    /**
     * @param {unknown} error
     * @param {object} context
     */
    function reportError(error, context) {
        if (typeof hooks.onError === 'function') {
            hooks.onError(error, context);

            return;
        }

        console.error('[wire-bridge] frontend directive error', context, error);
    }

    function register() {
        if (registered) {
            return;
        }

        registered = true;

        const Livewire = getLivewire();

        if (Livewire === undefined || typeof Livewire.directive !== 'function') {
            registered = false;

            throw new Error('Livewire is not available on this page; cannot register the wire:frontend directive');
        }

        Livewire.directive('frontend', ({ el, directive, component, $wire, cleanup }) => {
            const name = String(directive.expression ?? '').trim();
            const renderer = renderers[name];

            if (renderer === undefined) {
                reportError(new Error(`Unknown frontend renderer "${name}"`), { el });

                return;
            }

            // A WeakMap prevents accidental duplicate mounting on the same host.
            if (hosts.has(el)) {
                return;
            }

            const wire = $wire ?? component.$wire;

            if (wire === undefined) {
                reportError(new Error('The Livewire component did not expose its $wire object'), { el });

                return;
            }

            const componentId = typeof wire.$id === 'string' ? wire.$id : component.id;

            const lease = registry.acquire({
                componentId,
                root,
                createBridge: () => createWireBridge(wire, { root }),
            });

            /** @type {HostState} */
            const state = {
                canceled: false,
                cleaned: false,
                didMount: false,
                destroy: null,
                lease,
                name,
                el,
            };

            hosts.set(el, state);

            function cleanupHost() {
                if (state.cleaned) {
                    return;
                }

                state.cleaned = true;
                state.canceled = true;

                if (state.destroy !== null) {
                    const destroy = state.destroy;
                    state.destroy = null;

                    try {
                        destroy();
                    } catch (error) {
                        reportError(error, { el, renderer: name, phase: 'destroy' });
                    }
                }

                hosts.delete(el);
                lease.release();

                if (typeof hooks.onUnmounted === 'function') {
                    hooks.onUnmounted(name, el, { didMount: state.didMount });
                }
            }

            // Register cleanup before starting any asynchronous work.
            cleanup(cleanupHost);

            if (typeof hooks.onMountStarted === 'function') {
                hooks.onMountStarted(name, el);
            }

            Promise.resolve()
                .then(() => renderer.load())
                .then((module) => {
                    if (state.canceled) {
                        return;
                    }

                    if (module === null || typeof module.mount !== 'function') {
                        throw new Error(`The "${name}" renderer module does not export mount(host, bridge)`);
                    }

                    // Mount only if the host is still attached to the document.
                    if (!el.isConnected) {
                        // The host was removed while the module was loading.
                        // Release the lease now; the later attribute-removal
                        // cleanup is a no-op, so no destroy is ever called.
                        cleanupHost();

                        return;
                    }

                    const config = {
                        mode: el instanceof HTMLElement && typeof el.dataset.wireMode === 'string'
                            ? el.dataset.wireMode
                            : 'full',
                    };

                    const mounted = module.mount(el, lease.bridge, config);
                    const destroy = mounted !== null && typeof mounted?.destroy === 'function'
                        ? mounted.destroy.bind(mounted)
                        : null;

                    // Mounting can synchronously remove its own host. Cleanup
                    // has already released the lease in that case, so destroy
                    // the renderer immediately instead of storing it in dead
                    // host state.
                    if (state.cleaned) {
                        destroy?.();

                        return;
                    }

                    state.didMount = true;
                    state.destroy = destroy;

                    if (typeof hooks.onMounted === 'function') {
                        hooks.onMounted(name, el, lease.bridge);
                    }
                })
                .catch((error) => {
                    reportError(error, { el, renderer: name, phase: 'mount' });

                    // Release the lease and host bookkeeping so a failed mount
                    // never leaves a dangling bridge behind.
                    cleanupHost();
                });
        });
    }

    return { register };
}
