'use strict'

const defaultIndexGenerator = hexo.extend.generator.get('index')

hexo.extend.generator.register('index', function generateIndexWithoutSeries(locals) {
  return defaultIndexGenerator.call(this, {
    ...locals,
    posts: locals.posts.filter(post => !post.series)
  })
})
