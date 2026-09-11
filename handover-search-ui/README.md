# Search bar styling — how to apply

Makes the landing page below the tiles look tidier:

- the **search strip** and the **worklist panel** get rounded corners and a soft shadow, like the tiles
- the **dropdowns, search box, icon and Advanced Search button** get matching corners, a softer
  border, hover feedback, and space between them

**CSS only.** Nothing is replaced — you only **append** a block of CSS to files you already have.

---

## Steps

1. Back up both WARs.
2. In `omniapp.war`, paste `1-omniapp-war/omniapp-panel-card.css` at the **end** of
   `resources/<locale>/css/stylesheet.css`.
3. In `webdesktop.war`, do the same with `2-webdesktop-war/webdesktop-searchbar.css`.
4. Repeat for each locale folder (18 of them; `en_us` alone is enough if only English is used).
5. Redeploy both WARs and **fully stop and start** the server — not a reload.
6. Open the landing page and press **Ctrl+F5**; the browser caches stylesheets.

> Repack the WAR with a proper zip tool. `jar -uf` fails on these files with
> `ZipException: invalid entry size`.

**To undo:** delete the block you pasted — each is wrapped in a comment naming it
(`LOCAL_DEV_PANEL_CARD`, `LOCAL_DEV_SEARCHBAR`) — and redeploy.

---

## Two things to expect

**The controls stay the same size.** They are 22px tall, and the button's size is fixed in the page
itself, so a stylesheet cannot change it. Only colour, corners, border, spacing and hover change.

**Do not remove the `:has(...)` part of any selector.** `webdesktop.war`'s `stylesheet.css` is
loaded by every screen, and the search bar shares class names with the worklist. That prefix is
what keeps these rules on the search bar alone.

**Re-apply after any upgrade** — these blocks sit inside the product's own stylesheets, so
redeploying either WAR removes them.
