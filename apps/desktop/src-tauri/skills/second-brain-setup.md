# Second brain — setup

Build the user's second brain inside their OpenBlocks vault: a folder of Markdown files every AI reads, so each chat knows how the user and their work operate. Target: about 30 minutes, 5–10 core files, one routing map.

Use the `openblocks__*` tools (`list_pages`, `read_page`, `create_folder`, `create_page`, `edit_page`, `move`). If they are not available, ask the user to turn on the OpenBlocks pill. Work in the vault the user has open. Never delete or overwrite existing pages without asking.

## 1. Look first
- `list_pages` to see what is already there. If the vault already has an `AGENTS.md` (or `CLAUDE.md`), read it: you are completing the second brain, not replacing it. If both exist, keep one: `AGENTS.md`.
- Tell the user in two sentences what you are going to do.

## 2. Brain dump (one question at a time)
Ask these, one per message, and wait for each answer. Accept rambling or dictated answers and turn them into clean notes:
1. Who are you and what do you do?
2. What does your business or main project do, and what do you sell or deliver?
3. Who are your ideal clients or users?
4. What are your goals and strategy for the next 3–12 months?
5. How do you write and speak? (tone, words you like or avoid, examples)
6. Who is on your team, and what does each person do?

About 80% of the value comes from 5–10 files, so do not interrogate beyond this.

## 3. Write the files
Create these folders and pages (reuse names that already exist, in the user's language). The structure is fixed: do not rename it later.
- `Contexto/` → `Estrategia`, `Cliente ideal`, `Voz de marca`, `Oferta`, `Equipo`
- `Proyectos/` (one subfolder per project or client, created when needed)
- `Reuniones/` (decisions and insights, not transcripts)
- `Decisiones/` (what was decided and why)
- `AGENTS` (root page, see step 4)

Each page: a short title, YAML properties (`tags`, `updated`), and the content as clean bullet points. Store conclusions and decisions, not raw data.

## 4. AGENTS.md — the routing table
A map, not a manual. Under 200 lines. For each folder: what is in it, when to use it, and where to save new things. Example row: `Proyectos/ — one subfolder per client; use it to prepare calls and proposals; save new client notes in the client's subfolder`.
Add this rule at the end: *Always act in the best interest of the business, based on our goals and strategy. If a request or output conflicts with that, say so clearly instead of just agreeing.*

## 5. One index per folder
For every folder with more than 10 pages, create an `Índice` page listing each page with one line about it. Point the root `AGENTS` page to each folder.

## 6. Finish
Show the user the tree you created, remind them to start every chat with the OpenBlocks pill on so the AI reads `AGENTS` first, and suggest the next step: `/second-brain-operator`.
