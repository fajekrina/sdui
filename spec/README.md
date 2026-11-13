# SDUI spec (v1.1)

The contract between the backend and `@fajekrina/sdui`. The machine-readable source
of truth is [`sdui.schema.json`](./sdui.schema.json) (JSON Schema Draft 2020-12);
this file is the human guide. When the two disagree, the schema wins.

v1 is the [murti](https://github.com/iQbalADR/murti) v1 contract, copied and owned
here (Apache-2.0, see [`../NOTICE`](../NOTICE)). v1.1 adds features murti does not
have, **additively**: every v1 / murti payload stays valid.

## Shape

```jsonc
// Payload (development, or inside the envelope)
{ "schemaVersion": "1.1",
  "screen": {
    "key": "home",                         // identifier
    "load": [ { "request": "getBalance" } ],   // v1.1, optional
    "root": { "type": "vstack", "props": {}, "children": [], "action": {} },
    "variants": { "compact": {}, "wide": {} }  // v1.1, optional
  } }

// Envelope (production)
{ "schemaVersion": "1.1", "alg": "ed25519", "keyId": "k1",
  "payload": "<base64 of the payload JSON>", "signature": "<base64 Ed25519 over those bytes>" }
```

A **node** is `{ type, id?, props?, children?, action? }`. `type` is an open
vocabulary (unknown types render a Null-Object placeholder); `props` is an open bag
(unknown keys are ignored).

## `schemaVersion` policy

- `MAJOR.MINOR`. The client supports major `1`.
- Same major, any minor → render what you can: unknown component types become
  placeholders, unknown props are ignored.
- Different major → reject, fail-closed (last-good cache or error view).
- Changes inside a major are additive only.

## Validation layers

| Layer | Where | What |
| --- | --- | --- |
| 1 · Structural decode | client | JSON maps to the model (`type` required, closed action types) |
| 2 · Schema conformance | CI (Ajv) + client validator + backend on save/publish | shape, closed vocabularies, per-field bounds |
| 3 · Client-only bounds | client validator | depth, total nodes, chain depth |
| 4 · Render fallback | renderer | unknown type → Null Object |

## Bounds

The defaults are published as [`bounds.json`](./bounds.json) — the single source of these numbers.
A backend reads that file from the pinned package (`@fajekrina/sdui/spec/bounds.json`) instead of
copying them. The client builds `SduiBounds.default` from it, and `tests/spec.test.ts` fails if the schema disagrees.

| Bound | Default | Enforced by |
| --- | --- | --- |
| String length | 4096 | schema + client |
| Identifier length | 128 | schema + client |
| Props per object | 64 | schema + client |
| Children per node | 256 | schema + client |
| Array items | 512 | schema + client |
| Envelope payload | ~1 MiB | schema |
| Tree depth | 32 | client |
| Total nodes | 5000 | client |
| Action chain (`onSuccess`/`onError`) | 4 | client |
| `screen.load` requests (`maxLoadRequests`) | 8 | schema + client |

## Components

v1 (murti):

| `type` | Props |
| --- | --- |
| `text` | `value` (tokens), `style` `title`·`headline`·`body`·`caption`, `color`, `weight`, `size` |
| `image` | `systemName` (symbol) · `name` (app-resolved asset), `contentMode` `fit`·`fill`, `width`, `height` |
| `vstack` / `hstack` | `spacing`, `alignment` (`leading`·`center`·`trailing` / `top`·`center`·`bottom`) |
| `zstack` | `width`, `height`; children carry `x`, `y`, `width`, `height` |
| `card` | `padding` (16), `background`, `cornerRadius` (12), `foreground` |
| `button` | `title` (tokens) + `action`; `variant` `primary`·`secondary`·`plain` (v1.1) |

v1.1:

| `type` | Props |
| --- | --- |
| `spacer` | `height`, `width` |
| `divider` | — |
| `grid` | `columns` (number), `spacing` |
| `scroll` | `axis` `vertical`·`horizontal` |
| `list` | `items` (data key path to an array), `as` (row name, default `item`), `spacing`; the children are the row template, rendered once per item with `{{<as>.*}}` |
| `form` | `spacing`; opens the `form.*` data scope for its fields |
| `textField` | `name`, `label`, `placeholder`, `keyboard` `text`·`number`·`email`·`phone`, `required`, `minLength`, `maxLength`, `pattern` (a **name**, see below), `secure` |
| `textArea` | `name`, `label`, `placeholder`, `rows`, `required`, `minLength`, `maxLength` |
| `picker` | `name`, `label`, `options` `[{ value, label }]` or strings, `required` |

Shared on every component: `padding`, `background`, `cornerRadius`, `foreground`,
and the accessibility props `a11yLabel` (tokens), `a11yId`, `a11yTraits`
(`button`·`header`·`image`·`link`).

### Style values

The style vocabulary is closed — no CSS. A color is a hex string (`#RGB`,
`#RRGGBB`, `#RRGGBBAA`) **or a semantic token name** (v1.1): `primary`,
`onPrimary`, `secondary`, `surface`, `onSurface`, `background`, `muted`, `border`,
`success`, `warning`, `danger`. Tokens resolve to CSS variables the host theme sets
(`--sdui-color-<name>`). Weights are names (`ultralight` … `black`); sizes and radii
are numbers (px). Anything unrecognized is ignored.

### Field patterns

`pattern` names a validator built into the client — never a regex from the
payload: `numeric`, `alphanumeric`, `email`, `phoneId` (Indonesian mobile),
`amount` (positive number, up to 2 decimals), `pin6` (6 digits), `nik` (16 digits).
An unknown name fails the field closed.

`secure: true` fields (PIN, OTP) are never logged, cached, or placed in the data
context outside their form; a WebView host may take them over with native input.

## Actions

| `type` | Required | Optional | Effect |
| --- | --- | --- | --- |
| `navigate` | `screen` | `params`, `presentation` `push`·`sheet`·`fullScreen` (v1.1) | host navigator |
| `api` | `request` | `params` | named request → response merged into data under the request name |
| `dismiss` | — | — | close / pop |
| `refresh` | — | — | reload the screen |
| `openURL` | `link` | — | host maps the **name** to a URL after its allow-list |
| `toast` (v1.1) | `message` | `level` `info`·`success`·`warning`·`error` | transient message |
| `native` (v1.1) | `command` | `params` | host command allow-listed by the app; result merged under the command name; unsupported → `onError` |

Every action may carry `onSuccess` / `onError` (linear chain, max depth 4). String
`params` may be `{{token}}`s; a param that is exactly one token keeps the value's
type. Inside a `form`, a button runs the form's field validation first and only
dispatches when it passes.

## Data and tokens

`{{a.b}}` resolves against the screen's data context: navigation params seed it,
`api` / `native` / `load` results merge in under their names, a `form` adds
`form.<field>`, a `list` row adds `<as>`. Missing tokens render as empty strings;
while a `load` request is pending, text whose tokens are still missing renders as a
loading placeholder.

## `screen.load`

All entries run in parallel once the payload is verified (also when served from
cache). Each result merges under its request name; a failed request marks
`$load.<request>` = `"error"` and the rest of the screen still renders.

## Variants

`variants.compact` (< 600 px) and `variants.wide` (≥ 600 px) replace `root` at that
width when present; `root` is the fallback.

## Fixtures

`fixtures/valid` must pass the schema and the client validator; `fixtures/invalid`
must be rejected by the schema. `npm test` runs both (`tests/spec.test.ts`).
