# Worklist column resizing — implementation notes

**Status: proof of concept. Works and is tested, but NOT ready for prod.** It lives only on the
branch `feature/column-resize`; `master` deliberately does not contain it. Read §8 before
proposing to ship it.

Built for **client point 1**, third part: "can we provide column resizing". Sorting already worked;
resizing did not exist.

---

## 1. What it does

- **Drag** the right edge of any column header to resize it.
- **A 1px divider** on each resizable column boundary at rest, so the feature is discoverable —
  it thickens to a 2px bar with a tinted grab zone on hover/drag.
- **Double-click** a divider to auto-fit the column to its widest value (min 40 px, max 600 px).
- **Tooltip** on the grip: "Drag to resize — double-click to fit contents".
- **Widths survive** paging, sorting, search and ajax refresh **within the page**.
- **No persistence** (as agreed): widths are gone on reload. Nothing is written to `localStorage`,
  cookies, or the database.

Dividers appear **only on resizable columns** — not the leading icon columns, not the trailing
spacer — so the affordance itself indicates what can be resized. Header row only; data rows are
visually untouched.

---

## 2. Files changed

**One file inside one WAR.**

| | |
|---|---|
| Patched | `resources/scripts/wlist.js` inside `webdesktop.war` |
| Size | pristine **73,343** → patched **93,004** bytes with LF endings (a 19,661-byte appended block; `.gitattributes` `* text=auto` converts it on checkout, so the on-disk size varies by 372 bytes = one CR per line. Content is identical either way — verified byte-for-byte ignoring CR/LF against the deployed WAR.) |
| WAR | pristine 29,685,714 → **~29,703,000** bytes (this also includes the entry-5 CSS patch) |
| Marker | `LOCAL_DEV_COLUMN_RESIZE` |
| Readable source | `_patch5/wlist-columnresize.js` (the block alone)<br>`_patch5/resources/scripts/wlist.js` (the whole served file) |

`wlist.js` was chosen because `components/workitem/workitemlist.xhtml` already loads it, so no view
or descriptor change is needed. All CSS is injected by the script itself as a `<style id="ldcr-style">`,
which keeps the change to a single file.

> A `.war` is binary and gitignored, so **git shows no diff for the WAR**. The reviewable record is
> `_patch5/`. See `CHANGES-LOCAL.md`.

---

## 3. The grid we are patching is 100% vendor code

Worth stating plainly, because it drives every design decision and every risk:

- The grid is rendered **server-side by `WDWorkitemList.class`** (Newgen, in
  `webdesktop.war!/WEB-INF/classes/com/newgen/wfdesktop/components/workitemlist/`), which builds
  JSF components programmatically (`HtmlPanelGrid`, `HtmlOutputLabel`).
- **Columns come from `WFWorkListConfigTable`** in the DB, per queue. This is why "the FileNumber
  column" appears nowhere in the WAR as code.
- `wlist.js`, `wdgeneral.js`, `workdesk.js` and the stylesheets are all vendor files.

