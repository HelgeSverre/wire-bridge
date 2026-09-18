# Renderer contract

A renderer is a lazily loaded ES module that mounts a frontend view into a `wire:ignore` host
and returns a destroy function.

```js
/**
 * @param {Element} host
 * @param {import('wire-bridge').WireBridge} bridge
 * @param {{ mode: string }} config
 * @returns {{ destroy: () => void }}
 */
export function mount(host, bridge, config) {
    // build your UI inside host, subscribe through the bridge
    return {
        destroy() {
            // unsubscribe, tear down the framework tree, clear the host
        },
    };
}
```

## Requirements

1. **Stay inside the host you were given.** The host is a `wire:ignore` element; do not
   reach outside it and do not mutate ancestors. Livewire's morph owns everything else.
2. **Read only through the bridge.** `bridge.getSnapshot()` and `binding.getSnapshot()` are
   pure cache reads; do not clone, register watchers, or fetch inside them.
3. **Write only through the bridge.** `binding.set(value)` is always deferred
   (`$set(path, value, false)`). Commit and PHP actions are explicit.
4. **Treat snapshots as immutable.** They are deep-frozen. For object edits, construct a new
   value and `set()` it; never mutate a snapshot in place.
5. **Make `destroy()` idempotent and complete.** Stop every subscription and cancel every
   scheduled render. `destroy()` may be called immediately after `mount()` if the host was
   removed during the import.

## Plain-JavaScript example

```js
export function mount(host, bridge) {
    const name = bridge.field('name');
    const country = bridge.field('country');

    const list = document.createElement('dl');
    host.append(list);

    const render = () => {
        list.textContent = '';
        for (const [label, binding] of [['Name', name], ['Country', country]]) {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = String(binding.getSnapshot() ?? '');
            list.append(dt, dd);
        }
    };

    const unsubscribeName = name.subscribe(render);
    const unsubscribeCountry = country.subscribe(render);
    render(); // subscriptions do not fire at subscribe time

    return {
        destroy() {
            unsubscribeName();
            unsubscribeCountry();
            host.textContent = '';
        },
    };
}
```

## Framework patterns

The official adapters exist only to convert bridge subscriptions into each framework's own
reactive primitive:

- **Preact** — `useSyncExternalStore(binding.subscribe, binding.getSnapshot)`. The hook closes
  the read-before-subscribe race for you.
- **Solid** — `createSignal(binding.getSnapshot())`, then a subscription that re-sets the
  signal, registered with `onCleanup`. Keep the direction explicit: external changes update
  the signal; user input calls `binding.set()`. Never add an effect that writes the signal
  back into Livewire — that creates an echo loop.

Bridge and field methods are stable closures without a `this` receiver, so they can be passed
directly to hooks and event handlers.

## Paths and identity

- `field('')` is the whole root and can be replaced.
- `field('owners.0.name')` follows the array index after reordering, not the owner's
  identity. Dynamic repeater identity management is out of scope — render stable `owner.id`
  keys and rebuild rows when the array is replaced.
- Writes to a missing descendant path throw; add/remove/reorder by replacing the containing
  object or array.
