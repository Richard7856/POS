import { redirect } from 'next/navigation'

// Root → redirect to POS (the main screen)
export default function Home() {
  redirect('/pos')
}
