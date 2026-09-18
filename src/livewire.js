/**
 * Livewire integration entry point.
 *
 * This is the only entry point that touches the Livewire browser global and
 * the DOM. It provides the bridge registry (leases keyed by component ID +
 * root) and the `wire:frontend` directive.
 *
 * @module wire-bridge/livewire
 */

export { createBridgeRegistry } from './registry.js';
export { createFrontendDirective } from './directive.js';
