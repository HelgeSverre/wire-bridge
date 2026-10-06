# wire-bridge

**Livewire state for React, Vue, Svelte, Solid, Preact, Lit and Alpine islands.**

[![npm](https://img.shields.io/npm/v/wire-bridge)](https://www.npmjs.com/package/wire-bridge)
[![Livewire 4](https://img.shields.io/badge/Livewire-4-EC4899)](https://livewire.laravel.com)
![ESM only](https://img.shields.io/badge/module-ESM%20only-3178C6)
![zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/HelgeSverre/wire-bridge/blob/main/LICENSE)

<img src="https://raw.githubusercontent.com/HelgeSverre/wire-bridge/main/docs/hero.webp" alt="Illustration of a developer riding a bicycle made of crackling live wires through a neon nebula, titled WIRE-BRIDGE" width="100%">

Frontend islands read and edit the state of one mounted Livewire 4 component through cached
immutable snapshots, stable field bindings, and explicit commit and PHP actions. First-party
adapters ship for Preact, React, Solid, Svelte and Vue; Lit and Alpine use the plain binding.

- **Livewire stays the only writer.** Every published snapshot is re-read from `$wire`; the
  cache is never a second store.
- **Local edits are free.** Typing, toggling and nested object edits propagate between
  renderers with zero HTTP requests.
- **HTTP is explicit.** `commit()` and `call()` are the only paths that talk to PHP.
- **No forks, no private APIs.** It uses the documented Livewire browser API: `$get`, `$set`,
  `$watch`, `$commit`, `$call` and `Livewire.directive(...)`.

The runtime is plain ES modules with JSDoc-generated `.d.ts` types and no runtime
dependencies.

<img src="https://raw.githubusercontent.com/HelgeSverre/wire-bridge/main/docs/demo.gif" alt="Three panels — LIVEWIRE, PREACT and SOLID — editing one shared Livewire state together, with a request counter that stays at 0" width="100%">

*One state, three renderers: every edit propagates to all panels with zero Livewire requests.*

To try it locally, clone [wire-bridge-example](https://github.com/HelgeSverre/wire-bridge-example):
a Laravel app with Blade, Preact, React, Solid, Svelte, Vue, Lit and Alpine panels on one
component.

---

## Install

```bash
npm install wire-bridge
```

Add the adapter packages you actually use. They are optional peers, resolved only through the
subpaths that import them:

```bash
npm install preact     # for wire-bridge/preact
npm install react      # for wire-bridge/react
npm install solid-js   # for wire-bridge/solid
npm install vue        # for wire-bridge/vue
```

`wire-bridge/svelte` needs no install: a Svelte store is duck-typed, so the adapter imports
nothing from Svelte.

Requirements:

- **Livewire 4.** The bridge relies on `$watch(path, callback)` returning an unsubscribe
  function. On a build without that contract, initialization fails with a visible
  `WireBridgeCompatibilityError` instead of reaching into private component fields.
- A bundler that understands package `exports` (Vite, Webpack 5, esbuild, Rollup).

## Entry points

| Subpath | Exports | Peer dependency |
| --- | --- | --- |
| `wire-bridge` | `createWireBridge`, `DEBUG_STATE`, error classes, JSON helpers | none |
| `wire-bridge/json` | Value/path helpers (`parsePath`, `copyJsonValue`, `structurallyEqual`, …) | none |
| `wire-bridge/livewire` | `createBridgeRegistry`, `createFrontendDirective` | Livewire 4 (browser global) |
| `wire-bridge/preact` | `useWireField` | `preact` >= 10 |
| `wire-bridge/react` | `useWireField` | `react` >= 18 |
| `wire-bridge/solid` | `createWireField` | `solid-js` >= 1.7 |
| `wire-bridge/svelte` | `wireField` | none |
| `wire-bridge/vue` | `useWireField` | `vue` >= 3.3 |

The core entry point never touches Livewire, the DOM, or a frontend framework — it only speaks
to a `$wire`-shaped object and plain JSON values.

## Quick start

Register once per page load, before Livewire initializes the page:

```js
import { createBridgeRegistry, createFrontendDirective } from 'wire-bridge/livewire';

document.addEventListener('livewire:init', () => {
    const registry = createBridgeRegistry();

    createFrontendDirective({
        getLivewire: () => window.Livewire,
        registry,
        root: 'data',
        renderers: {
            preact: { load: () => import('./islands/preact') },
            solid: { load: () => import('./islands/solid') },
        },
    }).register();
});
```

Then mark hosts in Blade. Livewire owns the wrapper; the renderer owns the `wire:ignore` host:

```blade
@if ($showPreactWrapper)
    <div wire:key="preact-wrapper">
        <div wire:ignore wire:frontend="preact" wire:key="preact-host"></div>
    </div>
@endif
```

Consume state inside an island:

```jsx
// Preact
import { useWireField } from 'wire-bridge/preact';

function NameField({ bridge }) {
    const [name, setName] = useWireField(bridge, 'name');

    return <input value={name ?? ''} onInput={(event) => setName(event.currentTarget.value)} />;
}
```

```jsx
// Solid (inside a component / active owner)
import { createWireField } from 'wire-bridge/solid';

function NameField(props) {
    const [name, setName] = createWireField(props.bridge, 'name');

    return <input value={name() ?? ''} onInput={(event) => setName(event.currentTarget.value)} />;
}
```

`wire-bridge/react` has the same `useWireField` signature as the Preact adapter.

```vue
<!-- Vue (inside setup) -->
<script setup>
import { useWireField } from 'wire-bridge/vue';

const props = defineProps({ bridge: { type: Object, required: true } });

// shallowRef, because snapshots are deep-frozen.
const [name, setName] = useWireField(props.bridge, 'name');
</script>

<template>
    <input :value="name ?? ''" @input="setName($event.currentTarget.value)" />
</template>
```

```svelte
<!-- Svelte: a plain store, so `$name` auto-subscribes and auto-unsubscribes -->
<script>
    import { wireField } from 'wire-bridge/svelte';

    let { bridge } = $props();

    const name = wireField(bridge, 'name');
</script>

<input value={$name ?? ''} oninput={(event) => name.set(event.currentTarget.value)} />
```

Frameworks without an adapter consume the binding directly. For Lit, a
`ReactiveController` is the whole integration:

```js
class WireField {
    constructor(host, bridge, path) {
        this.host = host;
        this.binding = bridge.field(path);
        this.value = this.binding.getSnapshot();
        host.addController(this);
    }

    hostConnected() {
        const sync = () => {
            this.value = this.binding.getSnapshot();
            this.host.requestUpdate();
        };

        this.unsubscribe = this.binding.subscribe(sync);
        sync(); // subscriptions do not fire at subscribe time
    }

    hostDisconnected() {
        this.unsubscribe?.();
    }
}
```

Or use the core directly, framework-free:

```js
import { createWireBridge } from 'wire-bridge';

const bridge = createWireBridge(wire, { root: 'data' });
const name = bridge.field('name');

const unsubscribe = name.subscribe(() => console.log(name.getSnapshot()));

await name.set('Ada');          // local Livewire edit; no HTTP
await bridge.commit();          // one synchronization request
await bridge.call('normalize'); // invoke a PHP action

unsubscribe();
bridge.dispose();
```

## API

### `createWireBridge(wire, options)`

| Member | Contract |
| --- | --- |
| `id` | Livewire component ID, read-only |
| `root` | Root property path, fixed for the bridge lifetime |
| `wire` | The original `$wire` object, returned unchanged as an escape hatch |
| `getSnapshot()` | Cached immutable snapshot of the root |
| `subscribe(listener)` | Root-change subscription; returns an idempotent unsubscribe |
| `field(path)` | Stable cached field binding for a path relative to the root |
| `commit()` | `$wire.$commit()`; returns its result and refreshes the cache when settled |
| `call(method, ...args)` | `$wire.$call(...)`; preserves the result/error and refreshes when settled |
| `dispose()` | Idempotently stops the watcher, clears listeners, releases bindings |

### Field bindings

| Member | Contract |
| --- | --- |
| `path` | Relative path such as `address.city` |
| `getSnapshot()` | Cached immutable value; referentially stable until this field changes |
| `subscribe(listener)` | Listener takes no arguments and re-reads the snapshot |
| `set(nextValue)` | `$wire.$set(absolutePath, value, false)`; never makes a request itself |

`field('')` selects the whole root and can replace it. `field('owners.0.name')` follows the
array index after reordering, not the owner's identity — render stable `owner.id` keys.

### Path and value rules

- Dot-separated property names and numeric array indices only; no bracket expressions.
- `__proto__`, `constructor` and `prototype` segments are rejected, as are malformed segments.
- A disappeared path reads as `undefined`; `undefined` is not an allowed stored value.
- Writes to missing descendant paths are rejected — replace the containing object or array.
- Accepted values: `null`, booleans, strings, finite numbers, arrays and plain string-keyed
  objects, recursively. Functions, symbols, BigInt, dates/class instances, cycles, `undefined`
  members and non-finite numbers are rejected with descriptive errors instead of being lost
  through JSON serialization.
- Values are copied before they reach `$wire`, so mutating the caller's original later cannot
  mutate Livewire state.

## Renderer contract

A renderer module is loaded lazily from the application-owned map and must export:

```js
export function mount(host, bridge, config) {
    // attach UI inside host
    return { destroy() { /* remove listeners and UI */ } };
}
```

Rules:

- Mount into your own `wire:ignore` host; never reach outside it.
- Bridge methods are stable closures without a `this` receiver — pass them to hooks directly.
- Ordinary state changes travel through subscriptions. There is no external `update(props)`.
- On cleanup, stop your subscriptions and destroy your renderer. Every step must be
  idempotent; the directive may clean up before a lazy import resolves.

See [`docs/renderer-contract.md`](https://github.com/HelgeSverre/wire-bridge/blob/main/docs/renderer-contract.md) for a plain-JavaScript example,
and [`docs/livewire-integration.md`](https://github.com/HelgeSverre/wire-bridge/blob/main/docs/livewire-integration.md) for leases, DOM ownership
and `wire:navigate` behavior.

## Development

Requires Node 22.12+ (Vitest 5).

```bash
npm test             # core bridge contract tests (node, no DOM)
npm run typecheck    # tsc --noEmit over the JSDoc-typed source
npm run build        # emit .d.ts declarations into dist/types
npm run check        # typecheck + test
npm run publint      # package/export-map lint
npm run attw         # "are the types wrong" check
npm run release      # check + build + npm publish
```

## Scope and limitations

The package stays at the state layer. The demo app, the PHP fixture (`AMLForm`), the
Playwright acceptance suite, inspectors and diagnostics live in
[wire-bridge-example](https://github.com/HelgeSverre/wire-bridge-example).

- Livewire 3 is not supported.
- No SSR/hydration of islands; no automatic dependency tracking for arbitrary property reads.
- No configurable blur/debounce/live policies; transport policy belongs to the caller.
- `owners.0.name`-style paths follow the array index, not identity. Dynamic repeater identity
  management is out of scope.
- Edits made while a request is in flight follow Livewire's merge behavior. The bridge always
  converges to whatever `$wire` exposes afterward, without extra writebacks or writeback
  loops, but it does not promise merge ordering. The measured cases are documented in
  [`findings.md`](https://github.com/HelgeSverre/wire-bridge-example/blob/main/findings.md).

## License

MIT
