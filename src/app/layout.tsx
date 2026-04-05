import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/Navbar'
import { AuthProvider } from '@/context/AuthContext'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'POS Verde',
  description: 'Punto de venta para recaudería con báscula Bluetooth',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geist.variable} h-full`}>
      <body className="h-full flex flex-col bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>
          <Navbar />
          {/* flex-1 + overflow-hidden so POS grid fills the remaining viewport height */}
          <main className="flex-1 overflow-hidden">{children}</main>
        </AuthProvider>
      </body>
    </html>
  )
}
