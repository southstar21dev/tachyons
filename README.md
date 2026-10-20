# tachyons

Plugins for [Claude Code](https://claude.com/claude-code), one marketplace.

| Plugin | What it does |
|---|---|
| [tachyons-sidebar](plugins/tachyons-sidebar) | A sidebar pane with context used, usage limits, cost, files changed and subagents. Shows the cache and visualize status when those plugins are installed. |
| [tachyons-visualize](plugins/tachyons-visualize) | A browser companion for mockups, diagrams and A/B visual choices. Only starts when you run it. |
| [tachyons-cache](plugins/tachyons-cache) | Keeps the prompt cache warm while the session sits idle. |

## Install

```
/plugin marketplace add southstar21dev/tachyons
/plugin install tachyons-sidebar@tachyons
/plugin install tachyons-visualize@tachyons
/plugin install tachyons-cache@tachyons
```

Each plugin works alone. The sidebar picks up the other two through their published `$.state`, so install them together for the full picture.

To work on a local clone instead, use `/plugin marketplace add /path/to/tachyons`.

## Layout

```
.claude-plugin/marketplace.json   the marketplace: lists every plugin below
plugins/
  <plugin>/
    .claude-plugin/plugin.json    manifest
    hooks/                        hooks module (hooks.json names the entry file)
    skills/                       skills, if the plugin has any
    types/index.d.ts              the plugin's $.state contract
    tests/                        claude plugin test
    README.md
```

## Developing

```sh
claude plugin validate plugins/<plugin>
claude plugin test plugins/<plugin>
claude --plugin-dir plugins/<plugin>    # run a session with your working copy loaded
```

Once Claude Code has loaded a plugin, it writes the API types into `plugins/<plugin>/.claude-plugin/types/` (gitignored), and each plugin's `tsconfig.json` extends them, so `tsc -p plugins/<plugin>` type-checks it.

Bump `version` in a plugin's `plugin.json` when you change it, then `/plugin marketplace update tachyons` and `/plugin update <plugin>@tachyons`.

## License

[MIT](LICENSE)
