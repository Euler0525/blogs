(() => {
  'use strict'

  const container = document.getElementById('posts-chart')
  if (!container || !window.echarts) return

  const parseData = value => {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      return []
    }
  }

  const months = parseData(container.dataset.months)
  const values = parseData(container.dataset.values)
  const chart = window.echarts.init(container)

  const render = () => {
    const isDark = document.documentElement.dataset.theme === 'dark'
    const ink = isDark ? 'rgba(229, 240, 244, .78)' : 'rgba(29, 48, 60, .76)'
    const faint = isDark ? 'rgba(142, 168, 181, .24)' : 'rgba(29, 48, 60, .14)'
    const tooltipBackground = isDark ? 'rgba(7, 16, 23, .96)' : 'rgba(255, 253, 248, .96)'
    const tooltipBorder = isDark ? 'rgba(77, 209, 201, .36)' : 'rgba(13, 113, 123, .24)'

    chart.setOption({
      title: {
        text: '文章发布统计图',
        left: 'center',
        top: 14,
        textStyle: {
          color: ink,
          fontFamily: '"Noto Serif SC", "Songti SC", serif',
          fontSize: 18,
          fontWeight: 600
        }
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBackground,
        borderColor: tooltipBorder,
        textStyle: { color: ink },
        formatter: parameters => {
          const item = parameters[0]
          return item ? `${item.axisValue}<br>文章篇数：${item.value}` : ''
        }
      },
      grid: {
        top: 72,
        right: 48,
        bottom: 48,
        left: 50,
        containLabel: true
      },
      xAxis: {
        name: '日期',
        type: 'category',
        boundaryGap: false,
        nameTextStyle: { color: ink },
        nameGap: 8,
        axisTick: { show: false },
        axisLabel: {
          color: ink,
          hideOverlap: true
        },
        axisLine: {
          lineStyle: { color: faint }
        },
        data: months
      },
      yAxis: {
        name: '文章篇数',
        type: 'value',
        minInterval: 1,
        nameTextStyle: { color: ink },
        axisTick: { show: false },
        axisLabel: { color: ink },
        axisLine: {
          show: true,
          lineStyle: { color: faint }
        },
        splitLine: {
          lineStyle: { color: faint, type: 'dashed' }
        }
      },
      series: [{
        name: '文章篇数',
        type: 'line',
        smooth: true,
        showSymbol: false,
        symbolSize: 8,
        lineStyle: {
          width: 2,
          color: '#26b8b0'
        },
        itemStyle: {
          color: '#26b8b0'
        },
        areaStyle: {
          opacity: 1,
          color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(83, 225, 173, .72)' },
            { offset: 1, color: 'rgba(1, 173, 220, .08)' }
          ])
        },
        data: values,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: {
            color: ink,
            type: 'dashed',
            opacity: .55
          },
          label: {
            color: ink,
            formatter: '平均值 {c}'
          },
          data: [{ type: 'average', name: '平均值' }]
        }
      }]
    }, true)
  }

  render()
  window.addEventListener('resize', () => chart.resize())
  window.addEventListener('euler:themechange', render)
  chart.on('click', 'series', event => {
    if (event.componentType !== 'series' || !event.name) return
    window.location.href = `/archives/${event.name.replace('-', '/')}/`
  })
})()