So every id and class we hook is a Newgen **internal**, not a published contract. There was no
resize feature to switch on: there is no resize implementation anywhere in `webdesktop.war`
(`tablegenerator.js`'s drag handling only *reorders* dashboard cells).

### Facts established by probing the live grid

| | |
|---|---|
| Grid table | `table#wlf:pnlResult` |
| Header cells | `TH`, class `wdwidth1 toolbarbgcolor tableheader`, `position: static` |
| `<colgroup>` | **none** — so widths must go on the `TH`s |
| Sorting | bound to the TH's **inner `<label>`** `onclick="sbf(this,N)"`, *not* the TH |
| Scroll container | `div#scroll.scrollTableContainerDataViewTable`, already `overflow-x: auto` |
| Trailing column | a `wdwidth100` spacer — layout, not data |
| Leading columns | 4 narrow icon columns with no header text |
| Hidden payload | `label#wlf:hop*` and `label#wlf:hjn*` hold the whole record (518 chars) |

---

## 4. How it works

1. **Freeze then fix.** The table is `table-layout: auto`; one drag under `auto` reflows every
   column. So current widths are written onto the `TH`s and the table is switched to
   `table-layout: fixed`, making those widths authoritative.
2. **Grips.** A `div.ldcr-grip` is appended to each resizable TH (`position: absolute; right: 0`),
   8 px wide, `cursor: col-resize`.
3. **Drag.** `mousedown` on the grip records the start X plus the TH and table widths; `mousemove`
   on `document` (capture) sets the new TH width and adjusts the table width by the same delta, so
   **other columns keep their widths** and the container simply scrolls; `mouseup` cleans up.
4. **Auto-fit.** Under `table-layout: fixed` a cell cannot report its natural content width, so the
   strings are measured off-screen in each cell's own font, and the widest wins.
5. **Re-render.** The grid is replaced wholesale on paging/sorting/search; a `MutationObserver` on
   `document.documentElement` plus a 2 s poll re-attaches grips and re-applies remembered widths.
6. **Widths map.** Keyed by **header text**, not column index, so a width follows its column across
   re-render and column reordering.

### Decisions that are load-bearing

- **The grip must sit on the `TH`, not the label**, and must `stopPropagation()` on its own
  `mousedown`/`click`/`dblclick` — otherwise every drag would also re-sort the column.
- **`box-sizing: border-box` on th/td**, and the table is marked `ldcr-on` *before* widths are
  measured. Without this, `style.width` set from `offsetWidth` (which already includes padding and
  border) is inflated by them a second time — observed as 267 → 291 px and table 1843 → 2283 px.
- **The grip is at `right: 0`, never a negative offset.** This patch puts `overflow: hidden` on
  cells; a grip straddling the edge has its protruding half clipped and **fails hit-testing** — see §7.
- **Auto-fit skips labels that have an `id`.** `wlf:hop*` / `wlf:hjn*` are hidden payload holding
  the entire record; measuring them would push every column to the 600 px ceiling.
- **Colours are translucent mid-grey** (`rgba(128,128,128,…)`), not a fixed hex, because colours
  come from the Newgen theme (`toolbarbgcolor`) and a hardcoded value would clash on some themes.
- **Everything is wrapped in `try/catch`.** If any of this fails, the grid must still behave exactly
  as it does today.

### Interaction with the file-number fix (entry 5) — the two patches are COUPLED

Entry 5 puts queue-variable values on one line and **caps them at `max-width: 320px`** so a single
long value cannot stretch the grid. This patch has to deal with both halves of that:

- Under `table-layout: fixed`, a narrowed column would let the value overflow into its neighbour,
  so in resize mode the div is constrained back into the cell with `overflow: hidden` plus an
  ellipsis, and a `title` tooltip is added so a shrunken column stays readable.
- **This patch sets `max-width: none` inside `table.ldcr-on`**, releasing entry 5's 320px cap. That
  is required: without it the div stayed pinned at 320px and dragging a column wider still showed an
  ellipsis, no matter how far you dragged. The initial 320px is preserved regardless, because widths
  are measured *before* `ldcr-on` is applied.

**Deployment consequences:**

| deployed | behaviour |
|---|---|
| entry 5 only | values on one line, capped at 320px, ellipsis + tooltip. No drag. Fine. |
| this patch only | resizing works; nothing to release, since no cap exists. Fine. |
| both (intended) | capped on load, drag to reveal the full value. Best. |

Either can ship independently, but **do not remove the `max-width: none` rule from this patch while
entry 5's cap is in place**, or dragging will appear broken.

Verified with the real 198-char subject on `e-Notes-20`: capped at 344px on load, and at 1744px
after dragging the whole value is visible (`scrollWidth == clientWidth`).

---

## 5. Verification

Tested against the live local app as `user2`, in the same "My Search Queue" grid as the client's
screenshot (E Office → `Registration No` / `eNotes` / `8`).

| check | result |
|---|---|
| grips attached | 16 |
| `table-layout` | `fixed` |
| widen by drag | 267 → **407 px** (table 1843 → 1983) |
| shrink by drag | → **187 px** |
| other columns unchanged | yes |
| drag does **not** sort | yes (`D` → `D`) |
| header click still sorts, width kept, grips re-attached | yes — 407 px kept, 16 grips |
| drag state cleaned up | yes |
| dividers at rest | 16, `1px solid rgba(128,128,128,0.45)` |
| hover thickens to 2 px + tints | yes |
| shrink then double-click auto-fit | 267 → 147 → **301 px**, full value shown |
| auto-fit does **not** sort | yes (`D` → `D`) |

**Drags were performed with a real mouse** (`page.mouse.down/move/up`), not synthetic events. This
mattered — see §7.

### Across grids (2026-09-08)

| queue | rows | grips | real-mouse drag |
|---|---|---|---|
| My Queue | 15 | 10 | 148 → 258 px ✅ |
| EOFFICE (111) | 14 | 11 | 82 → 192 px ✅ |
| eoffice_Eoffice_Step2 (20) | 159 | 10 | 258 → 368 px ✅ |
| eoffice_Start Event_4 (16) | 57 | 10 | 368 → 478 px ✅ |
| BLEOFFICE_Reveiwer (231) | 0 | 0 | n/a — empty queue, nothing to resize |
| eNotes_Reveiwer (244) | 0 | 0 | n/a — empty queue, nothing to resize |

Different queues expose different column counts (10 vs 11 grips), so the patch adapts to each grid's
configuration rather than assuming a fixed set.

### Long values (2026-09-08)

Tested against a real 198-char eNotes subject (`e-Notes-20`), which is what exposed entry 5's
missing width cap:

| | file number | subject | table | row height |
|---|---|---|---|---|
| entry 5 without a cap | full 294px | **1142px** | **3061px** | 28px |
| **entry 5 capped at 320px (current)** | **full 294px** | 344px | 2263px | 28px |
| after dragging the subject wider | full | 1744px, **no ellipsis** | — | 28px |

See `CHANGES-LOCAL.md` entry 5a for the two variants that were tried and rejected.

### Freeze fidelity

The check was: capture the pinned widths, strip the patch's styling in-page so the browser
re-lays out with `table-layout: auto`, then compare. On the Sent Items grid every column
matched — **worst difference 0 px** across all 12 — with row height 28 px (single line). So the grid
renders identically to stock until a divider is touched.

**Note on behaviour, not a defect:** widths are keyed by header text and held for the page session,
so a column widened in one queue stays widened when switching to another queue that has a column of
the same name. Deliberate (consistency), but worth calling out in UAT notes.

### Reproducing

The probes that produced the numbers above were **deleted after verification** — see
`_login_test/README.md` for the approach and the traps if a regression ever needs chasing. The
short version: drive the app as `padmin` via User Desktop, use real mouse events rather than
synthetic ones, take coordinates from `ElementHandle.boundingBox()`, and capture screenshots at
3× device scale or a 1px divider will not show up.

### Manual test

Reload `http://127.0.0.1:8080/omniapp/` with **Ctrl+F5** (the old script is cached), open any
worklist, hover a column boundary, drag it, then double-click one.

---

## 6. Applying / rebuilding

The block is appended to the pristine `wlist.js`, so the patched file can always be rebuilt from
scratch rather than patched incrementally:

```python
import io, zipfile
pristine = zipfile.ZipFile(r'_patch\backup\webdesktop.war.ORIG-BACKUP').read('resources/scripts/wlist.js').decode('utf-8')
block    = io.open(r'_patch5\wlist-columnresize.js', encoding='utf-8').read()
io.open(r'_patch5\resources\scripts\wlist.js', 'w', encoding='utf-8', newline='').write(pristine + block)
```

Then replace the entry in the WAR with the .NET zip API in `Update` mode — **`jar -uf` fails on
these WARs** with `ZipException: invalid entry size` — and do a **full stop + start** of WildFly
(never `jboss-cli :reload`).

**Revert:** restore `webdesktop.war` from `_patch/backup/webdesktop.war.ORIG-BACKUP`, then full
stop + start. Note this also removes entry 5's CSS, since both live in the same WAR.

---

## 7. Bugs found by testing

All four would have shipped otherwise. Recorded because they are easy to reintroduce.

1. **The MutationObserver watched a detached node.** It was bound to `div#scroll`, but the grid
   re-render replaces the scroll container *and* the table — so after a search it never fired again
   and grips were never re-attached. Fixed by observing `document.documentElement`, plus a poll.
2. **Widths inflated on init** (267 → 291, table 1843 → 2283): `style.width` set from `offsetWidth`
   in content-box terms. Fixed with `box-sizing: border-box` and by marking the table before measuring.
3. **The grip was not hit-testable.** At `right: -3px` it straddled a cell this patch gives
   `overflow: hidden`, so the protruding half was clipped and `elementFromPoint` at the grip's own
   centre returned the `TH`. **Synthetic events resized the column perfectly; only the real-mouse
   test failed.** Fixed with `right: 0` and an 8 px width.
4. **Tooltip detection could never fire.** It used `scrollWidth > clientWidth`, but the value sits
   in a `<label>` — `display: inline`, and inline elements report `scrollWidth: 0`. The title is now
   set unconditionally, which is what the stock truncating branch does anyway.

5. **Widths were measured under the wrong layout mode — and this one reached the user.** `init()`
   added the `ldcr-on` class *before* measuring, which applies `table-layout: fixed`; under fixed
   layout with no explicit widths the browser distributes columns roughly **equally** rather than by
   content. Those wrong widths were then pinned, so on first render a column could be squeezed to
   ~55 px and wrap its value over seven lines while space went unused beside it. **Introduced while
   fixing bug 2** (moving the class assignment above the measurement to make `box-sizing` apply).
   Fixed by measuring while the table is still `auto`, re-measuring after a 150 ms settle (the grid
   arrives by ajax and can still be laying out), and only then freezing — plus a guard so `init()`
   skips a grid with no data rows. Verified by capturing the pinned widths, stripping the patch's styling in-page so the
   browser re-lays out, and comparing: **0 px difference on every column**, row height back to a
   single line.

Also worth noting: an early test harness computed drag coordinates from `window.frameElement`, which
is wrong for a **nested** iframe. Use puppeteer's `ElementHandle.boundingBox()`, which returns
main-frame coordinates.

---

## 8. Known risks — read before shipping

This is the most fragile of the three changes made for client point 1, and materially more invasive
than the file-number fix.

1. **The CSS hook is brittle.** Both this and entry 5 match on
   `div[style*="word-break: break-word"]` — the vendor's **inline style string, including its
   spaces**. If a Newgen hotfix emits `word-break:break-word` or reorders those properties, the rule
   silently stops matching. No error; just the old behaviour back.
2. **We fight the vendor's rendering rather than extending it.** Newgen renders `table-layout: auto`;
   we force `fixed`. Newgen re-renders on every interaction; we chase it with an observer *and* a
   2 s poll. Needing a poll at all is a smell — it means we have no supported lifecycle hook.
3. **`table-layout: fixed` changes how the grid sizes itself**, which remains the main regression
   risk: columns no longer auto-size to content, they are frozen at first render (the full value is
   still in the DOM, with a tooltip and double-click auto-fit).
   *The ordering subtlety flagged here originally turned out to be a real bug — see §7 item 5. It is
   fixed, and freeze fidelity is now verified at 0 px against the browser's own layout.*
4. **Verified across grids** (2026-09-08): My Queue, EOFFICE, eoffice_Eoffice_Step2 and
   eoffice_Start Event_4, plus the eOffice Sent Items tile. Column reordering and paging are still
   worth exercising in UAT.
5. **It must be re-applied after any Newgen hotfix** that replaces `webdesktop.war`, indefinitely.
   Grep for `LOCAL_DEV_COLUMN_RESIZE` to check whether it is still present.
6. **Customising a vendor artifact is a support grey area.** Worth checking against the Newgen
   agreement before it reaches prod.

Deliberately **not** added to `PROD-PATCH-FILENUMBER.md` or `scripts/apply-filenumber-fix.ps1`:
those cover the low-risk file-number fix, and bundling this with them would put a safe fix at risk.

---

## 9. Open investigation — possibly a better route

We went straight to a manual patch. Several hints suggest **supported extension points exist**, all
visible in the `webdesktop.ini` we already edit:

- **`ShowCustomWorklist=N`** — the product appears to have a custom-worklist mode.
- **`UseWorklistConfiguration=N`** — suggests a worklist configuration mechanism, switched off.
- **`CodeFragment=N`**, and OmniApp ships a whole `manageapp/CodeFragments` module. If that is
  admin-managed custom JS/CSS stored in the DB, **this script could live there instead of inside a
  vendor WAR** — surviving hotfixes and deployable without repackaging.
- `omniapp.war` ships a **`resources/custom/`** directory — another likely sanctioned hook.
- **`components/workitem/view/definelayout.xhtml` is a stub** containing the placeholder
  `"hgwdfhjwhsjihcjhsj"`. A file called "define layout" being unfinished is suspicious — it may be a
  disabled or unlicensed product feature that does what the client asked for.
- **Is column resize native in a newer iBPS release?** We are on 6.0 SP0, which is old. If a later
  SP has it, the right answer is an upgrade and this code gets deleted.

If the `CodeFragments` route works we get the same feature with far less fragility. If a newer
release has it natively, none of this is needed.

---

## 10. Where it lives

Branch **`feature/column-resize`** (not on `master`, which holds only the safe-to-ship
file-number fix):

```
014730f  Make resizable columns visually discoverable, add double-click auto-fit
cd26dc6  Add drag-to-resize for worklist columns (session-only, no persistence)
```

Narrative and per-change history: `CHANGES-LOCAL.md` entries **6** and **6a**.
