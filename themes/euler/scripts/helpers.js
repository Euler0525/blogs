'use strict'

const collectionItems = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (Array.isArray(collection.data)) return collection.data
  if (typeof collection.toArray === 'function') return collection.toArray()
  return []
}

const categoryNames = post => collectionItems(post && post.categories).map(item => item.name)

const toneRules = [
  { tone: 'signal', names: ['通信', '射频'] },
  { tone: 'spectrum', names: ['信号处理', '数学', '基础知识'] },
  { tone: 'system', names: ['计算机系统', '网络'] },
  { tone: 'circuit', names: ['嵌入式', '电子电路', '接口'] },
  { tone: 'code', names: ['编程', '工具'] },
  { tone: 'neural', names: ['人工智能'] }
]

const postTone = post => {
  const names = categoryNames(post)
  const match = toneRules.find(rule => rule.names.some(name => names.includes(name)))
  return match ? match.tone : 'default'
}

const stableSeed = value => {
  const source = String(value || '')
  let hash = 0
  for (let index = 0; index < source.length; index++) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % 6
}

hexo.extend.helper.register('euler_collection', collectionItems)

hexo.extend.helper.register('euler_primary_category', post => {
  const items = collectionItems(post && post.categories)
  return items.length ? items[0] : null
})

hexo.extend.helper.register('euler_tone', post => postTone(post))

hexo.extend.helper.register('euler_seed', post => {
  const value = post && (post.path || post.slug || post.title)
  return `seed-${stableSeed(value)}`
})

hexo.extend.helper.register('euler_reading_time', post => {
  const content = String((post && post.content) || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
  const cjk = (content.match(/[\u3400-\u9fff]/g) || []).length
  const words = (content.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return Math.max(1, Math.ceil((cjk + words * 1.6) / 420))
})

hexo.extend.helper.register('euler_related_posts', post => {
  const limit = Number(hexo.theme.config.post && hexo.theme.config.post.related_count) || 3
  const names = new Set(categoryNames(post))
  if (!names.size) return []

  return hexo.locals.get('posts')
    .sort('-date')
    .toArray()
    .filter(candidate => candidate.path !== post.path)
    .map(candidate => ({
      post: candidate,
      score: categoryNames(candidate).filter(name => names.has(name)).length
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || right.post.date - left.post.date)
    .slice(0, limit)
    .map(item => item.post)
})

hexo.extend.helper.register('euler_monthly_posts', startMonth => {
  const posts = hexo.locals.get('posts').toArray()
  const fallbackMonth = posts.length
    ? posts.reduce((earliest, post) => post.date < earliest.date ? post : earliest).date.format('YYYY-MM')
    : new Date().toISOString().slice(0, 7)
  const normalizedStart = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(startMonth || ''))
    ? String(startMonth)
    : fallbackMonth
  const [startYear, startMonthIndex] = normalizedStart.split('-').map(Number)
  const current = new Date()
  const endYear = current.getFullYear()
  const endMonthIndex = current.getMonth() + 1
  const monthlyCounts = new Map()

  for (let year = startYear, month = startMonthIndex; year < endYear || (year === endYear && month <= endMonthIndex); month++) {
    if (month > 12) {
      year++
      month = 1
    }
    monthlyCounts.set(`${year}-${String(month).padStart(2, '0')}`, 0)
  }

  posts.forEach(post => {
    const month = post.date.format('YYYY-MM')
    if (monthlyCounts.has(month)) monthlyCounts.set(month, monthlyCounts.get(month) + 1)
  })

  return {
    months: [...monthlyCounts.keys()],
    values: [...monthlyCounts.values()]
  }
})
