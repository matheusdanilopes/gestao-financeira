import type { MutableRefObject } from 'react'
import type { Plugin } from 'chart.js'

interface CrosshairChart {
  ctx: CanvasRenderingContext2D
  chartArea: { top: number; bottom: number }
  tooltip?: { _active?: Array<{ element: { x: number } }> }
}

export function makeCrosshairPlugin(
  id: string,
  isDarkRef: MutableRefObject<boolean>,
  darkOpacity = 0.14,
  lightOpacity = 0.10,
): Plugin<'line'> {
  const plugin = {
    id,
    afterDatasetsDraw(chart: CrosshairChart) {
      const { ctx, tooltip } = chart
      if (!tooltip?._active?.length) return
      const x = tooltip._active[0].element.x
      const { top, bottom } = chart.chartArea
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, bottom)
      ctx.lineWidth = 1
      ctx.strokeStyle = isDarkRef.current
        ? `rgba(255,255,255,${darkOpacity})`
        : `rgba(0,0,0,${lightOpacity})`
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.restore()
    },
  }
  return plugin as unknown as Plugin<'line'>
}
