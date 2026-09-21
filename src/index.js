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

/**
 * Re-exported so consumers can name the core types without reaching into the
 * package's internal file layout.
 *
 * @typedef {import('./core.js').WireBridge} WireBridge
 * @typedef {import('./core.js').FieldBinding} FieldBinding
 * @typedef {import('./core.js').WireBridgeOptions} WireBridgeOptions
 * @typedef {import('./core.js').WireLike} WireLike
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
