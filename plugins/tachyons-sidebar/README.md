# tachyons-sidebar

A small pane docked on the right of the terminal:

- **Context**: tokens used out of the window, as a meter
- **Limits**: 5-hour, 7-day, per-model weekly (Fable, Opus, Sonnet) and spend limits with reset times, plus session cost. They are refreshed in the background every minute (and after each turn) from the account's usage endpoint, so they move between turns too; if the endpoint can't be reached the meters fall back to what the last reply reported
- **Cache**: keep-alive state, when [tachyons-cache](../tachyons-cache) is installed
- **Visualize**: port, current screen and clicks while a [tachyons-visualize](../tachyons-visualize) server runs
- **Files**: files written or edited this session
- **Agents**: subagents spawned and their status
- Clawd, who naps in a nightcap between turns and during one dresses for the job: a propeller beanie while waiting on the model, a wizard hat and wand while thinking, a top hat and quill while writing, a mortarboard and clipboard while planning, and for tools a hard hat and hammer (shell), beret and pencil (edits), deerstalker and magnifier (reading and search), pith helmet and globe (web), or captain's hat and flag (subagents)

`/tachyons-sidebar` toggles the pane. It opens by itself when the terminal is wide enough to dock it.

## Reading other plugins

The sidebar only reads `tachyons-cache/status` and `tachyons-visualize/status`. Both shapes are declared in `types/index.d.ts`, copied from those plugins' own contracts. A section stays hidden when its plugin isn't installed.
