import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          borderRadius: 36,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #28b67c 0%, #0d8053 55%, #052f24 100%)',
        }}
      >
        <div style={{ position: 'absolute', left: 48, top: 94, width: 16, height: 34, borderRadius: 3, background: 'linear-gradient(180deg, #79ea57 0%, #26b05e 100%)' }} />
        <div style={{ position: 'absolute', left: 72, top: 78, width: 18, height: 50, borderRadius: 4, background: 'linear-gradient(180deg, #79ea57 0%, #26b05e 100%)' }} />
        <div style={{ position: 'absolute', left: 98, top: 60, width: 20, height: 68, borderRadius: 4, background: 'linear-gradient(180deg, #79ea57 0%, #26b05e 100%)' }} />

        <div style={{ position: 'absolute', left: 34, top: 106, width: 104, height: 6, background: '#f7fafc', transform: 'rotate(-34deg)', borderRadius: 6 }} />

        <div style={{ position: 'absolute', left: 32, right: 32, bottom: 30, height: 52, borderRadius: 20, background: 'linear-gradient(120deg, #f8fbfb 0%, #cfd9db 100%)' }} />
        <div style={{ position: 'absolute', right: 24, bottom: 40, width: 60, height: 30, borderRadius: 16, background: '#0f8a59', border: '2px solid #4add9e' }} />
        <div style={{ position: 'absolute', right: 46, bottom: 50, width: 12, height: 12, borderRadius: 999, background: '#f3f7f8' }} />
        <div style={{ position: 'absolute', right: 50, bottom: 54, width: 4, height: 4, borderRadius: 999, background: '#0d7f53' }} />
      </div>
    ),
    {
      ...size,
    }
  )
}
