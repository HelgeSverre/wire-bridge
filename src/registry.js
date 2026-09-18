/**
 * Bridge leasing registry.
 *
 * A bridge is shared by every host that mounts against the same Livewire
 * component and root property. The bridge lives as long as its last lease;
 * when the final lease is released it is disposed and its registry entry is
 * removed so a later remount creates a fresh bridge over the still-current
 * Livewire state.
 *
 * @module wire-bridge/registry
 */

/**
 * @typedef {import('./core.js').WireBridge} WireBridge
 *
 * @typedef {object} BridgeLease
 * @property {WireBridge} bridge
 * @property {() => void} release idempotent
 *
 * @typedef {object} RegistryEntry
 * @property {string} key
 * @property {string} componentId
 * @property {string} root
 * @property {number} leases
 * @property {WireBridge} bridge
 */

/**
 * @typedef {object} AcquireOptions
 * @property {string} componentId
 * @property {string} root
 * @property {() => WireBridge} createBridge
 */

/**
 * @returns {{
 *   acquire: (options: AcquireOptions) => BridgeLease,
 *   entries: () => RegistryEntry[],
 *   count: () => number,
 * }}
 */
export function createBridgeRegistry() {
    /** @type {Map<string, RegistryEntry>} */
    const entries = new Map();

    /**
     * @param {AcquireOptions} options
     * @returns {BridgeLease}
     */
    function acquire({ componentId, root, createBridge }) {
        const key = `${componentId}::${root}`;

        let entry = entries.get(key);

        if (entry === undefined) {
            entry = {
                key,
                componentId,
                root,
                leases: 0,
                bridge: createBridge(),
            };

            entries.set(key, entry);
        }

        entry.leases++;

        let released = false;

        return {
            bridge: entry.bridge,
            release() {
                if (released) {
                    return;
                }

                released = true;
                entry.leases--;

                if (entry.leases <= 0) {
                    entries.delete(key);
                    entry.bridge.dispose();
                }
            },
        };
    }

    return {
        acquire,

        /**
         * @returns {RegistryEntry[]}
         */
        entries() {
            return [...entries.values()];
        },

        count() {
            return entries.size;
        },
    };
}
