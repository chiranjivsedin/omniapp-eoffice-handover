
/* ===========================================================================
   LOCAL_DEV_COLUMN_RESIZE
   Drag-to-resize columns in the worklist grid (Inbox / Pending / Sent / search).

   Why this is custom code: the product has no column-resize feature to enable.
   There is no resize implementation anywhere in webdesktop.war (tablegenerator.js
   only *reorders* dashboard cells), so this is written from scratch.

   Scope: resizing only, no persistence. Widths are held in memory, so they survive
   paging / sorting / ajax refresh within the page and are gone on reload. Nothing
   is written to localStorage, cookies or the database.

   How it works:
     - the grid (table#wlf:pnlResult) has no <colgroup>, so widths are set on the
       header <th> cells and the table is switched to table-layout:fixed, which
       makes those widths authoritative and stops one drag reflowing every column.
       Columns are MEASURED FIRST, while the table is still table-layout:auto, and
       only then switched to fixed - measuring after the switch reads the equal
       distribution fixed layout applies to width-less columns, which froze
       columns too narrow (text wrapping with space unused beside it). A short
       settle check re-measures before pinning, because the grid arrives by ajax
       and can still be laying out when first seen
     - a grip is appended to each resizable <th>; sorting is bound to the <th>'s
       inner <label> (sbf(this,N)), so the grip must sit on the th itself and
       swallow its own mouse events or a drag would also sort the column
     - the table lives inside div#scroll.scrollTableContainerDataViewTable, which
       already has overflow-x:auto, so widening past the viewport just scrolls
     - icon columns (no header text) and the trailing wdwidth100 spacer are
       skipped: they are layout, not data
     - each grip draws a 1px divider at rest, because nothing else on screen tells
       the user the boundary is draggable (this grid has no vertical rules of its
       own), and thickens to a 2px bar on hover/drag. Colours are translucent
       mid-grey so they hold up on both light and dark Newgen themes
     - double-clicking a grip auto-fits the column. Under table-layout:fixed the
       cells cannot report their natural width, so the strings are measured
       off-screen in the cell's own font

   Interaction with LOCAL_DEV_QVAR_ONELINE: that patch puts queue-variable values
   on one line and caps them at max-width:320px. This patch constrains the value
   back into its cell with an ellipsis (under table-layout:fixed a narrowed column
   would otherwise overflow into its neighbour), adds a title tooltip so a shrunken
   column stays readable, and releases the 320px cap so dragging a column wider
   reveals the whole value.

   Everything is wrapped in try/catch: if any of this fails the grid must still
   work exactly as it does today.
   =========================================================================== */
