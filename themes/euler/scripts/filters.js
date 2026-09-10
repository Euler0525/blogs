'use strict'

const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')
const katex = require('katex')
const markdownItKatex = require('@renbaoshuo/markdown-it-katex')

const katexDist = path.join(path.dirname(require.resolve('katex/package.json')), 'dist')
const katexFontDirectory = path.join(katexDist, 'fonts')
const katexFontFiles = fs.readdirSync(katexFontDirectory).filter(file => /\.(?:ttf|woff2?)$/.test(file))
const katexStylesheetPath = `${hexo.config.root || '/'}vendor/katex/katex.min.css`.replace(/\/{2,}/g, '/')
const katexStylesheetLink = `<link rel="stylesheet" href="${katexStylesheetPath}">`
const katexStylesheet = fs.readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8')
const unrenderedMathPattern = /\$|\\[()[\]]|\\[A-Za-z]+/

function stripMarkdownCode(source) {
  let fence = null

  return source
    .split(/\r?\n/)
    .map(line => {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)

      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) {
          fence = null
        }
        return ''
      }

      if (fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
        return ''
      }

      if (/^(?: {4}|\t)/.test(line)) return ''
      return line.replace(/(`+)(.*?)\1/g, match => ' '.repeat(match.length))
    })
    .join('\n')
}

function renderMath(source, displayMode, postPath) {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: 'error'
    })
  } catch (error) {
    const context = source.replace(/\s+/g, ' ').trim().slice(0, 160)
    throw new Error(
      `KaTeX ${displayMode ? 'display' : 'inline'} formula failed in ${postPath || '(unknown source)'} near "${context}": ${error.message}`,
      { cause: error }
    )
  }
}

hexo.extend.filter.register('markdown-it:renderer', function enableKatex(renderer) {
  if (renderer.eulerKatexEnabled) return

  renderer.use(markdownItKatex)
  renderer.renderer.rules.math_inline = (tokens, index, options, env) =>
    renderMath(tokens[index].content, false, env.postPath)
  renderer.renderer.rules.math_block = (tokens, index, options, env) =>
    `<p class="katex-block">${renderMath(tokens[index].content, true, env.postPath)}</p>\n`
  renderer.eulerKatexEnabled = true
})

hexo.extend.filter.register('before_post_render', function rejectLegacyMathDelimiters(data) {
  const source = stripMarkdownCode(data.content || '')
  const legacyDelimiter = source.match(/\\[()[\]]/)

  if (legacyDelimiter) {
    const line = source.slice(0, legacyDelimiter.index).split('\n').length
    const context = source.split('\n')[line - 1].trim()
    throw new Error(
      `Legacy math delimiter ${legacyDelimiter[0]} in ${data.source || data.path || data.title} at line ${line}: ${context}. Use $...$ or standalone $$...$$.`
    )
  }

  return data
})

hexo.extend.filter.register('after_post_render', function rejectUnrenderedMath(data) {
  const $ = cheerio.load(data.content || '', null, false)
  const renderError = $('.katex-error').first()

  if (renderError.length) {
    throw new Error(`KaTeX rendering failed in ${data.source || data.path || data.title}: ${renderError.text()}`)
  }

  $('pre, code, script, style, textarea, .katex').remove()
  const text = $.root().text()
  const unrendered = text.match(unrenderedMathPattern)

  if (unrendered) {
    const start = Math.max(0, unrendered.index - 60)
    const context = text.slice(start, unrendered.index + 100).replace(/\s+/g, ' ').trim()
    throw new Error(`Unrendered math delimiter in ${data.source || data.path || data.title}: ${context}`)
  }

  return data
})

hexo.extend.filter.register(
  'after_render:html',
  function useLocalKatexStylesheet(html) {
    if (!html.includes('class="katex') || html.includes(`href="${katexStylesheetPath}"`)) {
      return html
    }

    return html.replace(/<\/head>/i, `${katexStylesheetLink}</head>`)
  },
  100
)

hexo.extend.generator.register('euler-katex-assets', () => [
  {
    path: 'vendor/katex/katex.min.css',
    data: katexStylesheet
  },
  ...katexFontFiles.map(file => ({
    path: `vendor/katex/fonts/${file}`,
    data: fs.readFileSync(path.join(katexFontDirectory, file))
  }))
])
