import { redirect } from 'next/navigation'
import { getCurrentAccount } from '@/lib/auth/account'

export default async function FollowUpsLayout({ children }: { children: React.ReactNode }) {
  try {
    await getCurrentAccount()
  } catch {
    redirect('/login')
  }
  return children
}
