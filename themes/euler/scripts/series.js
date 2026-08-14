'use strict'

const collectionItems = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (Array.isArray(collection.data)) return collection.data
  if (typeof collection.toArray === 'function') return collection.toArray()
  return []
}

const timestamp = value => {
  const result = value && typeof value.valueOf === 'function' ? Number(value.valueOf()) : Number(value)
  return Number.isFinite(result) ? result : 0
}

const seriesSegment = name => String(name).trim().replace(/\s+/g, '-')

const seriesPath = name => `series/${seriesSegment(name)}/`

const buildSeries = collection => {
  const groups = new Map()

  collectionItems(collection).forEach(post => {
    if (post.series === undefined) return

    if (typeof post.series !== 'string' || !post.series.trim()) {
      throw new Error(`[Euler 专栏] 文章“${post.title}”的 series 必须是非空字符串`)
    }

    const name = post.series.trim()
    if (/[<>:"/\\|?*#%\u0000-\u001f]/.test(name) || name === '.' || name === '..') {
      throw new Error(`[Euler 专栏] 专栏“${name}”包含非法路径字符`)
    }

    const order = Number(post.series_order)
    if (!Number.isInteger(order) || order <= 0) {
      throw new Error(`[Euler 专栏] 文章“${post.title}”必须设置正整数 series_order`)
    }

    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(post)
  })

  const paths = new Map()
  const series = []

  groups.forEach((posts, name) => {
    const path = seriesPath(name)
    const pathKey = path.toLocaleLowerCase('zh-CN')
    if (paths.has(pathKey) && paths.get(pathKey) !== name) {
      throw new Error(`[Euler 专栏] 专栏“${name}”与“${paths.get(pathKey)}”生成了相同路径`)
    }
    paths.set(pathKey, name)

    const orders = new Map()
    posts.forEach(post => {
      const order = Number(post.series_order)
      if (orders.has(order)) {
        throw new Error(`[Euler 专栏] 专栏“${name}”的文章“${orders.get(order).title}”和“${post.title}”使用了重复的 series_order: ${order}`)
      }
      orders.set(order, post)
    })

    posts.sort((left, right) => Number(left.series_order) - Number(right.series_order))
    posts.forEach((post, index) => {
      const expected = index + 1
      if (Number(post.series_order) !== expected) {
        throw new Error(`[Euler 专栏] 专栏“${name}”的 series_order 必须从 1 连续编号，缺少第 ${expected} 篇`)
      }
    })

    const latestDate = posts.reduce((latest, post) => timestamp(post.date) > timestamp(latest) ? post.date : latest, posts[0].date)
    const updated = posts.reduce((latest, post) => {
      const candidate = post.updated || post.date
      return timestamp(candidate) > timestamp(latest) ? candidate : latest
    }, posts[0].updated || posts[0].date)

    series.push({
      name,
      path,
      posts,
      count: posts.length,
      latestDate,
      updated
    })
  })

  return series.sort((left, right) => timestamp(right.latestDate) - timestamp(left.latestDate) || left.name.localeCompare(right.name, 'zh-CN'))
}

if (typeof hexo !== 'undefined') {
  const allSeries = () => buildSeries(hexo.locals.get('posts'))

  hexo.extend.helper.register('euler_all_series', allSeries)

  hexo.extend.helper.register('euler_series_info', post => {
    if (!post || !post.series) return null
    const series = allSeries().find(item => item.name === String(post.series).trim())
    if (!series) return null
    return {
      ...series,
      order: Number(post.series_order)
    }
  })

  hexo.extend.helper.register('euler_series_posts', post => {
    const series = post && post.series
      ? allSeries().find(item => item.name === String(post.series).trim())
      : null
    return series ? series.posts : []
  })

  hexo.extend.generator.register('euler-series', locals => buildSeries(locals.posts).map(series => ({
    path: `${series.path}index.html`,
    layout: 'series',
    data: {
      title: series.name,
      description: `“${series.name}”专栏，共 ${series.count} 篇文章。`,
      type: 'series-detail',
      path: series.path,
      series: series.name,
      seriesPosts: series.posts,
      seriesCount: series.count
    }
  })))
}

module.exports = {
  buildSeries,
  seriesPath
}
