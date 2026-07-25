(() => {
  'use strict'

  const root = document.documentElement
  const themeToggle = document.getElementById('theme-toggle')
  const navToggle = document.getElementById('nav-toggle')
  const siteNav = document.getElementById('site-nav')
  const profileToggle = document.getElementById('profile-toggle')
  const profileBackdrop = document.getElementById('profile-backdrop')
  const personalPanel = document.getElementById('personal-drawer')
  const backToTop = document.getElementById('back-to-top')
  const progressBar = document.getElementById('reading-progress-bar')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const uniqueFontSample = (elements, limit = 12000) => {
    const characters = new Set()

    elements.forEach(element => {
      for (const character of element.textContent || '') {
        if (!/\s/.test(character)) characters.add(character)
        if (characters.size >= limit) return
      }
    })

    return [...characters].join('')
  }

  const activateFontWhenReady = ({ family, className, elements, timeout }) => {
    if (!document.fonts || !elements.length) return

    const sample = uniqueFontSample(elements)
    if (!sample) return

    let expired = false
    const timer = window.setTimeout(() => {
      expired = true
    }, timeout)

    document.fonts.load(`1em "${family}"`, sample)
      .then(fonts => {
        window.clearTimeout(timer)
        if (!expired && fonts.length) root.classList.add(className)
      })
      .catch(() => {
        window.clearTimeout(timer)
      })
  }

  const readingFontStylesheet = document.getElementById('reading-font-stylesheet')
  const readingFontTargets = [
    ...document.querySelectorAll('.post-hero h1, .post-content')
  ]

  if (readingFontStylesheet && readingFontTargets.length) {
    let readingFontStarted = false
    const startReadingFont = () => {
      if (readingFontStarted) return
      readingFontStarted = true
      activateFontWhenReady({
        family: 'LXGW WenKai',
        className: 'font-reading-ready',
        elements: readingFontTargets,
        timeout: 3000
      })
    }

    if (readingFontStylesheet.sheet && readingFontStylesheet.media === 'all') {
      startReadingFont()
    } else {
      readingFontStylesheet.addEventListener('load', startReadingFont, { once: true })
    }
  }

  const codeFontTargets = [
    ...document.querySelectorAll('.post-content pre, .post-content code, .page-content pre, .page-content code')
  ]

  if (codeFontTargets.length) {
    activateFontWhenReady({
      family: 'Maple Mono NF',
      className: 'font-code-ready',
      elements: codeFontTargets,
      timeout: 2200
    })
  }

  const setTheme = theme => {
    root.dataset.theme = theme
    localStorage.setItem('euler-color-mode', theme)
    const themeColor = document.querySelector('meta[name="theme-color"]')
    if (themeColor) themeColor.content = theme === 'dark' ? '#071017' : '#f4f2ec'

    const giscus = document.querySelector('iframe.giscus-frame')
    if (giscus) {
      giscus.contentWindow.postMessage({
        giscus: { setConfig: { theme: theme === 'dark' ? 'dark' : 'light' } }
      }, 'https://giscus.app')
    }

    window.dispatchEvent(new CustomEvent('euler:themechange', {
      detail: { theme }
    }))
  }

  themeToggle && themeToggle.addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')
  })

  const closeNavigation = () => {
    if (!siteNav || !navToggle) return
    siteNav.classList.remove('is-open')
    navToggle.setAttribute('aria-expanded', 'false')
  }

  navToggle && navToggle.addEventListener('click', () => {
    const isOpen = siteNav.classList.toggle('is-open')
    navToggle.setAttribute('aria-expanded', String(isOpen))
  })

  document.addEventListener('click', event => {
    if (!siteNav || !navToggle || !siteNav.classList.contains('is-open')) return
    if (!siteNav.contains(event.target) && !navToggle.contains(event.target)) closeNavigation()
  })

  const closeProfile = () => {
    document.body.classList.remove('profile-is-open')
    profileToggle && profileToggle.setAttribute('aria-expanded', 'false')
  }

  if (personalPanel && profileToggle) {
    document.body.classList.add('has-personal-panel')
    profileToggle.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('profile-is-open')
      profileToggle.setAttribute('aria-expanded', String(isOpen))
    })
    profileBackdrop && profileBackdrop.addEventListener('click', closeProfile)
  }

  const updateScrollState = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight
    const ratio = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0
    if (progressBar) progressBar.style.width = `${ratio * 100}%`
    if (backToTop) backToTop.classList.toggle('is-visible', window.scrollY > 520)
  }

  document.addEventListener('scroll', updateScrollState, { passive: true })
  updateScrollState()

  backToTop && backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  })

  const runtime = document.getElementById('site-runtime')
  if (runtime && runtime.dataset.since) {
    const sinceValue = runtime.dataset.since
    const since = new Date(sinceValue.includes('T') ? sinceValue : `${sinceValue}T00:00:00+08:00`)
    const days = Math.max(1, Math.floor((Date.now() - since.getTime()) / 86400000))
    runtime.textContent = `${days} 天`
  }

  const homeQuote = document.getElementById('home-quote')
  if (homeQuote) {
    let quotes = []
    try {
      quotes = JSON.parse(homeQuote.dataset.quotes || '[]')
    } catch (_) {
      quotes = []
    }

    if (quotes.length && !reduceMotion) {
      let quoteIndex = 0
      let characterIndex = 0
      let deleting = false

      const typeQuote = () => {
        const content = quotes[quoteIndex]
        characterIndex += deleting ? -1 : 1
        homeQuote.textContent = content.slice(0, characterIndex)

        if (!deleting && characterIndex === content.length) {
          deleting = true
          window.setTimeout(typeQuote, 2400)
          return
        }

        if (deleting && characterIndex === 0) {
          deleting = false
          quoteIndex = (quoteIndex + 1) % quotes.length
          window.setTimeout(typeQuote, 420)
          return
        }

        window.setTimeout(typeQuote, deleting ? 42 : 92)
      }

      homeQuote.textContent = ''
      window.setTimeout(typeQuote, 420)
    }
  }

  document.querySelectorAll('[data-random-cover="true"]').forEach((cover, index) => {
    const source = String(cover.dataset.coverSource || '').replace(/\/$/, '')
    const fallback = cover.dataset.coverFallback
    if (!source) return

    const nonce = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`
    const randomUrl = `${source}/seed/${encodeURIComponent(nonce)}/960/540`
    const image = new Image()

    const applyCover = url => {
      if (!url) return
      cover.style.setProperty('--cover-image', `url("${url}")`)
      cover.classList.add('tech-cover--image', 'is-cover-ready')
    }

    image.onerror = () => applyCover(fallback)
    applyCover(randomUrl)
    image.src = randomUrl
  })

  const copyText = async text => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  document.querySelectorAll('.copy-link-button').forEach(button => {
    button.addEventListener('click', async () => {
      const original = button.textContent
      await copyText(button.dataset.copyUrl || window.location.href)
      button.textContent = '已复制'
      window.setTimeout(() => { button.textContent = original }, 1600)
    })
  })

  const attachCopyButton = (host, source, toolbar = null) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'code-copy'
    button.textContent = '复制'
    button.setAttribute('aria-label', '复制代码')
    button.addEventListener('click', async () => {
      await copyText(source.innerText)
      button.textContent = '已复制'
      window.setTimeout(() => { button.textContent = '复制' }, 1400)
    })
    ;(toolbar || host).appendChild(button)
  }

  const getCodeLineCount = (host, source) => {
    const gutterLines = host.querySelectorAll('.gutter .line').length
    if (gutterLines) return gutterLines

    const renderedLines = host.querySelectorAll('.code .line').length
    if (renderedLines) return renderedLines

    const text = source.textContent.replace(/\r\n?/g, '\n').replace(/\n$/, '')
    return text ? text.split('\n').length : 0
  }

  const attachCollapseButton = (host, source, content, toolbar, label) => {
    const lineCount = getCodeLineCount(host, source)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'code-toggle'
    label.textContent = `${label.textContent} · ${lineCount} 行`

    const setCollapsed = collapsed => {
      host.classList.toggle('is-collapsed', collapsed)
      content.hidden = collapsed
      button.textContent = collapsed ? '展开' : '收起'
      button.setAttribute('aria-expanded', String(!collapsed))
      button.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}代码，共 ${lineCount} 行`)
      button.title = `${collapsed ? '展开' : '收起'}代码`
    }

    button.addEventListener('click', () => {
      setCollapsed(!host.classList.contains('is-collapsed'))
    })
    toolbar.appendChild(button)
    host.dataset.lineCount = String(lineCount)
    setCollapsed(lineCount > 30)
  }

  document.querySelectorAll('.post-content figure.highlight, .page-content figure.highlight').forEach(highlight => {
    const source = highlight.querySelector('.code pre') || highlight.querySelector('pre code') || highlight.querySelector('pre')
    if (!source) return
    const content = highlight.querySelector('table') || source

    const language = [...highlight.classList].find(name => name !== 'highlight') || 'code'
    const toolbar = document.createElement('div')
    toolbar.className = 'highlight-tools'
    const label = document.createElement('span')
    label.className = 'code-lang'
    label.textContent = language
    toolbar.appendChild(label)
    attachCollapseButton(highlight, source, content, toolbar, label)
    attachCopyButton(highlight, source, toolbar)
    highlight.prepend(toolbar)
  })

  document.querySelectorAll('.post-content pre, .page-content pre').forEach(pre => {
    if (pre.closest('figure.highlight')) return
    const source = pre.querySelector('code') || pre
    const shell = document.createElement('figure')
    shell.className = 'highlight code-standalone'
    const toolbar = document.createElement('div')
    toolbar.className = 'highlight-tools'
    const label = document.createElement('span')
    label.className = 'code-lang'
    label.textContent = source.className.replace(/^language-/, '') || 'code'
    toolbar.appendChild(label)
    pre.replaceWith(shell)
    shell.append(toolbar, pre)
    attachCollapseButton(shell, source, pre, toolbar, label)
    attachCopyButton(shell, source, toolbar)
  })

  const toc = document.getElementById('post-toc')
  const tocOpen = document.getElementById('mobile-toc-open')
  const tocClose = document.getElementById('mobile-toc-close')

  const closeToc = () => {
    if (!toc || !tocOpen) return
    toc.classList.remove('is-open')
    tocOpen.setAttribute('aria-expanded', 'false')
  }

  tocOpen && tocOpen.addEventListener('click', () => {
    const isOpen = toc.classList.toggle('is-open')
    tocOpen.setAttribute('aria-expanded', String(isOpen))
  })
  tocClose && tocClose.addEventListener('click', closeToc)

  if (toc) {
    const headings = [...document.querySelectorAll('.post-content h2[id], .post-content h3[id], .post-content h4[id]')]
    const tocLinks = [...toc.querySelectorAll('a')]
    const linkByHash = new Map(tocLinks.map(link => [decodeURIComponent(link.hash.slice(1)), link]))

    if ('IntersectionObserver' in window && headings.length) {
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (!visible.length) return
        tocLinks.forEach(link => link.classList.remove('is-active'))
        const active = linkByHash.get(visible[0].target.id)
        if (active) active.classList.add('is-active')
      }, { rootMargin: '-90px 0px -70% 0px' })
      headings.forEach(heading => observer.observe(heading))
    }

    tocLinks.forEach(link => link.addEventListener('click', closeToc))
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeNavigation()
      closeToc()
      closeProfile()
    }
  })
})()
