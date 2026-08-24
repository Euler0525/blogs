'use strict'

const collectionItems = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (Array.isArray(collection.data)) return collection.data
  if (typeof collection.toArray === 'function') return collection.toArray()
  return []
}

const markdownToText = markdown => String(markdown || '')
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/^\s*(?:```|~~~).*$/gm, ' ')
  .replace(/\{%[\s\S]*?%\}/g, ' ')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, ' $1 ')
  .replace(/\[([^\]]+)\]\[[^\]]*\]/g, ' $1 ')
  .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^\s{0,3}(?:#{1,6}|>|[-+] |\d+\. )\s*/gm, ' ')
  .replace(/[*~`]+/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()

const taxonomyNames = collection => collectionItems(collection)
  .map(item => String(item && item.name ? item.name : item || '').trim())
  .filter(Boolean)

const buildSearchEntries = (posts, root = '/') => collectionItems(posts)
  .filter(post => post.indexing !== false)
  .map(post => ({
    title: String(post.title || ''),
    url: `${root}${post.path || ''}`.replace(/([^:]\/)\/+/g, '$1'),
    content: markdownToText([post.description, post._content].filter(Boolean).join('\n')),
    categories: taxonomyNames(post.categories),
    tags: taxonomyNames(post.tags)
  }))

if (typeof hexo !== 'undefined' && /\.json$/i.test(hexo.config.search && hexo.config.search.path)) {
  hexo.extend.generator.register('json', locals => ({
    path: hexo.config.search.path,
    data: JSON.stringify(buildSearchEntries(locals.posts.sort('-date'), hexo.config.root || '/'))
  }))
}

module.exports = {
  buildSearchEntries,
  markdownToText
}
