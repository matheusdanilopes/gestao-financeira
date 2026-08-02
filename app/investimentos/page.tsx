import { redirect } from 'next/navigation'

export default function InvestimentosPage() {
  redirect('/financas?tab=investimentos')
}
