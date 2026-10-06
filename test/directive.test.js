import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeRegistry, createFrontendDirective } from '../src/livewire.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('frontend directive lifecycle', () => {
    it('destroys a renderer whose mount synchronously removes its host', async () => {
        class TestElement {}

        vi.stubGlobal('HTMLElement', TestElement);

        let directiveCallback;
        let cleanupHost;
        const destroy = vi.fn();
        const registry = createBridgeRegistry();
        const wire = {
            $id: 'component-1',
            $get: () => ({}),
            $set: () => {},
            $watch: () => () => {},
            $commit: () => {},
            $call: () => {},
        };
        const renderer = {
            load: async () => ({
                mount() {
                    cleanupHost();

                    return { destroy };
                },
            }),
        };

        createFrontendDirective({
            getLivewire: () => ({
                directive(_name, callback) {
                    directiveCallback = callback;
                },
            }),
            registry,
            renderers: { test: renderer },
        }).register();

        const el = Object.assign(new TestElement(), { isConnected: true, dataset: {} });

        directiveCallback({
            el,
            directive: { expression: 'test' },
            component: { id: 'component-1' },
            $wire: wire,
            cleanup(callback) {
                cleanupHost = callback;
            },
        });

        await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());

        expect(registry.count()).toBe(0);
    });
});
