(function () {
  const PAUSE_AFTER_MS = 15000

  function setStatus(text, color) {
    const el = document.querySelector('.tv-status')
    if (!el) return
    el.textContent = text
    el.style.setProperty('--dot', color)
  }

  // Self-styled so it also works on full-document screens.
  let overlay = null
  function showPaused() {
    if (overlay) return
    overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
      'justify-content:center;padding:2rem;text-align:center;background:rgba(18,17,15,.94);' +
      'color:#F5ECD7;font-family:system-ui,sans-serif'
    overlay.innerHTML = '<div style="max-width:440px"><h2 style="margin:0 0 .5rem;font-weight:600">Visualize paused</h2>' +
      '<p style="margin:0;opacity:.8">The companion server stopped. Run /tachyons-visualize:visualize again ' +
      'and this tab reconnects on its own.</p></div>'
    document.body && document.body.appendChild(overlay)
  }

  let downSince = null
  function connect() {
    const es = new EventSource('/live')
    es.onopen = () => {
      setStatus('Live', '#8fbf7f')
      if (overlay) return location.reload()
      downSince = null
    }
    es.onmessage = msg => {
      let data
      try { data = JSON.parse(msg.data) } catch (e) { return }
      if (data.type === 'reload') location.reload()
      if (data.type === 'stopped') { es.close(); showPaused(); setTimeout(connect, 2000) }
    }
    es.onerror = () => {
      if (downSince === null) downSince = Date.now()
      if (Date.now() - downSince > PAUSE_AFTER_MS) showPaused()
      setStatus('Reconnecting…', '#d9a557')
      // EventSource retries by itself while the port answers; if it gave up, start over.
      if (es.readyState === EventSource.CLOSED) setTimeout(connect, 2000)
    }
  }

  function send(event) {
    event.timestamp = Date.now()
    fetch('/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
      .catch(() => {})
  }

  document.addEventListener('click', e => {
    const target = e.target.closest('[data-choice]')
    if (!target) return
    const group = target.closest('[data-group]')
    const multi = group && group.hasAttribute('data-multiselect')
    if (group && !multi) group.querySelectorAll('[data-choice]').forEach(o => o.classList.remove('selected'))
    target.classList.toggle('selected', multi ? !target.classList.contains('selected') : true)
    send({
      type: 'click',
      choice: target.dataset.choice,
      group: group ? group.dataset.group : null,
      selected: target.classList.contains('selected'),
      text: (target.innerText || target.textContent).trim().replace(/\s+/g, ' ').slice(0, 200),
    })
  })

  window.visualize = {
    send,
    choice: (value, meta) => send(Object.assign({ type: 'choice', value }, meta || {})),
  }

  connect()
})()
