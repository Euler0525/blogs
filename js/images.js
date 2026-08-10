(() => {
  'use strict'

  const images = document.querySelectorAll(
    '.post-content img:not(.no-lightbox), .page-content img:not(.no-lightbox)'
  )

  images.forEach(image => {
    if (image.parentElement.tagName === 'A') return

    const source = image.dataset.lazySrc || image.currentSrc || image.src
    const link = document.createElement('a')
    link.href = source
    link.dataset.fancybox = 'gallery'
    link.dataset.caption = image.title || image.alt || ''
    link.dataset.thumb = source
    image.parentNode.insertBefore(link, image)
    link.appendChild(image)
  })

  if (!images.length || !window.Fancybox) return

  window.Fancybox.bind('[data-fancybox]', {
    Hash: false,
    Thumbs: {
      showOnStart: false
    },
    Images: {
      Panzoom: {
        maxScale: 4
      }
    },
    Carousel: {
      transition: 'slide'
    },
    Toolbar: {
      display: {
        left: ['infobar'],
        middle: [
          'zoomIn',
          'zoomOut',
          'toggle1to1',
          'rotateCCW',
          'rotateCW',
          'flipX',
          'flipY'
        ],
        right: ['slideshow', 'thumbs', 'close']
      }
    }
  })
})()
