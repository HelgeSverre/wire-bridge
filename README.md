# wire-bridge

<img src="docs/hero.png" alt="Helge riding a bicycle made of crackling live wires through a neon nebula, labelled WIRE-BRIDGE" width="100%">

One mounted Livewire component can be the single writable state owner for any number of
frontend renderers. `wire-bridge` is the small, framework-independent adapter layer that
makes that true: cached immutable snapshots, stable field bindings, explicit commit and PHP
actions — and official Preact and Solid adapters.

- **Livewire stays the only writer.** Every published snapshot is re-read from `$wire`; the
  cache is never a second store.
- **Local edits are free.** Typing, toggling and nested object edits propagate between
  renderers with zero HTTP requests.
- **HTTP is explicit.** `commit()` and `call()` are the only paths that talk to PHP.
- **No forks, no private APIs.** It uses the documented Livewire browser API: `$get`, `$set`,
  `$watch`, `$commit`, `$call` and `Livewire.directive(...)`.

The package is plain ES modules with JSDoc types, no build step for the runtime code, and no
runtime dependencies. Preact and Solid are optional peers resolved only through their subpaths.

## Install

```bash
npm install wire-bridge
# plus whichever adapter(s) you use
npm install preact        # for wire-bridge/preact
npm install solid-js      # for wire-bridge/solid
```

Compatibility baseline: Livewire 4, whose `$watch(path, callback)` returns an unsubscribe
function. The bridge refuses to initialize with a visible `WireBridgeCompatibilityError` if
that contract is missing, instead of reaching into private component fields.

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

See [`docs/renderer-contract.md`](docs/renderer-contract.md) for a plain-JavaScript example,
and [`docs/livewire-integration.md`](docs/livewire-integration.md) for leases, DOM ownership
and `wire:navigate` behavior.

## Scripts

| Script | What it does |
| --- | --- |
| `npm test` | Core bridge contract tests (node environment, no DOM) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` over the JSDoc-typed source |
| `npm run types` | Emit `.d.ts` declarations into `dist/types` |
| `npm run build` | Alias for `types` — the runtime ships as-authored ESM |
| `npm run check` | `typecheck` + `test`, the pre-push gate |
| `npm run publint` / `npm run attw` | Package/export-map hygiene before publishing |
| `npm run release` | `check` + `build` + `publish` |

## What this package does not include

The demo application, the PHP fixture (`AMLForm`), the browser acceptance suite, inspectors,
controls and diagnostics all live in the PoC repository this package was extracted from. The
package intentionally stays at the state layer: it observes one Livewire component and serves
snapshots and writes.

Known limitations, carried over from the PoC:

- Livewire 3 is not supported.
- No SSR/hydration of islands; no automatic dependency tracking for arbitrary property reads.
- No configurable blur/debounce/live policies; transport policy belongs to the caller.
- Edits made while a request is in flight follow Livewire's merge behavior. The bridge always
  converges to whatever `$wire` exposes afterward, without extra writebacks or writeback
  loops, but it does not promise merge ordering. Documented cases: see the PoC's `findings.md`.

## License

MIT
