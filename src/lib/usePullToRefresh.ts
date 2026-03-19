import { useState, useRef, useCallback } from 'react'

export function usePullToRefresh(
  onRefresh: () => Promise<void>,
  scrollRef?: React.RefObject<HTMLElement | null>
) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const startY = useRef(0)
  const startX = useRef(0)
  const currentPullY = useRef(0)
  const direction = useRef<'v' | 'h' | null>(null)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
    startX.current = e.touches[0].clientX
    direction.current = null
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (refreshing) return

    const dy = e.touches[0].clientY - startY.current
    const dx = e.touches[0].clientX - startX.current

    if (direction.current === null && (Math.abs(dy) > 5 || Math.abs(dx) > 5)) {
      direction.current = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h'
    }

    if (direction.current !== 'v' || dy <= 0) {
      if (currentPullY.current > 0) { currentPullY.current = 0; setPullY(0) }
      return
    }

    if (scrollRef?.current && scrollRef.current.scrollTop > 0) {
      if (currentPullY.current > 0) { currentPullY.current = 0; setPullY(0) }
      return
    }

    const val = Math.min(dy * 0.4, 80)
    currentPullY.current = val
    setPullY(val)
  }, [refreshing, scrollRef])

  const onTouchEnd = useCallback(async () => {
    if (currentPullY.current > 50) {
      setRefreshing(true)
      setPullY(0)
      currentPullY.current = 0
      await onRefreshRef.current()
      setRefreshing(false)
    } else {
      setPullY(0)
      currentPullY.current = 0
    }
  }, [])

  return { refreshing, pullY, onTouchStart, onTouchMove, onTouchEnd }
}
