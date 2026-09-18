/**
 * wire-bridge core entry point.
 *
 * Framework-independent bridge between one mounted Livewire component and any
 * number of frontend renderers. This entry point has no dependency on Livewire,
 * the DOM, or any frontend framework: it only speaks to a `$wire`-shaped object
 * (see the `WireLike` typedef in core.js) and to plain JSON values.
 *
 * @module wire-bridge
 */

export { createWireBridge, DEBUG_STATE } from './core.js';

export {
    WireBridgeError,
    WireBridgePathError,
    WireBridgeValueError,
    WireBridgeDisposedError,
    WireBridgeCompatibilityError,
    isPlainObject,
    describeValue,
    parsePath,
    getAtPath,
    copyJsonValue,
    deepFreeze,
    structurallyEqual,
} from './json.js';
