# Wire Bridge

**Livewire state for React, Vue, Svelte, Solid, Preact, Lit and Alpine islands.**

[![npm](https://img.shields.io/npm/v/wire-bridge)](https://www.npmjs.com/package/wire-bridge)
[![CI](https://github.com/HelgeSverre/wire-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/HelgeSverre/wire-bridge/actions/workflows/ci.yml)
[![Livewire 4](https://img.shields.io/badge/Livewire-4-EC4899)](https://livewire.laravel.com)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/HelgeSverre/wire-bridge/blob/main/LICENSE)

<img src="https://raw.githubusercontent.com/HelgeSverre/wire-bridge/main/docs/hero.webp" alt="Illustration of a developer riding a bicycle made of crackling live wires through a neon nebula, titled WIRE-BRIDGE" width="100%">

Put React, Vue, Svelte or other framework components on a Livewire page and let them edit
the same component state as your Blade inputs. Livewire stays the owner: islands read a
cached copy of the `$wire` state and write back through `$wire.$set`, so typing in a React
input updates the Vue and Blade inputs without a request. Nothing reaches PHP until you call
`commit()` or `call()`.

Adapters ship for Preact, React, Solid, Svelte and Vue; Lit and Alpine use the plain binding.
It only uses Livewire's public browser API (`$get`, `$set`, `$watch`, `$commit`, `$call`,
`Livewire.directive`). Plain ES modules with TypeScript declarations and no runtime
dependencies.

<img src="https://raw.githubusercontent.com/HelgeSverre/wire-bridge/main/docs/demo.gif" alt="Order builder: React line items, Vue totals, Svelte delivery and coupon, a Lit badge and Alpine notes edit one Livewire component's state with zero requests; Apply sends one request and PHP's discount appears everywhere; Place order sends a second and the order number appears in the Lit badge" width="100%">

*One Livewire component, five frameworks plus Blade. Edits update every island with zero
requests. **Apply** and **Place order** each send one request; PHP's discount and order
number flow back into every island.*

To try it locally, clone [wire-bridge-example](https://github.com/HelgeSverre/wire-bridge-example):
the order builder above, plus a renderer matrix with the same form in all eight renderers.

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
  `WireBridgeCompatibilityError` instead of reaching into private component fields. Under
  `wire:frontend` this error is thrown from the directive callback, not passed to
  `hooks.onError`.
- A bundler that understands package `exports` (Vite, Webpack 5, esbuild, Rollup).

## Entry points

| Subpath | Exports | Peer dependency |
| --- | --- | --- |
| `wire-bridge` | `createWireBridge`, `DEBUG_STATE`, error classes, JSON helpers | none |
| `wire-bridge/json` | Error classes and value/path helpers (`parsePath`, `copyJsonValue`, `structurallyEqual`, …) | none |
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

// `name` is a shallowRef (snapshots are deep-frozen); the template unwraps it.
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
| `id` | `$wire.$id`, or `null` if absent |
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
| `set(nextValue)` | `$wire.$set(absolutePath, copy, false)`; never makes a request. Invalid values, missing paths and disposal throw synchronously; a failing `$set` rejects |

`field('')` selects the whole root and can replace it. `field('owners.0.name')` follows the
array index after reordering, not the owner's identity — render stable `owner.id` keys.

### Path and value rules

- Dot-separated segments only: identifier-style property names (`[A-Za-z_$][A-Za-z0-9_$]*`)
  or numeric indices without leading zeros. No bracket expressions; keys such as
  `first-name` cannot be addressed.
- `__proto__`, `constructor` and `prototype` segments are rejected, as are malformed segments.
- A disappeared path reads as `undefined`; `undefined` is not an allowed stored value.
- `set()` on a path that does not currently exist throws `WireBridgeValueError` — replace the
  containing object or array instead.
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

Development needs Node ^22.12, ^24 or >=26 (Vitest 5).

```bash
npm test             # contract tests for core, directive and entry points (Node, no DOM)
npm run typecheck    # tsc --noEmit over the JSDoc-typed source
npm run build        # emit .d.ts declarations into dist/types
npm run check        # typecheck + test
npm run publint      # package/export-map lint
npm run attw         # "are the types wrong" check
```

Releases publish from CI. Bump the version, push the tag, and publish a GitHub release for it;
`.github/workflows/publish.yml` then runs the checks and publishes to npm with provenance
through trusted publishing:

```bash
npm version patch                  # or minor / major; commits and tags vX.Y.Z
git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
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
  loops, but it does not promise merge ordering.
