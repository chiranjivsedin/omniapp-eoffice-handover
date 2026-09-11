# Client point 1 — worklist grid fixes (handover)

Two independent changes to the Newgen **iBPS OmniApp 6.0 SP0** (Hotfix `iBPS_6.0_SP0_00_001`)
`webdesktop` application. Both were built and verified against a local replica of the prod server —
same WAR, same `webdesktop.ini`, same shared database.

Apply them in this order. **Folder 1 can ship on its own; folder 2 depends on nothing but works
best with folder 1** (see "How the two interact" below).

---

> **Just deploying this?** Read **`APPLY.md`** — the steps, on one page. Everything below is
> background: what each folder is, how the two fixes interact, and the risks.

## What the client asked for, and what each folder delivers

| client point | status |
|---|---|
| File number shown truncated (`BL/ENOTES/CS/HO/CAPEX/TEST/202...`) | **fixed** — folder 1 |
| Column resizing | **added** — folder 2 (custom development, see caveats) |
| Sorting | already worked; unchanged. **But** only columns configured as sortable can be sorted, and today no queue-variable column is (`SortFlag=N` in the queue config). Enabling it is configuration, not code — not included here. |

---

## Folder 1 — `1-file-number-fix/`  ← lower risk, ship first

| file | what it is |
|---|---|
| `PROD-PATCH-FILENUMBER.md` | **read this first.** Full instructions, root cause, verification, rollback. |
| `apply-filenumber-fix.ps1` | tested script that applies both parts and can roll them back |
| `LOCAL_DEV_QVAR_ONELINE.css` | the CSS block, for reference / manual application |

**Two changes:**

1. `webdesktop.ini` line 88 — `EnableWordWrapForQVar=N` → `Y`. **A supported Newgen setting**, one
   byte. This is the actual fix: the truncation is done server-side by a hardcoded 30-character
   limit in `WDWorkitemList.class`, so no column width or stylesheet change can undo it.
2. `webdesktop.war` — append `LOCAL_DEV_QVAR_ONELINE.css` to `resources/<locale>/css/stylesheet.css`
   (18 locale copies; English alone is enough if only English is used). This puts the value on one
   line and caps a single long value at 320px so it cannot stretch the grid.

**Quick start** (as Administrator, on the app server, with JBoss stopped):

```powershell
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -WhatIf    # dry run
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4            # apply
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -Rollback  # undo
```

Then a **full JBoss stop + start** (not `jboss-cli :reload`) and a **hard browser refresh**
(Ctrl+Shift+R) — the old stylesheet is cached, and without the refresh it will look unchanged.

Tested: apply → re-run (no-op) → rollback returns both files byte-identical to the originals.

---

## Folder 2 — `2-column-resize/`  ← custom development, higher risk

| file | what it is |
|---|---|
| `COLUMN-RESIZE.md` | **read this first.** How it works, verification results, known risks. |
| `wlist-columnresize.js` | the code — append to `resources/scripts/wlist.js` inside `webdesktop.war` |

**One file changes:** `resources/scripts/wlist.js` inside `webdesktop.war`.
Append `wlist-columnresize.js` to the **end** of it — nothing existing is modified.

```
pristine wlist.js (73,343 bytes) + wlist-columnresize.js (20,084 bytes) = 93,004 bytes
```

No view, config or descriptor change is needed: `workitemlist.xhtml` already loads `wlist.js`, and
the CSS is injected by the script itself.

**Start from a pristine WAR.** Grep for `LOCAL_DEV_COLUMN_RESIZE` first — if it is already present,
stop, or the block will be appended twice and run twice.

**What it gives users:** drag a column border to resize; a divider marks each resizable boundary and
highlights on hover; double-click a divider to auto-fit; hover shows the full value. Widths are
per-session and reset on reload (no persistence, by agreement).

**Be aware:** Newgen has **no column-resize feature** — this is custom JavaScript inside a vendor
artifact. It therefore **must be re-applied after any Newgen upgrade or hotfix** that replaces
`webdesktop.war`, and it relies on internal DOM ids (`wlf:pnlResult`, `td.wl`) that a future
release could change without notice. It also switches the grid to `table-layout: fixed` — if grid
sizing ever looks wrong, suspect this first.

---

## How the two interact

Folder 1's CSS caps a value at **320px**. Folder 2 sets `max-width: none` inside a resizable table,
which **releases that cap when a column is dragged** — so the grid stays tidy on load and the full
value is still reachable.

| deployed | behaviour |
|---|---|
| folder 1 only | one line, capped at 320px, ellipsis + hover tooltip. No dragging. Fine. |
| folder 2 only | resizing works; there is no cap to release. Fine. |
| **both (intended)** | capped on load, drag to reveal the whole value. Best. |

Either can ship independently. Do **not** remove folder 2's `max-width: none` rule while folder 1's
cap is in place, or dragging will look broken.

---

## Repacking the WAR — one trap

**`jar -uf` fails on these WARs** with `ZipException: invalid entry size`. Use the .NET zip API in
`Update` mode (what the script does) or fully extract and rebuild the archive.

---

## Testing before release

Both changes were verified on the local replica: file number complete on one line, resizing on
My Queue / EOFFICE / eoffice_Eoffice_Step2 / eoffice_Start Event_4 with real mouse drags, sorting
still toggling correctly, and a real 198-character subject capped on load then fully revealed by
dragging.

Still worth exercising in UAT: **paging and column reordering**, and any queue not listed above.

---

## Rollback

Folder 1: `apply-filenumber-fix.ps1 -Rollback`, or restore `webdesktop.ini` and `webdesktop.war`
from the timestamped backups the script writes beside each file.

Folder 2: restore `webdesktop.war` from a pristine copy. **Note that also removes folder 1's CSS**,
since both live in that WAR — re-apply folder 1 afterwards if you only meant to remove the resizing.

Either way, finish with a full JBoss stop + start.
