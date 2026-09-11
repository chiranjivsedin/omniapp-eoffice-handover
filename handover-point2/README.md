# Row colours by work-item state — how to apply

Colours each worklist row so you can tell items apart at a glance:

| Workitem State | Colour |
|---|---|
| `NOTSTARTED` | amber |
| `RUNNING` | blue |
| `COMPLETED` / `EXITED` | green |

A pale row tint plus a thin coloured bar down the left of the row.

**One file, one WAR, append only.** Nothing is replaced.

---

## Steps

1. Back up `webdesktop.war`.
2. Open `webdesktop.war` → `resources/scripts/wlist.js`.
3. Paste the whole of `wlist-statecolour.js` at the **end** of that file.
4. Redeploy the WAR and **fully stop and start** the server (not a reload).
5. Open a worklist and press **Ctrl+F5** (the browser caches scripts).

> Repack the WAR with a proper zip tool. `jar -uf` fails on these files with
> `ZipException: invalid entry size`.

**If that WAR already has other patches appended to `wlist.js`** (e.g. the column-resize script
from the point 1 handover), just append this after them. Order does not matter between the two,
but do not paste it into the middle of another block.

## How to undo

Delete everything from `/* ==========` above `LOCAL_DEV_STATE_COLOUR` down to
`/* ===== end LOCAL_DEV_STATE_COLOUR ... */`, and redeploy.

---

## Changing the colours or the column

Everything you would want to change is at the top of the file:

- `STATES` — the state text and the class it maps to. Add or rename values here.
- `HEADER_RE` — which column is read. It is currently `/workitem\s*state/i`, i.e. the column
  headed "Workitem State". Point it at a different column by changing this.
- The colours are in `injectStyle()`, as `#fff5e8` / `#eaf2fd` / `#eaf7ef` for the tints and
  `#f29900` / `#1a73e8` / `#1e8e3e` for the bars.

---

## Things worth knowing before you ask

**Why this is JavaScript and not configuration.** The product colours rows using *alias rules*,
which colour by the value of a **queue variable**. Work-item state is not an aliasable variable, so
no alias rule can express "colour by RUNNING / NOTSTARTED". The only built-in that reacts to state
is `ExitColor` in `webdesktop.ini`, and it paints completed rows only. Colouring by **stage** was
tried and abandoned — a stage is *where* an item is in the process, not whether it has started, so
every row came out the same colour.

**It reads the screen, not the database.** The state is already displayed in the "Workitem State"
column; the script reads that text. It adds no server call and no query.

**A view with no "Workitem State" column shows no colours.** That is deliberate — the script does
not guess. The Sent Items list, for example, shows `Stage` instead, so it stays uncoloured. To
colour those views, either add the Workitem State column to them, or point `HEADER_RE` at the
column they do show.

**`COMPLETED` will rarely appear**, because finished work items leave the queue. The mapping exists
so that a view which does show them colours correctly.

**It is safe by design.** The script only reads a column that is already on screen and sets row
colours. Everything is inside `try/catch`, so the worst case is a row that is not tinted — not a
broken grid. It finds the column by header text rather than position, so reordering or hiding
columns cannot make it colour the wrong thing.

**It re-applies itself.** The grid rebuilds its own rows on paging, sorting and refresh, so the
script watches the page and re-colours after each change.

**This is a vendor-WAR patch**, so it must be re-applied after any redeploy or hotfix of
`webdesktop.war`.
