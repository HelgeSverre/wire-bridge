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
  const name = bridge.field("name");
  const country = bridge.field("country");

  const list = document.createElement("dl");
  host.append(list);

  const render = () => {
    list.textContent = "";
    for (const [label, binding] of [
      ["Name", name],
      ["Country", country],
    ]) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = String(binding.getSnapshot() ?? "");
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
      host.textContent = "";
    },
  };
}
```

## Framework patterns

The official adapters exist only to convert bridge subscriptions into each framework's own
reactive primitive:

- **Preact / React** — `useSyncExternalStore(binding.subscribe, binding.getSnapshot)`. The hook
  closes the read-before-subscribe race for you.
- **Solid** — `createSignal(binding.getSnapshot())`, then a subscription that re-sets the
  signal, registered with `onCleanup`. Keep the direction explicit: external changes update
  the signal; user input calls `binding.set()`. Never add an effect that writes the signal
  back into Livewire — that creates an echo loop.
- **Vue** — `shallowRef(binding.getSnapshot())` plus `onScopeDispose(unsubscribe)`, the same
  shape as Solid. Use `shallowRef`, never `ref()`/`reactive()`: snapshots are deep-frozen, and
  a deep proxy over them buys nothing and can only surprise you.
- **Svelte** — the store contract is inverted, so `wireField` wraps it: a Svelte store must
  call its subscriber immediately, while `binding.subscribe` never fires at subscribe time.
  The wrapper calls `run(getSnapshot())` first and then delegates.

Frameworks with no adapter file, because the binding is already the right shape:

- **Lit and other custom elements** — a `ReactiveController` whose `hostConnected()` subscribes
  and calls `this.host.requestUpdate()`, and whose `hostDisconnected()` unsubscribes. Stencil
  and every other custom-element compiler emit the same lifecycle callbacks, so the same six
  lines apply.
- **Alpine** — `Alpine.data(...)` with `init()` subscribing and `destroy()` unsubscribing.

Bridge and field methods are stable closures without a `this` receiver, so they can be passed
directly to hooks and event handlers.

## What is deliberately not an adapter

- **Next, Remix, Waku and other React meta-frameworks** need no adapter of their own. Their
  client layer is plain React, so `'use client'` plus `wire-bridge/react` is the whole
  integration. Their server halves own the route and cannot live inside a Livewire island.
- **Datastar** is not a fit, and the reason is structural rather than a missing adapter.
  Datastar has no external JavaScript signal API by design: state lives in `data-*` attributes,
  moves via custom events, and is driven from the server over SSE. Livewire is already that
  server, so a Datastar adapter would put two server-driven state owners in charge of one form.
  Interop is possible as an *event bridge* — dispatch a `CustomEvent` that a
  `data-on:…__window` handler reads, and expose a global function for Datastar expressions to
  call — but that is message passing, not a shared store, and should not be presented as one.

## Paths and identity

- `field('')` is the whole root and can be replaced.
- `field('owners.0.name')` follows the array index after reordering, not the owner's
  identity. Dynamic repeater identity management is out of scope — render stable `owner.id`
  keys and rebuild rows when the array is replaced.
- Writes to a missing descendant path throw; add/remove/reorder by replacing the containing
  object or array.
