# Landing tile UI — how to apply

Makes the four E-Office count tiles (Created By / My Inbox / Sent Items / Draft) look like
cards instead of flat coloured blocks.

**This is CSS only.** No Java, no JSP, no JavaScript. Nothing is replaced — you only **append**
a block of CSS to the end of files you already have.

---

## What you change

Two WARs, because one tile is made of two pages: the frame comes from `omniapp.war`, the
coloured inside comes from `webdesktop.war`.

| # | WAR | File to append to | CSS to append |
|---|-----|-------------------|---------------|
| 1 | `omniapp.war` | `resources/<locale>/css/stylesheet.css` | `1-omniapp-war/omniapp-tile-frame.css` |
| 2 | `webdesktop.war` | `resources/<locale>/css/stylesheet.css` | `2-webdesktop-war/webdesktop-tile-card.css` |

There is one `stylesheet.css` per locale (18 of them). Do **all** locales, or at least the ones
your users actually use — `en_us` is the usual one.

---

## Steps

1. Take a backup of both WARs.
2. Open `omniapp.war` → `resources/en_us/css/stylesheet.css`.
3. Paste the whole contents of `1-omniapp-war/omniapp-tile-frame.css` at the **end** of it.
4. Repeat step 3 for every other locale folder in `omniapp.war`.
5. Do the same with `2-webdesktop-war/webdesktop-tile-card.css` into `webdesktop.war`'s
   `resources/<locale>/css/stylesheet.css`.
6. Redeploy both WARs and **fully stop and start** the server (not a reload).
7. Open the landing page and press **Ctrl+F5** (the browser caches CSS).

> Repack the WAR with a proper zip tool. `jar -uf` fails on these files with
> `ZipException: invalid entry size`.

### Or use the script

`apply-tile-card.ps1` does all of the above on a local WildFly install:

```powershell
.\apply-tile-card.ps1 -WhatIf     # show what it would change
.\apply-tile-card.ps1             # apply to every locale in both WARs
.\apply-tile-card.ps1 -Rollback   # remove it again
```

It expects the WARs in `..\jboss\wildfly-23.0.2.Final\standalone\deployments`; edit the
`$deploy` line if your path differs. Safe to run twice — it removes its own old block first.

---

## How to undo

Delete everything between `/* ===== LOCAL_DEV_TILE_CARD` and
`/* ===== end LOCAL_DEV_TILE_CARD ... */` in each file, or run the script with `-Rollback`.

---

## Two things to know before you ask

**1. Font sizes are not in this CSS — set them in the vendor panel.**
The tile label and count get their size from configuration, not from these files. Change them in
**Business Admin → Criteria Visualisation** for each tile:

- `filterFontSize` — the label ("Created By Me")
- `filterCountFontSize` — the number

The layout puts the number under the label, so making the number bigger there is what gives it
the "headline figure" look. We deliberately left this to config so the CSS does not fight it.

The small heading above ("E-OFFICE CREATED BY") is the exception — it is sized in the CSS,
because the product stores a `headFontSize` for it but never applies it.

**2. Tile widths are not changed and cannot be changed from CSS.**
Created By and Sent Items are wider than My Inbox and Draft. Every tile wrapper is
`position: absolute` and the dashboard's JavaScript decides where each one goes, so making one
tile wider in CSS just overlaps the next. To make them equal, change each tile's **component
width** in the layout configuration so the JavaScript lays them out on the new sizes.

---

## Notes

- Needs a current browser (Chrome/Edge/Firefox). The rules use the `:has()` selector; on an old
  browser they are simply ignored and you get the original tiles back — nothing breaks.
- The rules are deliberately scoped to the tile pages. Do not remove the
  `:has(#tileContainerDiv...)` part of a selector: `webdesktop.war`'s `stylesheet.css` is loaded
  by every screen, and unscoped these rules break the worklist's "My Queue" toolbar.
- If the "My Inbox" tile shows no heading, that is its criteria name being blank in
  configuration, not a CSS problem.
