---
name: visualize
description: Open a browser companion to show mockups, diagrams and side-by-side visual choices, with clicks fed back to Claude. User-invoked only.
argument-hint: "[what to visualize] | stop"
disable-model-invocation: true
allowed-tools: Bash, Read, Write
---

# tachyons-visualize

A browser companion for visual questions: UI mockups, layouts, architecture diagrams, A/B design choices. You write HTML into a watched folder, the user's browser shows the newest file live, and their clicks land in an events file you read on the next turn.

## Only the user turns this on

This skill runs only because the user typed `/tachyons-visualize:visualize`. Keep it that way:

- **Never start the server, or suggest starting it, on your own.** No "want me to open a visual companion?" offers. If you think a picture would help and no session is running, answer in the terminal.
- **While a session is running, push a screen only when the user asks for something visual** ("show me", "mock it up", "compare these", "draw the flow"), or when the request that invoked this skill asked for it. Don't push screens on your own for other questions just because the browser is open.
- When the user says stop, done or close (or invokes the skill with `stop`), stop the server.

User arguments: `$ARGUMENTS`

- Empty: start or reconnect, show a waiting screen, and ask what they want to see.
- `stop`: jump to **Stopping**.
- Anything else: start or reconnect, then visualize that.

Scripts live in `${CLAUDE_SKILL_DIR}/scripts/` (the `scripts/` folder next to this SKILL.md).

## Starting

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/start.sh" --project-dir "$PWD" --open
```

It prints JSON:

```json
{"type":"server-started","port":52341,"pid":123,"url":"http://127.0.0.1:52341/?key=ab12…",
 "session_dir":"…/.tachyons/visualize/current","screen_dir":"…/content","state_dir":"…/state"}
```

- Remember `screen_dir`, `state_dir` and `session_dir`. If you lose them, read `<project>/.tachyons/visualize/current/state/server-info`.
- Always give the user the **full** `url`, including `?key=…`. The server rejects requests without the key.
- Running it again for the same project is safe. A live server returns its info, and a dead one restarts on the same port with the same key, so an open tab reconnects by itself.
- If `.tachyons/` is not in the project's `.gitignore`, mention it once.
- Remote or container setup where localhost isn't reachable: add `--host 0.0.0.0 --url-host <reachable-host>`.
- The server exits after 4 hours idle (`--idle-timeout-minutes N` changes that).

## The loop

1. **Check the server is alive** before you mention the URL or write a screen: `state_dir/server-info` exists and `state_dir/server-stopped` does not. If it's down, rerun `start.sh` with the same `--project-dir`.
2. **Write a new HTML file** into `screen_dir` with the Write tool (not cat or a heredoc).
   - Use a meaningful name: `layout.html`, `color-scheme.html`, `auth-flow.html`.
   - **Never reuse a filename.** Iterations are `layout-v2.html`, `layout-v3.html`. The newest file by mtime is what's shown.
   - A new screen clears `state_dir/events`.
3. **End your turn** with the URL, one line on what's on screen, and an invitation: "Have a look, click an option if one stands out, and tell me what you think here."
4. **Next turn:** read `state_dir/events` if it exists (JSON lines) and combine it with what they typed. Their terminal message wins. Events show how they explored the options.
5. **Iterate** with a new versioned file, or move on once they're happy.
6. **When the conversation goes back to text-only**, push a fresh `waiting-N.html` so a settled choice doesn't sit there looking current:

   ```html
   <div class="flex items-center justify-center vh-50"><p class="subtitle">Back in the terminal…</p></div>
   ```

## Writing screens

Write **fragments** by default. The server wraps them in a frame with the header, theme (light and dark), live-reload and click capture. Start the file with `<!doctype html>` only if you need full control. The helper script gets injected either way.

The frame loads **Tachyons CSS 4.12** (bundled, works offline) (`flex`, `pa3`, `mb4`, `w-50`, `br2`, `f4`, `ba b--moon-gray`, …), so build mockups from utility classes. The frame's own components handle the rest:

```html
<h2>Which dashboard layout fits?</h2>
<p class="subtitle">Think about where your eye lands first.</p>

<div class="options" data-group="layout">
  <div class="option" data-choice="a">
    <div class="letter">A</div>
    <div><h3>Sidebar nav</h3><p>Persistent left rail, content on the right</p></div>
  </div>
  <div class="option" data-choice="b">
    <div class="letter">B</div>
    <div><h3>Top nav</h3><p>Horizontal tabs, full-width content</p></div>
  </div>
</div>
```

**Selection:** any element with `data-choice` inside a `data-group` container can be clicked. It gets `.selected` and a click is logged. Add `data-multiselect` to the group to allow several picks. No `onclick` needed.

| Class | Use |
|---|---|
| `.options` > `.option` (+ `.letter`) | A/B/C choices described in words |
| `.cards` > `.card` > `.card-image` + `.card-body` | Choices that are visual designs |
| `.mockup` > `.mockup-header` + `.mockup-body` | A framed preview of a UI |
| `.split` | Two or more mockups side by side |
| `.pros-cons` > `.pros` / `.cons` (`h4` + `ul`) | Tradeoffs next to a visual |
| `.mock-nav` `.mock-sidebar` `.mock-content` `.mock-button` `.mock-input` `.placeholder` | Wireframe parts |
| `.node` `.arrow` | Quick box-and-arrow diagrams (use inline SVG for anything bigger) |
| `h2` `.subtitle` `h3` `.section` `.label` | Type and spacing |

Theme colors are CSS variables you can use in inline styles: `--bg --surface --surface-2 --border --text --text-2 --text-3 --accent --good --bad`.

**Assets:** put images in `screen_dir` (or a subfolder) and reference them as `/files/<name>`.

**Custom events:** `visualize.choice('dense', { group: 'density' })` or `visualize.send({ type: 'slider', value: 42 })` from inline scripts, for sliders, toggles and the like.

### Events format

```jsonl
{"type":"click","choice":"a","group":"layout","selected":true,"text":"A Sidebar nav …","timestamp":1706000101000,"screen":"layout.html"}
{"type":"click","choice":"b","group":"layout","selected":true,"text":"B Top nav …","timestamp":1706000108000,"screen":"layout.html"}
```

Each event carries the `screen` it came from, so ignore lines from older screens. The last selected choice per group is usually the answer. Clicking back and forth suggests they're unsure, so ask about it.

## Design tips

- Every screen asks its question in words: "Which layout feels calmer?", not "Pick one".
- 2–4 options per screen.
- Match fidelity to the question: wireframes for structure, polish for look-and-feel.
- Use real content when it matters (real copy, real data shapes). Placeholder text hides problems.
- If the project has a design system or existing styles, mirror its colors and type in the mockups.

## Stopping

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/stop.sh" "<session_dir>"
```

Project sessions keep their screens in `.tachyons/visualize/current/content` and temp sessions are deleted. Tell the user it's stopped. An open tab shows a "paused" overlay and reconnects if they start it again.
