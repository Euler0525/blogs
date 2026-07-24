/**
 * Randomize article covers with Lorem Picsum photos.
 */
(function () {
  'use strict'

  const RANDOM_IMAGE_API = 'https://picsum.photos'
  const FALLBACK_COVER = '/img/404.webp'
  const FALLBACK_TOP_IMG = '/img/top.webp'

  const randomImageUrl = index => {
    const nonce = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`
    return `${RANDOM_IMAGE_API}/seed/${encodeURIComponent(nonce)}/960/540`
  }

  const getTargets = () => {
    const targets = []
    const addImg = img => {
      if (img && !img.dataset.bingRandomCover) targets.push({ type: 'img', el: img })
    }
    const addBg = el => {
      if (el && !el.dataset.bingRandomCover) targets.push({ type: 'bg', el })
    }

    document.querySelectorAll([
      '.post_cover img.post-bg',
      '.article-sort-item-img img',
      '.aside-list-item a.thumbnail img',
      '.pagination-post img.cover',
      '.relatedPosts-list img.cover'
    ].join(',')).forEach(addImg)

    addBg(document.querySelector('#page-header.post-bg'))

    return targets
  }

  const loadImage = url => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(url)
    img.onerror = reject
    img.src = url
  })

  const applyImage = (target, url) => {
    target.el.dataset.bingRandomCover = 'true'

    if (target.type === 'img') {
      target.el.src = url
      target.el.dataset.lazySrc = url
      target.el.setAttribute('data-lazy-src', url)
      target.el.onerror = () => {
        target.el.onerror = null
        target.el.src = FALLBACK_COVER
        target.el.dataset.lazySrc = FALLBACK_COVER
        target.el.setAttribute('data-lazy-src', FALLBACK_COVER)
      }
      return
    }

    target.el.style.backgroundImage = `url('${url}')`
  }

  const randomizeCovers = () => {
    const targets = getTargets()
    if (!targets.length) return

    targets.forEach((target, index) => {
      const fallback = target.type === 'bg' ? FALLBACK_TOP_IMG : FALLBACK_COVER
      const url = randomImageUrl(index)

      loadImage(url)
        .then(loadedUrl => applyImage(target, loadedUrl))
        .catch(() => applyImage(target, fallback))
    })

    if (window.lazyLoadInstance && typeof window.lazyLoadInstance.update === 'function') {
      window.lazyLoadInstance.update()
    }
  }

  document.addEventListener('DOMContentLoaded', randomizeCovers)
  window.addEventListener('load', randomizeCovers)
  document.addEventListener('pjax:complete', randomizeCovers)
  document.addEventListener('pjax:success', randomizeCovers)
})()
