export default function Loading() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-7 page-enter"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <div
        className="w-16 h-16 rounded-3xl flex items-center justify-center"
        style={{
          background: 'linear-gradient(145deg, #6366f1 0%, #4f46e5 55%, #4338ca 100%)',
          boxShadow:
            '0 12px 32px rgba(79,70,229,0.40), 0 4px 10px rgba(79,70,229,0.25), inset 0 1px 0 rgba(255,255,255,0.22)',
        }}
      >
        {/* TrendingUp icon inline — sem dependência de Lucide no Server Component */}
        <svg
          viewBox="0 0 24 24"
          className="w-8 h-8 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      </div>

      <div
        className="w-5 h-5 rounded-full border-2 animate-spin"
        style={{
          borderColor: 'rgba(99,102,241,0.2)',
          borderTopColor: '#6366f1',
        }}
      />
    </div>
  )
}
