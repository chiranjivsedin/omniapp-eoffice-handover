# Prod patch — file number truncated in worklist grids

**Issue:** in Inbox / Pending Items / Sent Items / search queues, long values such as the file
number are cut off — `BL/ENOTES/LC/KOL/AN/TESTING/20...` — so users cannot identify a work item
without opening it.

**Fix:** 2 changes, both on the app server. **No database change. No Java/vendor code change.**

**Product:** Newgen iBPS OmniApp (OAP) 6.0 SP0, Hotfix `iBPS_6.0_SP0_00_001`, app `webdesktop`.

**Status:** implemented and verified on a local replica of the prod server (same WAR, same
`webdesktop.ini`, same shared DB). Not yet applied to prod.

---

## 1. How many files

| # | Artifact | Files touched | Nature of change |
|---|---|---|---|
| 1 | `webdesktop.ini` | **1 file, 1 line** | flip `EnableWordWrapForQVar` from `N` to `Y` |
| 2 | `webdesktop.war` | **18 files inside the WAR** — `resources/<locale>/css/stylesheet.css` | append a ~10-line CSS block to each |

Change 2 is 18 files only because the stylesheet is duplicated per locale
(`ar, ar_sa, de, en_us, es, es_do, fr, fr_fr, nl, pt, th, vi, zh_cn, zh_hans_cn, zh_hant_hk,
zh_hant_tw, zh_hk, zh_tw`). It is the *same* block in each. **If the client only uses English,
patching `resources/en_us/css/stylesheet.css` alone is sufficient** — the other 17 are for
future-proofing.

**Change 1 is the actual fix.** Change 2 is cosmetic — see §3.

---

## 2. Exact paths on prod

Verified on `74.225.130.20` (read-only inspection):

```
C:\jboss-eap-7.4\bin\Newgen\NGConfig\omniflowconfiguration\webdesktopconf\webdesktop.ini
C:\jboss-eap-7.4\standalone\deployments\webdesktop.war
```

Pre-flight checks — confirm these match before patching, so you know you have the baseline
this was developed against:

| File | Expected |
|---|---|
| `webdesktop.ini` | **8,252 bytes**, line **88** = `EnableWordWrapForQVar=N` |
| `webdesktop.war` | **29,685,714 bytes** |

Do **not** patch `webdesktop_Bkp.ini` — that is Newgen's own backup copy; leave it at `N`.

---

## 3. Root cause (why "just widen the column" does not work)

This was the obvious first assumption and it is wrong, so it is worth stating plainly:
**the truncation is not CSS and not JavaScript.** The shortened string is already in the HTML the
server sends, with the full value in the `title` attribute (that is where the existing hover
tooltip comes from):

```html
<label title="BL/ENOTES/LC/KOL/AN/TESTING/2026-27/8">BL/ENOTES/LC/KOL/AN/TESTING/20...</label>
```

Decompiling `WDWorkitemList.class` (`webdesktop.war!/WEB-INF/classes/com/newgen/wfdesktop/components/workitemlist/`)
gives the logic applied to every queue-variable cell:

```java
boolean bWrap = "Y".equalsIgnoreCase(
        WDCabinetList.getConfValue(cabinet, "EnableWordWrapForQVar", "N"));   // default N
...
int len = value.length();
if (bWrap && len > 30) {
    needsWrapPanel = true;                                     // keep the FULL value
} else {
    label.setTitle(value);                                     // the tooltip
    if (len > 30) value = WDUtility.getShortName(value, 30);   // the truncation
}
```

The limit `30` is a **hardcoded constant compiled into the class** (`bipush 30`, three call
sites). It is not a column width, not a stylesheet, and not configured in
`WFWorkListConfigTable`. So widening the column would have produced a wider column still showing
`...`.

Setting `EnableWordWrapForQVar=Y` takes the other branch, which renders the **complete** value
inside a wrap div produced by `createWordWrapDiv()`:

```
width: 150px; word-break: break-word; word-wrap: break-word; white-space: normal;
```

That alone fixes the data-loss problem, but the value wraps onto 2 lines in a 150px column.
Change 2 restores it to a single line. Because that `width: 150px` is an **inline** style with no
id or class to hook, overriding it requires `!important` and a `[style*=...]` selector.

---

## 4. Change 1 — `webdesktop.ini`

Line 88: `EnableWordWrapForQVar=N` → `EnableWordWrapForQVar=Y`

Edit in place; the file is CRLF, keep it that way (a tool that rewrites line endings will change
the file length — the patched file must still be **8,252 bytes**).

## 5. Change 2 — CSS block

Append to the **end** of `resources/<locale>/css/stylesheet.css` inside `webdesktop.war`
(`components/workitem/workitemlist.xhtml:12` loads `#{WDGEN.Path}/css/stylesheet.css`):

```css
/* ===== LOCAL_DEV_QVAR_ONELINE ===================================================== */
td.wl > div[style*="word-break: break-word"] {
    width: auto !important;
    max-width: 320px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}
td.wl > div[style*="word-break: break-word"] > label {
    white-space: nowrap !important;
}
/* ===== end LOCAL_DEV_QVAR_ONELINE ================================================= */
```

(The block in `apply-filenumber-fix.ps1` carries the full explanatory comment; the rules
above are the operative part.)

**Two things in that CSS are load-bearing, both learned the hard way:**

- **`max-width: 320px`** caps how far one long value can stretch the grid. 320px is
  measured, not guessed: the longest real file number renders at **294px**, so a file
  number still shows in full on one line, while a longer value (a 198-char subject was
  tested) stops at 320px with an ellipsis and a tooltip. **Without the cap** that subject
  produced a **1142px** column and a **3061px** table in a ~1030px viewport, pushing every
  other column off screen.
