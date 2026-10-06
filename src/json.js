/**
 * JSON-compatible value handling for the wire-bridge.
 *
 * The bridge only ever publishes JSON-compatible data: null, booleans,
 * strings, finite numbers, arrays, and plain string-keyed objects. Anything
 * else is rejected with a descriptive error instead of being silently lost
 * through JSON serialization.
 *
 * @module wire-bridge/json
 */

/**
 * JSON-compatible value.
 *
 * The alias cannot reference itself in tsc's JSDoc typedef support, so nested
 * containers are typed loosely here. The runtime validation in this module is
 * recursive and precise: every nested member must itself be a JsonValue.
 *
 * @typedef {null | boolean | string | number | unknown[] | { [key: string]: unknown }} JsonValue
 */

export class WireBridgeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'WireBridgeError';
    }
}

export class WireBridgePathError extends WireBridgeError {
    /**
     * @param {string} message
     * @param {string} [path]
     */
    constructor(message, path) {
        super(path === undefined ? message : `${message} (path: ${JSON.stringify(path)})`);
        this.name = 'WireBridgePathError';
        this.path = path;
    }
}

export class WireBridgeValueError extends WireBridgeError {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'WireBridgeValueError';
    }
}

export class WireBridgeDisposedError extends WireBridgeError {
    /** @param {string} operation */
    constructor(operation) {
        super(
            `This wire-bridge has been disposed; ${operation} is no longer available. ` +
                'Call dispose() only when the last consumer of the bridge is gone.',
        );
        this.name = 'WireBridgeDisposedError';
    }
}

export class WireBridgeCompatibilityError extends WireBridgeError {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'WireBridgeCompatibilityError';
    }
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const NUMERIC_SEGMENT = /^(?:0|[1-9][0-9]*)$/;
const PROPERTY_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Is this a plain string-keyed object (created by a literal or JSON.parse)?
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}

/**
 * Describe a value for error messages without serializing it.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function describeValue(value) {
    if (value === null) {
        return 'null';
    }

    const type = typeof value;

    if (type === 'object') {
        if (Array.isArray(value)) {
            return 'array';
        }

        if (value instanceof Date) {
            return 'Date';
        }

        const name = /** @type {object} */ (value).constructor?.name;

        return name && name !== 'Object' ? `instance of ${name}` : 'object';
    }

    return type;
}

/**
 * Parse and validate one field path. An empty path selects the whole root.
 *
 * @param {string} path
 * @returns {string[]} validated segments
 * @throws {WireBridgePathError}
 */
export function parsePath(path) {
    if (typeof path !== 'string') {
        throw new WireBridgePathError(`Field paths must be strings, received ${describeValue(path)}`);
    }

    if (path === '') {
        return [];
    }

    const segments = path.split('.');

    for (const segment of segments) {
        if (segment === '') {
            throw new WireBridgePathError('Malformed field path: empty segments are not allowed', path);
        }

        if (FORBIDDEN_SEGMENTS.has(segment)) {
            throw new WireBridgePathError(
                `Malformed field path: segment "${segment}" is not allowed`,
                path,
            );
        }

        if (!NUMERIC_SEGMENT.test(segment) && !PROPERTY_SEGMENT.test(segment)) {
            throw new WireBridgePathError(
                `Malformed field path: segment "${segment}" is neither a property name nor a numeric index`,
                path,
            );
        }
    }

    return segments;
}

/**
 * Read a path that was already parsed. A disappeared path reads as undefined.
 *
 * @param {unknown} root
 * @param {string[]} segments
 * @returns {unknown}
 */
export function getAtPath(root, segments) {
    let current = root;

    for (const segment of segments) {
        if (current === null || typeof current !== 'object') {
            return undefined;
        }

        if (Array.isArray(current)) {
            if (!NUMERIC_SEGMENT.test(segment)) {
                return undefined;
            }

            current = current[Number(segment)];
        } else {
            if (!Object.prototype.hasOwnProperty.call(current, segment)) {
                return undefined;
            }

            current = /** @type {Record<string, unknown>} */ (current)[segment];
        }

        if (current === undefined) {
            return undefined;
        }
    }

    return current;
}

/**
 * Validate a value and return an independent deep copy of it.
 *
 * The copy guarantees that mutating the caller's original object later cannot
 * mutate state behind the bridge.
 *
 * @param {unknown} value
 * @param {string} label used in error messages
 * @returns {JsonValue}
 * @throws {WireBridgeValueError}
 */
export function copyJsonValue(value, label = 'value') {
    return /** @type {JsonValue} */ (copy(value, label, new Set()));
}

/**
 * @param {unknown} value
 * @param {string} at
 * @param {Set<unknown>} ancestors
 * @returns {unknown}
 */
function copy(value, at, ancestors) {
    if (value === null) {
        return null;
    }

    const type = typeof value;

    if (type === 'string' || type === 'boolean') {
        return value;
    }

    if (type === 'number') {
        if (!Number.isFinite(value)) {
            throw new WireBridgeValueError(
                `${at} is ${String(value)}; only finite numbers can be stored`,
            );
        }

        return value;
    }

    if (type === 'undefined') {
        throw new WireBridgeValueError(
            `${at} is undefined; use null for an intentionally empty value ` +
                '(undefined is reserved for a disappeared path)',
        );
    }

    if (type === 'function' || type === 'symbol' || type === 'bigint') {
        throw new WireBridgeValueError(`${at} is a ${type}, which cannot be stored`);
    }

    if (ancestors.has(value)) {
        throw new WireBridgeValueError(`${at} contains a cyclic reference`);
    }

    if (Array.isArray(value)) {
        ancestors.add(value);

        const result = value.map((item, index) => copy(item, `${at}[${index}]`, ancestors));

        ancestors.delete(value);

        return result;
    }

    if (!isPlainObject(value)) {
        throw new WireBridgeValueError(
            `${at} is ${describeValue(value)}; only plain objects and arrays can be stored`,
        );
    }

    ancestors.add(value);

    /** @type {Record<string, unknown>} */
    const result = {};

    for (const key of Object.keys(value)) {
        // defineProperty keeps exotic-but-legal JSON keys such as "__proto__"
        // as plain own properties instead of touching the prototype chain.
        Object.defineProperty(result, key, {
            value: copy(/** @type {Record<string, unknown>} */ (value)[key], `${at}.${key}`, ancestors),
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }

    ancestors.delete(value);

    return result;
}

/**
 * Freeze a JSON-compatible value recursively.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }

    Object.freeze(value);

    for (const key of Object.keys(value)) {
        deepFreeze(/** @type {Record<string, unknown>} */ (value)[key]);
    }

    return value;
}

/**
 * Compare JSON-compatible values structurally. Object key ordering does not
 * count as a value change.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function structurallyEqual(left, right) {
    if (Object.is(left, right)) {
        return true;
    }

    if (typeof left !== typeof right || left === null || right === null) {
        return false;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        for (let index = 0; index < left.length; index++) {
            if (!structurallyEqual(left[index], right[index])) {
                return false;
            }
        }

        return true;
    }

    if (typeof left === 'object') {
        if (!isPlainObject(left) || !isPlainObject(right)) {
            return false;
        }

        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(/** @type {object} */ (right));

        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        for (const key of leftKeys) {
            if (!Object.prototype.hasOwnProperty.call(right, key)) {
                return false;
            }

            if (
                !structurallyEqual(
                    /** @type {Record<string, unknown>} */ (left)[key],
                    /** @type {Record<string, unknown>} */ (right)[key],
                )
            ) {
                return false;
            }
        }

        return true;
    }

    return false;
}
