import type { Metadata } from 'next'
import './globals.css'
import { ProvidersWithAuth } from '@/app/auth'

export const metadata: Metadata = {
  title: 'Leo Voice Workspace — code by voice',
  description:
    'A voice-driven code workspace: describe a file or a fix and the agent reads, writes and runs it.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">
        <ProvidersWithAuth>{children}</ProvidersWithAuth>
      </body>
    </html>
  )
}