- **`white-space: nowrap` must stay.** Once the table overflows, the browser collapses
  columns to their minimum content width. Dropping nowrap squeezed a column to **59px** and
  grew the row to **691px** tall.

Also rejected: removing the width override to keep the deployed app's own column widths.
That re-truncates the file number (`BL/ENOTES/GL/ARL/AN/T...`) — i.e. it hands the original
complaint straight back.

The `LOCAL_DEV_QVAR_ONELINE` marker makes the change greppable and reversible later.

> **Repacking the WAR:** `jar -uf` **fails** on these WARs with
> `ZipException: invalid entry size`. Use the .NET zip API in `Update` mode (that is what the
> script below does), or fully extract and rebuild the archive.

---

## 6. Recommended: use the tested script

`scripts/apply-filenumber-fix.ps1` (accompanies this document) performs both changes, is
idempotent, and can roll itself back. It has been tested end-to-end against a copy of the
prod artifacts: apply → re-run (no-op) → rollback returns both files **byte-identical** to the
originals.

Run **as Administrator, on the app server, with JBoss stopped**:

```powershell
# 1. dry run - shows what would change, touches nothing
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -WhatIf

# 2. apply
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4

# only the .ini change (accept 2-line wrapping, skip the WAR entirely)
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -SkipCss

# undo
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -Rollback
```

It writes its own timestamped backups (`*.pre-filenumberfix-<timestamp>`) beside each file
before touching anything, and refuses to run if the expected `EnableWordWrapForQVar=N` line is
not found exactly once. Take your own backup of both files as well.

---

## 7. Restart

**Full stop + start of JBoss.** Do **not** use `jboss-cli :reload` — on this stack a reload
shuts down the `java:/fosasoft` connection pool (`IJ000470`) and every subsequent login fails
with "Please try after some time", with nothing useful in `server.log`.

The config value is read per render path from the cabinet config, so a restart is required for
change 1; change 2 is a static resource inside the WAR, so it needs the redeploy that the
restart performs.

---

## 8. Verification

After the restart, **hard-refresh the browser (Ctrl+F5)** — the old stylesheet is cached.

1. Log in and open a queue that shows a long file number (e.g. E Office → search
   `Registration No` / `eNotes`, or Inbox).
2. The `filenumber` column should show the complete value **on one line**, with no `...`, and the
   column should be visibly wider.

To confirm from the markup rather than by eye, inspect the cell (F12):

| | markup |
|---|---|
| **not fixed** | `<label title="BL/…/2026-27/8">BL/ENOTES/LC/KOL/AN/TESTING/20...</label>` |
| **change 1 only** | `<div style="width:150px;word-break:break-word;…"><label>BL/ENOTES/LC/KOL/AN/TESTING/2026-27/8</label></div>` — full value, 2 lines |
| **both changes** | same div, computed `white-space: nowrap`, `width: auto` — full value, 1 line |

Measured on the local replica: the value went from 33 rendered chars (truncated) to the full 37,
and the `filenumber` column from **174px → 267px**, sizing itself.

---

## 9. Scope, side effects and risk

- **Both changes are cabinet-wide, not per-column.** They apply to every queue-variable column in
  every worklist — `subject`, `nominees`, etc., not just `filenumber`. That is arguably desirable
  (those columns hit the same 30-char limit), but it *is* a visual change across all grids and
  should be shown to the client. Scoping it to `filenumber` alone is possible but needs JS that
  matches on header text, since the markup carries no column identity.
- **Long values now widen the grid rather than truncating**, so a wide grid scrolls horizontally.
  The current prod app already scrolls horizontally on these grids, so this is not new behaviour.
- **The hover tooltip disappears on wrapped cells.** `setTitle()` is only called on the truncating
  branch (see §3). It is redundant once the full value is visible.
- **No data is at risk.** Change 1 only affects rendering; change 2 only affects layout of a value
  that is already complete in the DOM.
- **Change 1 is a supported product setting** shipped by Newgen in `webdesktop.ini`, not a hack.
  Change 2 is a customisation of a vendor artifact — worth noting against the support agreement,
  and it must be **re-applied after any hotfix or upgrade that replaces `webdesktop.war`**. The
  `LOCAL_DEV_QVAR_ONELINE` marker makes it easy to check whether it is still present.
- **`webdesktop.ini` is not replaced by hotfixes** in the same way, but confirm line 88 after any
  Newgen patch.

---

## 10. Rollback

```powershell
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -Rollback
```

or manually: restore `webdesktop.ini` and `webdesktop.war` from your backups, then full stop +
start. Reverting only the WAR leaves change 1 active — the value stays complete but wraps onto
2 lines, which is a reasonable fallback if the single-line layout causes a problem.

---

## 11. Not included

Two further items from the client's feedback were analysed but are **not** part of this patch:

- **Column resizing / sorting.** Sorting already works. Column *resizing* does not exist in the
  product — there is no resize code anywhere in `webdesktop.war` — so it would have to be built
  as a custom JS feature, with a decision on where per-user widths are stored
  (browser `localStorage`, or `USERPREFERENCESTABLE` in the shared DB).
- **Colour scheme for pending / in-progress / completed work items.** Driven by
  `WFQueueColorTable` conditional rules plus colour keys already present in `webdesktop.ini`
  (`DefaultColor`, `HoldColor`, `ExitColor`, `Task_*`). Under analysis.
