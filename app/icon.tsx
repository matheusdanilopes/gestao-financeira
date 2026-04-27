import { ImageResponse } from 'next/og'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          borderRadius: 100,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #28b67c 0%, #0d8053 55%, #052f24 100%)',
        }}
      >
        <div style={{ position: 'absolute', left: 140, top: 270, width: 45, height: 95, borderRadius: 10, background: 'linear-gradient(180deg, #79ea57 0%, #26b05e 100%)' }} />
        <div style={{ position: 'absolute', left: 210, top: 230, width: 52, height: 135, borderRadius: 10, background: 'linear-gradient(180deg, #79ea57 0%, #26b05e 100%)' }} />
        <div style={{ position: 'absolute', left: 288, top: 180, width: 58, height: 185, borderRadius: 11, background: 'linear-gradient(180deg, #79ea57 0%, #26b05e 100%)' }} />

        <div style={{ position: 'absolute', left: 100, top: 315, width: 300, height: 16, background: '#f7fafc', transform: 'rotate(-36deg)', borderRadius: 12 }} />
        <div style={{ position: 'absolute', left: 340, top: 130, width: 0, height: 0, borderTop: '24px solid transparent', borderBottom: '24px solid transparent', borderLeft: '48px solid #f7fafc', transform: 'rotate(-18deg)' }} />

        <div style={{ position: 'absolute', left: 95, right: 95, bottom: 88, height: 150, borderRadius: 54, background: 'linear-gradient(120deg, #f8fbfb 0%, #cfd9db 100%)' }} />
        <div style={{ position: 'absolute', right: 70, bottom: 118, width: 180, height: 90, borderRadius: 40, background: '#0f8a59', border: '4px solid #4add9e' }} />
        <div style={{ position: 'absolute', right: 142, bottom: 144, width: 38, height: 38, borderRadius: 999, background: '#f3f7f8' }} />
        <div style={{ position: 'absolute', right: 154, bottom: 156, width: 14, height: 14, borderRadius: 999, background: '#0d7f53' }} />
      </div>
    ),
    {
      ...size,
    }
  )
}
