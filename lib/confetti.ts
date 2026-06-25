'use client'

export async function fireWishlistConfetti(clientX: number, clientY: number): Promise<void> {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const confetti = (await import('canvas-confetti')).default
  confetti({
    particleCount: 40,
    spread: 55,
    startVelocity: 22,
    decay: 0.88,
    scalar: 0.85,
    ticks: 55,
    origin: { x: clientX / window.innerWidth, y: clientY / window.innerHeight },
    colors: ['#10b981', '#34d399', '#6ee7b7', '#4f46e5', '#818cf8', '#fbbf24'],
    gravity: 1.2,
    disableForReducedMotion: true,
  })
}
