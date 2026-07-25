(() => {
  'use strict'

  const script = document.querySelector('script[data-search-path]')
  const layer = document.getElementById('search-layer')
  const openButton = document.getElementById('search-open')
  const closeButton = document.getElementById('search-close')
  const backdrop = document.getElementById('search-close-backdrop')
  const input = document.getElementById('search-input')
  const status = document.getElementById('search-status')
  const results = document.getElementById('search-results')
  const searchPath = script ? script.dataset.searchPath : '/search.xml'
  const limit = script ? Number(script.dataset.searchLimit) || 12 : 12
  let entries = null
  let loading = null

  if (!layer || !openButton || !input) return

  const stripHtml = html => {
    const documentNode = new DOMParser().parseFromString(html || '', 'text/html')
    return (documentNode.body.textContent || '').replace(/\s+/g, ' ').trim()
  }

  const loadEntries = () => {
    if (entries) return Promise.resolve(entries)
    if (loading) return loading

    status.textContent = '正在载入文章索引…'
    loading = fetch(searchPath)
      .then(response => {
        if (!response.ok) throw new Error(`Search index request failed: ${response.status}`)
        return response.text()
      })
      .then(xmlText => {
        const xml = new DOMParser().parseFromString(xmlText, 'application/xml')
        entries = [...xml.querySelectorAll('entry')].map(entry => ({
          title: entry.querySelector('title')?.textContent?.trim() || '',
          url: entry.querySelector('url')?.textContent?.trim() || entry.querySelector('link')?.getAttribute('href') || '',
          content: stripHtml(entry.querySelector('content')?.textContent || '')
        }))
        status.textContent = `已载入 ${entries.length} 篇文章`
        return entries
      })
      .catch(() => {
        entries = []
        status.textContent = '搜索索引载入失败，请稍后重试'
        return entries
      })

    return loading
  }

  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const highlight = (value, terms) => {
    const escaped = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    if (!terms.length) return escaped
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
    return escaped.replace(pattern, '<mark>$1</mark>')
  }

  const render = query => {
    const normalized = query.trim().toLowerCase()
    results.innerHTML = ''
    if (!normalized) {
      status.textContent = entries ? `已载入 ${entries.length} 篇文章` : '输入关键词开始搜索'
      return
    }

    const terms = normalized.split(/\s+/).filter(Boolean)
    const matches = entries
      .map(entry => {
        const title = entry.title.toLowerCase()
        const content = entry.content.toLowerCase()
        const score = terms.reduce((total, term) => total + (title.includes(term) ? 8 : 0) + (content.includes(term) ? 1 : 0), 0)
        return { entry, score }
      })
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)

    status.textContent = matches.length ? `找到 ${matches.length} 条相关结果` : '没有找到相关文章'
    matches.forEach(({ entry }) => {
      const item = document.createElement('li')
      item.className = 'search-result'
      const link = document.createElement('a')
      link.href = entry.url
      const title = document.createElement('strong')
      title.innerHTML = highlight(entry.title, terms)
      const excerpt = document.createElement('p')
      const firstIndex = Math.max(0, Math.min(...terms.map(term => {
        const index = entry.content.toLowerCase().indexOf(term)
        return index < 0 ? entry.content.length : index
      })) - 42)
      excerpt.innerHTML = highlight(entry.content.slice(firstIndex, firstIndex + 180), terms)
      link.append(title, excerpt)
      item.appendChild(link)
      results.appendChild(item)
    })
  }

  const open = async () => {
    layer.hidden = false
    document.body.style.overflow = 'hidden'
    await loadEntries()
    input.focus()
  }

  const close = () => {
    layer.hidden = true
    document.body.style.overflow = ''
    openButton.focus()
  }

  openButton.addEventListener('click', open)
  closeButton && closeButton.addEventListener('click', close)
  backdrop && backdrop.addEventListener('click', close)
  input.addEventListener('input', () => entries && render(input.value))

  document.addEventListener('keydown', event => {
    if (event.key === '/' && layer.hidden && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault()
      open()
    } else if (event.key === 'Escape' && !layer.hidden) {
      close()
    }
  })
})()
