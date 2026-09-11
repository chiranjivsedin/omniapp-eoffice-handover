# OmniApp eOffice — handover kits

Patches for the Newgen iBPS OmniApp 6.0 SP0 deployment (BL01 eOffice), packaged so the
release team can apply them. Every change is **append-only** — no product file is edited
in place, and each one is removed by deleting the block it added.

| Folder | What it fixes | Type |
|---|---|---|
| `handover-point1/` | File number truncated at 30 chars; no column resizing | Config + CSS + script |
| `handover-point2/` | Work items not distinguishable by state | Script |
| `handover-tile-ui/` | Landing tiles looked dated | CSS |
| `handover-search-ui/` | Search bar and panels looked unfinished | CSS |

Start with the `README.md` (or `APPLY.md` for point 1) inside each folder — they give the
steps. `docs/implementation-plan.html` is the summary written for management: what each
item turned out to be, what is done, and what still needs a decision.

## Before applying any of them

- Repack the WAR with a proper zip tool. `jar -uf` fails on these files with
  `ZipException: invalid entry size`.
- Redeploy, then **fully stop and start** the server — not a reload.
- Hard-refresh the browser (Ctrl+F5); stylesheets and scripts are cached.
- These blocks live inside the product's own files, so **re-apply after any upgrade or
  redeployment** of the WAR concerned.
