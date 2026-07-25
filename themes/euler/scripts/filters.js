'use strict'

const unusedKatexStylesheet = /<link href="https:\/\/cdn\.bootcss\.com\/KaTeX\/[^"]+\/katex\.min\.css" rel="stylesheet" \/>/g

hexo.extend.filter.register(
  'after_render:html',
  function removeUnusedKatexStylesheet(html) {
    return html.replace(unusedKatexStylesheet, '')
  },
  100
)
