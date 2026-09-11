# Point 1 — how to apply

Two fixes to the worklist grid:

1. **File number no longer cut short** at 30 characters — it shows in full, on one line.
2. **Columns can be dragged to resize**, with double-click to fit the content.

Fix 1 is a supported product setting plus a stylesheet addition. Fix 2 is a custom script.
Everything is **appended** — no product file is edited in place.

Ship fix 1 first; it is the client's actual complaint and the lower risk of the two.

---

## Fix 1 — file number

| # | What | Where |
|---|---|---|
| 1 | `EnableWordWrapForQVar` `N` → `Y` | `webdesktop.ini` (line 88) |
| 2 | Append `1-file-number-fix/LOCAL_DEV_QVAR_ONELINE.css` | `webdesktop.war` → `resources/<locale>/css/stylesheet.css` |

Step 1 is the real fix — the truncation happens on the server, so no column width or stylesheet
change alone can undo it. Step 2 keeps the full value on one line and caps a single very long value
at 320px so it cannot stretch the grid.

There is one `stylesheet.css` per locale (18). English alone is enough if only English is used.

**Or use the script** (as Administrator, on the app server, with JBoss stopped):

```powershell
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -WhatIf    # dry run
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4            # apply
.\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -Rollback  # undo
```

Tested: apply → re-run (does nothing) → rollback returns both files byte-identical.

---

## Fix 2 — column resizing

Append `2-column-resize/wlist-columnresize.js` to `webdesktop.war` →
`resources/scripts/wlist.js`.

Widths last for the session only. The product has nowhere to store a per-user width, so they reset
on next login — that is a limitation, not a bug.

**Apply fix 1 before fix 2.** The two touch the same column sizing, and fix 2 expects fix 1 to be
in place; the long notes explain why.

---

## Finishing either fix

1. Repack the WAR with a proper zip tool. `jar -uf` fails on these files with
   `ZipException: invalid entry size`.
2. Redeploy, then **fully stop and start** the server — not `jboss-cli :reload`.
3. **Hard-refresh** the browser (Ctrl+Shift+R). Without it the old stylesheet is cached and nothing
   looks changed.

## How to undo

Delete the appended block — each one is wrapped in a comment naming it
(`LOCAL_DEV_QVAR_ONELINE`, `LOCAL_DEV_COLUMN_RESIZE`) — and set `EnableWordWrapForQVar` back to
`N`. Or run the script with `-Rollback`.

---

## Two things to expect

- **These are patches inside the product's own files.** They must be re-applied after any upgrade
  or redeployment of `webdesktop.war`.
- **Sorting already works** on every column the product marks sortable. Making *File number*
  sortable is a separate configuration change plus a database index — not included here.

## If you need the detail

`1-file-number-fix/PROD-PATCH-FILENUMBER.md` and `2-column-resize/COLUMN-RESIZE.md` are the full
engineering notes: root cause, what was measured, bugs found while testing, and known risks. Read
them if something behaves unexpectedly — they are background, not instructions.
