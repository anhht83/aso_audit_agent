import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ASO Audit',
  description: 'Paste an Apple App Store URL, get a real ASO audit.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
