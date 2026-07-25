'use strict'

function escapeHtml(content) {
  return String(content)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

hexo.extend.tag.register(
  'mermaid',
  function mermaidTag(args, content) {
    return `<div class="mermaid">\n${escapeHtml(content)}\n</div>`
  },
  { ends: true }
)
