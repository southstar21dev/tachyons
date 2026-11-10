# tachyons-progress

A band directly above the prompt that shows what is running and how far along it is. One row per thing, gone eight seconds after it ends:

- **Plan**: when Claude splits the work into a task list (TodoWrite, or TaskCreate and TaskUpdate), a row on top shows tasks done out of total as a meter, a glyph per task (`✓✓◐○○`) and the task under way. It stays until every task is ticked off.
- **Subagents**: type, task, elapsed, a meter and time left, and how many tools they have called. The estimate is the median of earlier agents of the same type, kept across sessions.
- **Commands**: every Bash call, with its elapsed time and, once the same command (`npm test`, `cargo build`, `gh run watch`) has run before, a meter and time left.
- **CI**: while `gh run watch`, `gh run view` or `gh pr checks` runs, the band asks `gh` every ten seconds and shows jobs done out of total, with each job's state (`build ✓ test ◐ lint ○`). Without a run id on the line it takes the newest run on the current branch.
- **Video renders**: an `ffmpeg` call gets `-progress <file> -nostats` added, the input's length comes from `ffprobe`, and the row shows percent done, media time, fps, speed and time left.
- **Background commands** stay on the band until their task notification arrives, or until the engine stops tracking them (stopped with TaskStop or from `/tasks`, or the process died): at the end of each turn the band checks the engine's list of background work still running and ends any row that has dropped off it.

`/tachyons-progress` hides or shows the band. It yields to a survey on its own.

```
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ ◉ progress                                              ◠ 3 running   ✓ 1 finished   │
│ ◠ plan          3 of 7 tasks         ━━━━━╸──────   3/7  ✓✓✓◐○○○  Building login…     │
│ ◠ Explore       find auth handlers   ━━━━━━━╸────   64%  1m 12s · ~40s left · 9 tools │
│ ◠ gh run watch  CI run 42            ━━━━━───────   3/7  ✓ build ◐ test ○ lint · 2m   │
│ ◠ ffmpeg        render               ━━━━━━━━━╸──   79%  00:41 / 00:52 · 24 fps · 1.4× │
│ ✓ npm test      npm test             ━━━━━━━━━━━━  done  42s                          │
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

## How estimates work

Every finished command and agent records its duration under a short label in `$.store`, the last eight runs each. The next run of the same label shows the median as its estimate. A first run shows elapsed time only. A line that sleeps (`sleep 150; curl …`) uses its sleeps as the estimate instead, unless the sleep sits inside a loop. CI and render rows don't need history: their fraction is jobs done or media time written.

## How rows end

- A command a hook or the person refuses never ran, so it leaves no row.
- A command cut short (interrupted) ends as `ended`: not a failure, and not remembered as a duration. So does a background command whose notification says it was killed, or which `TaskStop` stopped.
- A row whose call never came back is ended three seconds after its turn finishes.
- A background row missing from the engine's list of in-flight work at the end of a turn is ended. It counts as still running if either its task id or its command line is on that list. A subagent's stop only checks that subagent's rows. If the task notification arrives later anyway, the row takes its real outcome.
- A subagent the engine stops listing, with no end of turn, is shown as `killed`. Agents the engine never lists (a workflow's) end by their own end of turn only.
- A subagent's own `TodoWrite` does not replace the session's plan, and `/clear` drops the plan.
- An ffmpeg render measures against the part it writes: `-ss` skips the start, `-t` and `-to` cap it.

## What it touches

- Bash commands that start with `ffmpeg` are rewritten to add a progress file under `$TMPDIR/tachyons-progress/`. Nothing else is rewritten.
- `gh`, `git rev-parse` and `ffprobe` are run read-only while a matching command is on the band.
