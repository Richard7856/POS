import RouteGuard from '@/components/RouteGuard'

// All routes inside (protected)/ require an authenticated session.
// The (protected) prefix is a Next.js route group — it does not appear in the URL.
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard>{children}</RouteGuard>
}
