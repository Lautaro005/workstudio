# Second brain — optimizer

A weekly (or every-two-weeks) health check of the second brain in the OpenBlocks vault. Fix small things right away; **ask before any big change** (more than ~10 moves, any delete, any restructure). Everything you change is recoverable through the vault's history and trash, but still say what you did.

Use `openblocks__*` (`list_pages`, `read_page`, `backlinks`, `search_pages`, `edit_page`, `move`, `set_property`).

## 1. Your map
- `AGENTS` lists every top-level folder, says when to use it and where to save new things, and stays **under 200 lines**.
- Every folder with more than 10 pages has an `Índice` listing each page in one line.
- The routing still sends an AI to the right place. Fix rows that point to folders that no longer exist or miss new ones.
- There is only one of `AGENTS` / `CLAUDE`: keep `AGENTS`.

## 2. Notes and links
- Broken `[[links]]`: fix or remove them.
- Duplicates: merge the content into the best page, keep the other as a short pointer or archive it (ask first when unsure).
- Orphans: pages nothing links to (`backlinks`). Link them from an index or archive them.
- Contradictions: two notes that disagree (prices, names, dates). Do not pick one silently: list them in the report.

## 3. Keep it light
- Shorten pages that are too long; move detail that is not needed to an archive page.
- Remove content that burns tokens for no reason (raw dumps, long pasted logs).
- Fix unclear page names and missing tags/properties.

## 4. Report
Give a **health score out of 100** and a short report: what you checked, what you fixed, what needs the user's decision (a list of questions). Save the report as a page in `Decisiones/` named `Chequeo YYYY-MM-DD`.

Business-first rule: if something in the brain conflicts with the strategy in `Contexto/Estrategia`, flag it.
