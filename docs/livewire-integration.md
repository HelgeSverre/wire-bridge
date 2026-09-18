# Livewire integration

`wire-bridge/livewire` is the only entry point that touches the Livewire browser global and
the DOM. It owns two objects: the bridge registry and the `wire:frontend` directive.

## Registration

```js
import {
  createBridgeRegistry,
  createFrontendDirective,
} from "wire-bridge/livewire";

document.addEventListener("livewire:init", () => {
  const registry = createBridgeRegistry();

  createFrontendDirective({
    getLivewire: () => window.Livewire,
    registry,
    root: "data", // the public property the bridge projects
    renderers: {
      // fixed, application-owned map
      preact: { load: () => import("./islands/preact") },
      solid: { load: () => import("./islands/solid") },
    },
    hooks: {}, // optional lifecycle callbacks
  }).register();
});
```

Rules that keep this reliable:

- **Register on `livewire:init`.** That event fires inside `Livewire.start()` before any
  component initializes, so the directive sees every host exactly once. `getLivewire` is a
  getter because script ordering between your bundle and the Livewire script tag is not fixed.
- **Register once per page load.** Livewire remembers directive names, and the directive
  itself refuses to register twice. With `wire:navigate`, the page is not re-evaluated, so
  register at module scope or behind an idempotence guard — not per navigation.
- **The renderer map is closed.** Host attributes choose a key in the map. They can never
  request arbitrary URLs or modules.

## What the directive does with a host

For `<div wire:ignore wire:frontend="preact" wire:key="preact-host"></div>`:

1. Acquire a lease from the registry, keyed by `componentId + root`. Sibling hosts on the
   same component share one bridge.
2. Register cleanup immediately — before the lazy `load()` starts — via the documented
   `cleanup` callback.
3. Call `renderer.load()`, then `mount(host, bridge, config)` **only if the host is still in
   the document**.
4. On cleanup: cancel the mount, `destroy()` the renderer if it mounted, release the lease,
   and drop host bookkeeping. Every step is idempotent.

A `WeakMap` of hosts prevents duplicate mounting, and a disposed registry entry is deleted,
so remounting later creates a fresh bridge over the still-current Livewire state.

## Leases and disposal

- A bridge is created by the first host that needs it and disposed when the **last** lease
  is released.
- If your own code (an inspector, a debug panel, a plain-JS observer) uses a shared bridge,
  give it its own lease:

  ```js
  const { bridge, release } = registry.acquire({
    componentId,
    root: "data",
    createBridge: () => createWireBridge(wire, { root: "data" }),
  });

  // ... later, when your host is removed:
  release();
  ```

- After the last lease releases, reads, subscriptions, field lookups, writes, `commit()` and
  `call()` throw `WireBridgeDisposedError`. Already-issued unsubscribes and `dispose()` stay
  safe. In-flight Livewire requests are not cancelled; their results simply never render
  through the disposed bridge.

## DOM ownership

- Livewire owns the wrapper and any `@if` visibility conditions. Put them on a wrapper
  **outside** the host:

  ```blade
  @if ($showPreactWrapper)
      <div wire:key="preact-wrapper">
          <div wire:ignore wire:frontend="preact" wire:key="preact-host"></div>
      </div>
  @endif
  ```

- Give wrappers and hosts stable `wire:key`s so normal server renders keep matching elements.
- Never let Blade render dynamic descendants inside a host. Backend error messages,
  validators and inspectors stay outside the frontend-owned subtree.
- `wire:ignore` keeps Livewire's morph out of the host. Removal of the host (locally or by a
  server morph) still runs the directive cleanup through Alpine's element lifecycle.

## Hooks

All hooks are optional. They are instrumentation, not domain callbacks:

| Hook                                  | Fired                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `onMountStarted(name, el)`            | after cleanup registration, before `load()`                                        |
| `onMounted(name, el, bridge)`         | after `mount()` returned                                                           |
| `onUnmounted(name, el, { didMount })` | whenever cleanup ran; `didMount` tells a destroyed renderer from a cancelled mount |
| `onError(error, context)`             | load/mount/destroy failures                                                        |

## Debug state

`bridge[DEBUG_STATE]()` returns revision, watcher/subscriber counts and disposal state.
`DEBUG_STATE` is exported for instrumentation and is not part of the stable contract.
