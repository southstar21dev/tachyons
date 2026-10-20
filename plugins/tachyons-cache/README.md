# tachyons-cache

Keeps the prompt cache warm while a session sits idle. After each turn it schedules a small forked request that re-reads the transcript prefix before the cache entry expires, so your next message is a cache hit rather than a full re-read.

```
/tachyons-cache on | off | status
```

## Options

| Option | Default | |
|---|---|---|
| `intervalSeconds` | 270 | Idle time between pings. Keep it under the cache TTL: 270 for the 5 minute cache, about 3300 for the 1 hour cache. |
| `maxPings` | 12 | Stop after this many pings without a new turn. |

Each ping is a real (small) request and costs cache reads. The status line shows the last ping, and `tachyons-cache/status` is published for [tachyons-sidebar](../tachyons-sidebar).
