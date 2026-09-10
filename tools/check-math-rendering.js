'use strict'

const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')

const outputDirectory = path.resolve(process.argv[2] || 'public')
const sourceDirectory = path.resolve('source')
const localKatexStylesheet = '/vendor/katex/katex.min.css'
const unrenderedMathPattern = /\$|\\[()[\]]|\\[A-Za-z]+/
const failures = []

function collectHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) return collectHtmlFiles(entryPath)
    return entry.name.endsWith('.html') ? [entryPath] : []
  })
}

function collectMarkdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) return collectMarkdownFiles(entryPath)
    return entry.name.endsWith('.md') ? [entryPath] : []
  })
}

function report(file, message) {
  failures.push(`${path.relative(outputDirectory, file)}: ${message}`)
}

function contextAround(text, index) {
  const start = Math.max(0, index - 60)
  return text.slice(start, index + 100).replace(/\s+/g, ' ').trim()
}

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

if (!fs.existsSync(outputDirectory)) {
  console.error(`Math check failed: output directory does not exist: ${outputDirectory}`)
  process.exit(1)
}

const htmlFiles = collectHtmlFiles(outputDirectory)
let mathPages = 0
let mathNodes = 0

if (fs.existsSync(sourceDirectory)) {
  for (const file of collectMarkdownFiles(sourceDirectory)) {
    const source = stripMarkdownCode(fs.readFileSync(file, 'utf8'))
    const legacyDelimiter = source.match(/\\[()[\]]/)

    if (legacyDelimiter) {
      const line = source.slice(0, legacyDelimiter.index).split('\n').length
      const context = source.split('\n')[line - 1].trim()
      failures.push(
        `${path.relative(process.cwd(), file)}:${line}: legacy math delimiter ${legacyDelimiter[0]} near "${context}"`
      )
    }
  }
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8')
  const $ = cheerio.load(html)
  const title = $('title').text().trim() || '(untitled page)'
  const pageMathNodes = $('.katex').length
  const stylesheetLinks = $('link[rel~="stylesheet"]')
    .map((index, element) => $(element).attr('href'))
    .get()
    .filter(Boolean)
  const katexStylesheets = stylesheetLinks.filter(href => /katex(?:\.min)?\.css(?:[?#]|$)/i.test(href))
  const localStylesheets = katexStylesheets.filter(href => href.split(/[?#]/, 1)[0].endsWith(localKatexStylesheet))

  if ($('.katex-error').length) {
    report(file, `${title}: contains .katex-error`)
  }

  if (pageMathNodes) {
    mathPages++
    mathNodes += pageMathNodes

    if (localStylesheets.length !== 1 || katexStylesheets.length !== 1) {
      report(file, `${title}: expected exactly one local KaTeX stylesheet, found ${katexStylesheets.length}`)
    }
  } else if (katexStylesheets.length) {
    report(file, `${title}: loads KaTeX stylesheet without rendered math`)
  }

  $('pre, code, script, style, textarea, .katex').remove()
  const visibleText = $('body').text()
  const unrendered = visibleText.match(unrenderedMathPattern)

  if (unrendered) {
    report(file, `${title}: unrendered math near "${contextAround(visibleText, unrendered.index)}"`)
  }
}

const katexStylesheetPath = path.join(outputDirectory, 'vendor', 'katex', 'katex.min.css')

if (!fs.existsSync(katexStylesheetPath)) {
  failures.push(`vendor/katex/katex.min.css: generated stylesheet is missing`)
} else {
  const stylesheet = fs.readFileSync(katexStylesheetPath, 'utf8')
  const assetReferences = [...stylesheet.matchAll(/url\(([^)]+)\)/g)]
    .map(match => match[1].trim().replace(/^['"]|['"]$/g, ''))
    .filter(reference => !/^(?:data:|https?:|\/\/)/i.test(reference))

  for (const reference of new Set(assetReferences)) {
    const assetPath = path.resolve(path.dirname(katexStylesheetPath), reference.split(/[?#]/, 1)[0])

    if (!assetPath.startsWith(outputDirectory + path.sep) || !fs.existsSync(assetPath)) {
      failures.push(`${path.relative(outputDirectory, katexStylesheetPath)}: missing asset ${reference}`)
    }
  }
}

if (failures.length) {
  console.error(`Math check failed with ${failures.length} error(s):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`Math check passed: ${htmlFiles.length} HTML pages, ${mathPages} math pages, ${mathNodes} rendered formulas.`)
