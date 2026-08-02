import { redirect } from 'next/navigation'

export default function ContasPage() {
  redirect('/financas?tab=despesas')
}
