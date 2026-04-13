import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Trilogy Renewals Dashboard',
  description: 'Renewal pipeline tracker for Trilogy ISR team',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
