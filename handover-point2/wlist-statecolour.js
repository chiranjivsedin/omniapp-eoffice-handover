
/* ===========================================================================
   LOCAL_DEV_STATE_COLOUR
   Colours worklist rows by work-item state, for client point 2: telling pending,
   in-progress and completed items apart at a glance.

   WHY THIS IS JAVASCRIPT
   Newgen's supported colouring is alias rules (VARALIASTABLE.AliasRule), which
   colour by the value of a QUEUE VARIABLE. Work-item state is not an aliasable
   variable - checked twice - so there is no configuration that can express
   "colour by RUNNING / NOTSTARTED". The one built-in that touches state is
   ExitColor in webdesktop.ini, and that only paints completed rows.

   Stage-based colouring was also tried and reverted: a stage is where an item is
   in the process, not whether it has started, so every row came out the same
   colour and the requirement was not met.

   HOW IT WORKS
   The state is already on screen, in the "Workitem State" column. This reads that
   text and sets a class on the row. It adds nothing to the page and asks the
   server for nothing.

   DELIBERATE CHOICES
   - The column is located by its HEADER TEXT, never by a fixed index: column order
     is configurable per queue, and the column-resize patch lets users move things.
     If the column is not displayed, this does nothing at all - it does not guess.
   - Only the row's background is set. The state text sits in a <label> with an
     inline colour, and inline styles win, so recolouring the text would need
     !important games for no benefit.
   - Unknown states are left alone rather than given a default colour, so a state
     we have not seen shows as "no colour", not as the wrong colour.
   - Everything is inside try/catch. A failure here must leave a plain grid, never
     a broken one.

   RE-RENDERING
   The grid replaces its own DOM on paging, sorting and refresh, so colours have to
   be re-applied. The observer therefore watches document.documentElement, not the
   grid: an observer bound to the table itself dies the moment the table is
   replaced - that exact bug cost real debugging time in the column-resize patch.
   A slow poll backs it up in case a mutation is ever missed.
   =========================================================================== */
(function () {
    'use strict';

    var TABLE_ID = 'wlf:pnlResult';
    var STYLE_ID = 'ldsc-style';
    var HEADER_RE = /workitem\s*state/i;
    var POLL_MS = 2500;

    /* Text in the state column -> class. Newgen reports these upper-case; matching
       is done upper-cased so casing changes cannot silently break it.
       COMPLETED/EXITED are included from the product's own vocabulary: completed
       items normally leave the queue, so they will rarely appear here, but a view
       that does show them should colour correctly rather than fall through. */
    var STATES = [
        { match: ['NOTSTARTED', 'NOT STARTED'], cls: 'ldsc-pending'  },
        { match: ['RUNNING'],                   cls: 'ldsc-progress' },
        { match: ['COMPLETED', 'EXITED'],       cls: 'ldsc-done'     }
    ];
    var ALL_CLASSES = ['ldsc-pending', 'ldsc-progress', 'ldsc-done'];

    function classFor(text) {
        var t = String(text || '').trim().toUpperCase();
        if (!t) { return null; }
        for (var i = 0; i < STATES.length; i++) {
            for (var j = 0; j < STATES[i].match.length; j++) {
                if (t === STATES[i].match[j]) { return STATES[i].cls; }
            }
        }
        return null;
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) { return; }
        /* Tints are pale on purpose: the cells sit on white and the text is dark, so
           anything stronger costs readability for no extra clarity. The left bar is
           what actually reads at a glance.
           Cells are transparent in this grid, so colouring the row is enough - but
           the cells are set too, in case a theme gives them a background. */
        var css = [
            '#wlf\\:pnlResult tr.ldsc-pending,',
            '#wlf\\:pnlResult tr.ldsc-pending > td { background-color: #fff5e8 !important; }',
            '#wlf\\:pnlResult tr.ldsc-progress,',
            '#wlf\\:pnlResult tr.ldsc-progress > td { background-color: #eaf2fd !important; }',
            '#wlf\\:pnlResult tr.ldsc-done,',
            '#wlf\\:pnlResult tr.ldsc-done > td { background-color: #eaf7ef !important; }',

            /* Accent bar on the first cell of the row. */
            '#wlf\\:pnlResult tr.ldsc-pending  > td:first-child { box-shadow: inset 3px 0 0 #f29900 !important; }',
            '#wlf\\:pnlResult tr.ldsc-progress > td:first-child { box-shadow: inset 3px 0 0 #1a73e8 !important; }',
            '#wlf\\:pnlResult tr.ldsc-done     > td:first-child { box-shadow: inset 3px 0 0 #1e8e3e !important; }'
        ].join('');

        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.type = 'text/css';
        s.appendChild(document.createTextNode(css));
        (document.head || document.documentElement).appendChild(s);
    }

    /* Index of the state column, or -1. Read from the header row every time rather
       than cached: the user can reorder or hide columns without a page reload. */
    function stateColumnIndex(table) {
        if (!table.rows.length) { return -1; }
        var cells = table.rows[0].cells;
        for (var i = 0; i < cells.length; i++) {
            if (HEADER_RE.test((cells[i].textContent || '').replace(/\s+/g, ' '))) { return i; }
        }
        return -1;
    }

    function paint() {
        var table = document.getElementById(TABLE_ID);
        if (!table || table.rows.length < 2) { return; }

        var idx = stateColumnIndex(table);
        if (idx < 0) { return; }          /* column not shown - leave the grid alone */

        injectStyle();

        for (var r = 1; r < table.rows.length; r++) {
            var row = table.rows[r];

            /* Skip the hidden template row the grid keeps at the top (class "thl",
               display:none) - it has no state and must not be coloured. */
            if (row.style && row.style.display === 'none') { continue; }

            var cell = row.cells[idx];
            var want = cell ? classFor(cell.textContent) : null;

            for (var c = 0; c < ALL_CLASSES.length; c++) {
                if (ALL_CLASSES[c] !== want && row.classList.contains(ALL_CLASSES[c])) {
                    row.classList.remove(ALL_CLASSES[c]);
                }
            }
            if (want && !row.classList.contains(want)) { row.classList.add(want); }
        }
    }

    function safePaint() {
        try { paint(); } catch (e) { /* a plain grid beats a broken one */ }
    }

    /* Coalesce bursts of mutations into one repaint. */
    var pending = null;
    function schedule() {
        if (pending) { return; }
        pending = setTimeout(function () { pending = null; safePaint(); }, 60);
    }

    function start() {
        safePaint();
        try {
            /* documentElement, not the table: the grid's own node is replaced on
               re-render and an observer bound to it would silently stop firing. */
            new MutationObserver(schedule).observe(document.documentElement, {
                childList: true, subtree: true
            });
        } catch (e) { /* fall back to the poll below */ }
        setInterval(safePaint, POLL_MS);
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    } catch (e) { /* leave the grid untouched */ }
})();
/* ===== end LOCAL_DEV_STATE_COLOUR ========================================= */
