# tachyons-sidebar

A small pane docked on the right of the terminal:

- **Context**: tokens used out of the window, as a meter
- **Limits**: 5-hour, 7-day and spend limits with reset times, plus session cost
- **Cache**: keep-alive state, when [tachyons-cache](../tachyons-cache) is installed
- **Visualize**: port, current screen and clicks while a [tachyons-visualize](../tachyons-visualize) server runs
- **Files**: files written or edited this session
- **Agents**: subagents spawned and their status
- A crab that naps between turns and says what Claude is doing during one

`/tachyons-sidebar` toggles the pane. It opens by itself when the terminal is wide enough to dock it.

## Reading other plugins

The sidebar only reads `tachyons-cache/status` and `tachyons-visualize/status`. Both shapes are declared in `types/index.d.ts`, copied from those plugins' own contracts. A section stays hidden when its plugin isn't installed.
