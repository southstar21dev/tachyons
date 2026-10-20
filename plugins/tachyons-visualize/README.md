# tachyons-visualize

A browser companion for questions that are easier to see than to read: UI mockups, layouts, architecture diagrams, side-by-side design choices. Claude writes HTML screens, your browser shows the newest one live, and the options you click are passed back to Claude.

Inspired by the [superpowers visual companion](https://github.com/obra/superpowers/blob/main/skills/brainstorming/visual-companion.md).

## Use

```
/tachyons-visualize:visualize                       start, then ask what to show
/tachyons-visualize:visualize compare two navbars   start and show that
/tachyons-visualize:visualize stop                  stop the server
```

**Only you can start it.** The skill sets `disable-model-invocation: true`, so Claude can't load it or offer it on its own. Once it runs, Claude only shows a new screen when you ask for something visual.

## How it works

- `skills/visualize/scripts/server.cjs` is a Node server with no dependencies. It serves the newest `.html` in `<project>/.tachyons/visualize/current/content/`, wraps HTML snippets in `frame.html` (light and dark theme, bundled Tachyons CSS), refreshes the page over Server-Sent Events and appends clicks to `state/events`.
- The URL carries a session key, and requests without it are refused.
- A restart reuses the same port and key, so an open tab reconnects by itself. The server exits after 4 hours with no activity.
- `hooks/register.ts` publishes `tachyons-visualize/status` (running, port, newest screen, screen and click counts) for [tachyons-sidebar](../tachyons-sidebar).

Add `.tachyons/` to the `.gitignore` of projects you use it in.
