import { redirect } from 'next/navigation'

export default function ReceitasPage() {
  redirect('/financas?tab=receitas')
}
