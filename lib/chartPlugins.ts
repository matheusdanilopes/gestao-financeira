import type { MutableRefObject } from 'react'

/**
 * Crosshair plugin criado uma única vez por componente.
 * Lê isDarkRef.current no momento do draw, evitando recriar o objeto a cada
 * mudança de tema e eliminando re-registro desnecessário no Chart.js.
 */
export function makeCrosshairPlugin(
  id: string,
  isDarkRef: MutableRefObject<boolean>,
  darkOpacity = 0.14,
  lightOpacity = 0.10,
) {
  return {
    id,
    afterDatasetsDraw(chart: any) {
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
}