(function () {
    'use strict';

    var TABLE_ID   = 'wlf:pnlResult';
    var MIN_WIDTH  = 40;      // px, so a column can never be dragged to nothing
    var GRIP_WIDTH = 8;       // px hit area
    var READY_ATTR = 'data-ldcr';
    var MAX_AUTOFIT = 600;    // px ceiling when double-click auto-fits a column
    var SETTLE_MS  = 150;     // wait for layout to stop moving before pinning widths
    var HEADER_GAP = 12;      // clear space kept between header text and the divider

    // Session-only, in-memory. Keyed by header text so widths follow a column
    // across re-render and column reordering. Deliberately NOT persisted.
    var widths = {};
    var dragging = null;

    function log(e) { if (window.console && console.debug) { console.debug('[LOCAL_DEV_COLUMN_RESIZE]', e); } }

    function injectStyle() {
        if (document.getElementById('ldcr-style')) { return; }
        var css = ''
            + 'table.ldcr-on { table-layout: fixed !important; }'
            + 'table.ldcr-on > * > tr > th.ldcr-col { position: relative !important; }'
            + 'table.ldcr-on > * > tr > th.ldcr-col > .ldcr-grip {'
            // right:0, NOT a negative offset straddling the cell edge: the th has
            // overflow:hidden, which clips the protruding half and makes it fail
            // hit-testing - elementFromPoint returns the th and the drag never starts.
            + '  position: absolute; top: 0; right: 0; width: ' + GRIP_WIDTH + 'px; height: 100%;'
            + '  cursor: col-resize; z-index: 20; background: transparent;'
            + '  box-sizing: border-box;'
            // At-rest affordance: a 1px divider on the column boundary. Without it
            // nothing on screen suggests the boundary can be dragged -- this grid
            // has no vertical rules of its own. Translucent mid-grey so it reads on
            // both light and dark Newgen themes; a fixed hex would clash with one.
            + '  border-right: 1px solid rgba(128,128,128,0.45);'
            + '  -webkit-user-select: none; user-select: none;'
            + '}'
            // Hover/drag: thicken to a 2px bar and tint the hit area, so it is
            // unmistakable which boundary is about to move.
            + 'table.ldcr-on > * > tr > th.ldcr-col > .ldcr-grip:hover,'
            + 'table.ldcr-on > * > tr > th.ldcr-col > .ldcr-grip.ldcr-active {'
            + '  background: rgba(128,128,128,0.20);'
            + '  border-right: 2px solid rgba(90,90,90,0.85);'
            + '}'
            // border-box, so a width set from offsetWidth (which already includes
            // padding and border) is not inflated by them a second time.
            + 'table.ldcr-on th, table.ldcr-on td { box-sizing: border-box !important; }'
            // keep content inside its cell once widths are authoritative
            + 'table.ldcr-on td, table.ldcr-on th.ldcr-col { overflow: hidden !important; }'
            // LOCAL_DEV_QVAR_ONELINE caps this div at max-width:320px. Release the
            // cap here: once a column has an explicit pinned width the div must
            // follow it, or dragging wider would still show an ellipsis. The
            // initial cap still applies, because widths are measured BEFORE
            // ldcr-on is added.
            + 'table.ldcr-on td.wl > div[style*="word-break: break-word"] {'
            + '  width: 100% !important; max-width: none !important;'
            + '  overflow: hidden !important; text-overflow: ellipsis !important;'
            + '}'
            + 'body.ldcr-dragging { cursor: col-resize !important; -webkit-user-select: none; user-select: none; }'
            + 'body.ldcr-dragging * { cursor: col-resize !important; }';
        var s = document.createElement('style');
        s.id = 'ldcr-style';
        s.type = 'text/css';
        s.appendChild(document.createTextNode(css));
        (document.head || document.documentElement).appendChild(s);
    }

    function headerCells(table) {
        if (!table.rows || !table.rows.length) { return []; }
        return Array.prototype.slice.call(table.rows[0].cells);
    }

    function key(th) {
        return (th.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // Icon columns carry no header text; the trailing spacer is wdwidth100.
    function isResizable(th) {
        var cls = (th.className || '').toString();
        return key(th).length > 0 && cls.indexOf('wdwidth100') === -1;
    }

    // Read the browser's own column widths. MUST be called while the table is
    // still in its natural table-layout:auto state - see freeze().
    function measure(cells) {
        var out = [], i;
        for (i = 0; i < cells.length; i++) { out.push(cells[i].offsetWidth); }
        return out;
    }

    // Pin the measured widths and switch the table to fixed layout.
    //
    // Order matters and was the source of a real bug: adding `ldcr-on` applies
    // table-layout:fixed, and under fixed layout with no explicit widths the
    // browser distributes columns roughly EQUALLY rather than by content. So
    // measuring after marking the table froze wrong widths - narrow columns
    // wrapped their text while space went unused elsewhere. Measure first, mark
    // second.
    //
    // Widths are applied as border-box (see injectStyle), which is what makes
    // them equal the offsetWidth we measured under content-box.
    function freeze(table, measured) {
        var cells = headerCells(table), total = 0, i, th, w;
        for (i = 0; i < cells.length; i++) {
            th = cells[i];

            // A user-set width is used as-is; a measured one gets HEADER_GAP added.
            //
            // The measured value is the browser's content-fit width, so the header
            // label ends exactly at the column boundary and the divider appears to
            // sit on the text. Standard grids avoid this with header padding, but
            // padding cannot be added here after the fact: widths are pinned from
            // this measurement and `ldcr-on` then sets overflow:hidden, so padding
            // applied later eats into a fixed width and clips the label mid-word --
            // which is exactly what happened when it was tried.
            //
            // Widening the pinned value instead leaves the extra as empty space at
            // the right of the cell. The label keeps its position (so header and
            // column values stay aligned), nothing is clipped, and the divider moves
            // clear. Only measured widths are padded -- adding it to a stored width
            // would grow that column a little further on every re-render.
            w = widths[key(th)];
            if (!w) {
                w = measured[i];
                // Only columns that carry a divider get the gap. freeze() pins a
                // width for EVERY header cell, so adding it unconditionally also
                // widened the narrow icon columns (select-all, arrow, lock, flag)
                // by 12px each, which visibly spread them apart.
                if (w && isResizable(th)) { w += HEADER_GAP; }
            }
            if (w) { th.style.width = w + 'px'; total += w; }
        }
        if ((table.className || '').indexOf('ldcr-on') === -1) {
            table.className = ((table.className || '') + ' ldcr-on').trim();
        }
        if (total > 0) { table.style.width = total + 'px'; }
    }

    function addGrips(cells) {
        var i, th, grip;

        // The last resizable column gets no grip. A divider sits ON a column
        // boundary, and there is no boundary to the right of the final column --
        // dragging there only stretches the table into empty space, and the handle
        // reads as an unfinished edge. Found by index rather than by position so
        // the trailing spacer cells the grid appends are ignored.
        var last = -1;
        for (i = 0; i < cells.length; i++) {
            if (isResizable(cells[i])) { last = i; }
        }

        for (i = 0; i < cells.length; i++) {
            th = cells[i];
            if (!isResizable(th)) { continue; }
            if (i === last) { continue; }
            if (th.getAttribute(READY_ATTR) === '1') { continue; }
            if ((th.className || '').indexOf('ldcr-col') === -1) {
                th.className = ((th.className || '') + ' ldcr-col').trim();
            }
            grip = document.createElement('div');
            grip.className = 'ldcr-grip';
            grip.setAttribute('title', 'Drag to resize \u2014 double-click to fit contents');
            grip.onmousedown = onGripMouseDown;
            grip.onclick     = swallow;   // a click on the grip must not sort
            grip.ondblclick  = onGripDblClick;
            th.appendChild(grip);
            th.setAttribute(READY_ATTR, '1');
        }
    }

    function tooltipClipped(table) {
        // Once columns are resizable a narrowed cell clips its text, and the
        // wrap-div branch of WDWorkitemList does not set title (it assumes the
        // full value is visible). Restore the tooltip so a shrunken column stays
        // readable on hover.
        //
        // The title is set unconditionally rather than only when clipped: these
        // values sit in a <label>, which is display:inline, and inline elements
        // report scrollWidth 0 - so a scrollWidth > clientWidth test can never
        // fire here. Always setting it also matches what the stock truncating
        // branch does, and an unnecessary tooltip is harmless.
        var nodes = table.querySelectorAll('td.wl label, td.wl > div > label');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (el.getAttribute('title')) { continue; }
            if (el.id) { continue; }              // skip the hidden wlf:hop/hjn payload labels
            var txt = (el.textContent || '').trim();
            if (txt) { el.setAttribute('title', txt); }
        }
    }

    function onMouseMove(ev) {
        if (!dragging) { return; }
        var dx = ev.clientX - dragging.startX;
        var w  = Math.max(MIN_WIDTH, dragging.startWidth + dx);
        dragging.th.style.width = w + 'px';
        dragging.table.style.width = Math.max(MIN_WIDTH, dragging.startTableWidth + (w - dragging.startWidth)) + 'px';
        widths[dragging.key] = w;
        if (ev.preventDefault) { ev.preventDefault(); }
        return false;
    }

    function onMouseUp() {
        if (!dragging) { return; }
        try {
            if (dragging.grip) { dragging.grip.className = 'ldcr-grip'; }
            document.body.className = (document.body.className || '').replace(/\s*ldcr-dragging\s*/g, ' ').trim();
            tooltipClipped(dragging.table);
        } catch (e) { log(e); }
        dragging = null;
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
    }

    function onGripMouseDown(ev) {
        // Left button only, and never let this reach the header's sort handler.
        if (ev.button !== 0) { return; }
        ev.stopPropagation();
        if (ev.preventDefault) { ev.preventDefault(); }

        var grip  = ev.currentTarget || ev.target;
        var th    = grip.parentNode;
        var table = document.getElementById(TABLE_ID);
        if (!th || !table) { return; }

        dragging = {
            th: th, table: table, grip: grip, key: key(th),
            startX: ev.clientX,
            startWidth: th.offsetWidth,
            startTableWidth: table.offsetWidth
        };
        grip.className = 'ldcr-grip ldcr-active';
        document.body.className = ((document.body.className || '') + ' ldcr-dragging').trim();
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
        return false;
    }

    // Swallow the events a drag would otherwise turn into a sort.
    function swallow(ev) {
        ev.stopPropagation();
        if (ev.preventDefault) { ev.preventDefault(); }
        return false;
    }

    // Measure text off-screen. Under table-layout:fixed a cell can no longer
    // report its natural content width (that is the point of fixed), so auto-fit
    // has to measure the strings itself using each cell's own font.
    function measurer() {
        var m = document.getElementById('ldcr-measure');
        if (!m) {
            m = document.createElement('div');
            m.id = 'ldcr-measure';
            m.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;'
                            + 'white-space:nowrap;padding:0;margin:0;border:0;';
            document.body.appendChild(m);
        }
        return m;
    }

    function textWidth(str, font) {
        var m = measurer();
        m.style.font = font || '';
        m.textContent = str;
        return m.offsetWidth;
    }

    function autoFit(th) {
        var table = document.getElementById(TABLE_ID);
        if (!table || !th) { return; }
        var cells = headerCells(table), idx = -1, i;
        for (i = 0; i < cells.length; i++) { if (cells[i] === th) { idx = i; break; } }
        if (idx < 0) { return; }

        var widest, r, cell, labels, j, txt, w;

        // the header text itself
        var hvis = th.querySelector('label') || th;
        widest = textWidth(key(th), getComputedStyle(hvis).font);

        for (r = 1; r < table.rows.length; r++) {
            cell = table.rows[r].cells[idx];
            if (!cell) { continue; }
            // Only labels WITHOUT an id are display text: wlf:hop / wlf:hjn are
            // hidden payload holding the whole record, and measuring those would
            // blow the column out to the 600px ceiling every time.
            labels = cell.querySelectorAll('label');
            for (j = 0; j < labels.length; j++) {
                if (labels[j].id) { continue; }
                txt = (labels[j].textContent || '').trim();
                if (!txt) { continue; }
                w = textWidth(txt, getComputedStyle(labels[j]).font);
                if (w > widest) { widest = w; }
            }
        }

        var pad;
        try {
            var cs = getComputedStyle(th);
            pad = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0) + GRIP_WIDTH + 6;
        } catch (e) { pad = 20; }

        var target = Math.max(MIN_WIDTH, Math.min(MAX_AUTOFIT, Math.ceil(widest + pad)));
        var delta  = target - th.offsetWidth;
        th.style.width = target + 'px';
        table.style.width = Math.max(MIN_WIDTH, table.offsetWidth + delta) + 'px';
        widths[key(th)] = target;
        tooltipClipped(table);
    }

    function onGripDblClick(ev) {
        ev.stopPropagation();
        if (ev.preventDefault) { ev.preventDefault(); }
        try {
            var grip = ev.currentTarget || ev.target;
            autoFit(grip.parentNode);
        } catch (e) { log(e); }
        return false;
    }

    function init() {
        var table = document.getElementById(TABLE_ID);
        if (!table) { return; }
        // Need a rendered grid with at least one data row: an empty queue has
        // nothing to size and nothing to resize.
        if (!table.rows || table.rows.length < 2) { return; }

        injectStyle();

        var cells = headerCells(table);
        if (!cells.length) { return; }

        // Measure while the table is still table-layout:auto, so these are the
        // browser's content-derived widths.
        var first = measure(cells);
        if (!table.offsetWidth) { schedule(); return; }
        for (var i = 0; i < first.length; i++) {
            if (!first[i]) { schedule(); return; }   // mid-render, come back later
        }

        // Confirm layout has settled before pinning anything. The grid arrives by
        // ajax and its columns can still be moving when we first see it; freezing
        // a half-laid-out table is what produced squeezed, wrapping columns with
        // unused space beside them.
        setTimeout(function () {
            try {
                var t = document.getElementById(TABLE_ID);
                if (!t || t !== table) { schedule(); return; }
                var now = measure(headerCells(t));
                if (now.length !== first.length) { schedule(); return; }
                for (var j = 0; j < now.length; j++) {
                    if (Math.abs(now[j] - first[j]) > 1) { schedule(); return; }
                }
                freeze(t, now);
                addGrips(headerCells(t));
                tooltipClipped(t);
            } catch (e) { log(e); }
        }, SETTLE_MS);
    }

    var timer = null;
    function schedule() {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(function () {
            timer = null;
            try { init(); } catch (e) { log(e); }
        }, 250);
    }

    function needsInit() {
        var t = document.getElementById(TABLE_ID);
        return !!t && t.rows && t.rows.length > 0 && !t.querySelector('.ldcr-grip');
    }

    function watch() {
        // The grid is re-rendered on paging, sorting, search and ajax refresh.
        // That replaces the table element AND its scroll container, so the
        // observer must sit on a node that is never itself replaced -
        // documentElement - otherwise it ends up watching a detached node and
        // never fires again (which is exactly what happened with div#scroll).
        try {
            if (window.MutationObserver) {
                new MutationObserver(function () {
                    if (needsInit()) { schedule(); }
                }).observe(document.documentElement, { childList: true, subtree: true });
            }
        } catch (e) { log(e); }

        // Backstop: a cheap poll (one getElementById + one querySelector) covers
        // any re-render path the observer misses, and costs nothing measurable.
        try {
            setInterval(function () {
                try { if (needsInit()) { init(); } } catch (e) { log(e); }
            }, 2000);
        } catch (e) { log(e); }
    }

    function boot() {
        try { init(); watch(); } catch (e) { log(e); }
    }

    try {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(boot, 300);
        } else if (window.addEventListener) {
            window.addEventListener('load', function () { setTimeout(boot, 300); }, false);
        } else {
            window.attachEvent('onload', function () { setTimeout(boot, 300); });
        }
    } catch (e) { log(e); }
})();
/* ===== end LOCAL_DEV_COLUMN_RESIZE ======================================== */
