#!/bin/bash

echo "🔄 Atualizando arquivos do projeto financeiro..."

# 1. Backup do supabaseClient.ts (caso exista)
if [ -f lib/supabaseClient.ts ]; then
  cp lib/supabaseClient.ts lib/supabaseClient.ts.bak
fi

# 2. Criar/Atualizar lib/csvParser.ts com suporte a parcelas
mkdir -p lib
cat > lib/csvParser.ts << 'EOF'
import Papa from 'papaparse'
import { createHash } from 'crypto'

export interface TransacaoNubank {
  data: Date
  descricao: string
  valor: number
  responsavel: 'Matheus' | 'Jeniffer'
  projeto_fatura: Date
  hash_linha: string
  parcela_atual: number | null
  total_parcelas: number | null
}

export function processarCSV(csvText: string): TransacaoNubank[] {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const transacoes: TransacaoNubank[] = []

  for (const row of result.data as any[]) {
    const descricao = row.descricao || row.Descrição || ''
    const responsavel = descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

    const dataStr = row.data || row.Data || ''
    const [dia, mes, ano] = dataStr.split('/')
    const data = new Date(`${ano}-${mes}-${dia}`)

    const valorStr = (row.valor || row.Valor || '0').replace(',', '.')
    const valor = Math.abs(parseFloat(valorStr))

    const projeto_fatura = new Date(data.getFullYear(), data.getMonth(), 1)

    const hashString = `${dataStr}|${descricao}|${valorStr}`
    const hash_linha = createHash('sha256').update(hashString).digest('hex')

    // Identificação de parcelas
    let parcela_atual = null
    let total_parcelas = null
    const parcelaMatch = descricao.match(/(\d+)\/(\d+)/)
    if (parcelaMatch) {
      parcela_atual = parseInt(parcelaMatch[1])
      total_parcelas = parseInt(parcelaMatch[2])
    }

    transacoes.push({
      data,
      descricao,
      valor,
      responsavel,
      projeto_fatura,
      hash_linha,
      parcela_atual,
      total_parcelas
    })
  }
  return transacoes
}
EOF

# 3. Atualizar API de importação para salvar parcelas
mkdir -p app/api/import
cat > app/api/import/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { processarCSV } from '@/lib/csvParser'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 })

    const csvText = await file.text()
    const transacoes = processarCSV(csvText)
    
    let novosMatheus = 0, novosJeniffer = 0, totalValor = 0

    for (const transacao of transacoes) {
      const { data: existente } = await supabase
        .from('transacoes_nubank')
        .select('id')
        .eq('hash_linha', transacao.hash_linha)
        .single()

      if (!existente) {
        const { error } = await supabase.from('transacoes_nubank').insert([transacao])
        if (!error) {
          if (transacao.responsavel === 'Matheus') novosMatheus++
          else novosJeniffer++
          totalValor += transacao.valor
        }
      }
    }
    return NextResponse.json({ success: true, matheus: novosMatheus, jeniffer: novosJeniffer, total: totalValor.toFixed(2) })
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao processar CSV' }, { status: 500 })
  }
}
EOF

# 4. Atualizar API de projeção (lógica de parcelas)
mkdir -p app/api/projection
cat > app/api/projection/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { format, addMonths, startOfMonth } from 'date-fns'

export async function POST(req: NextRequest) {
  try {
    const { meses } = await req.json()
    const hoje = new Date()
    const resultados = { total: new Array(meses.length).fill(0), matheus: new Array(meses.length).fill(0), jeniffer: new Array(meses.length).fill(0), extra: new Array(meses.length).fill(0) }

    const { data: transacoes } = await supabase.from('transacoes_nubank').select('*')
    const { data: extras } = await supabase.from('planejamento').select('*').eq('categoria', 'Extra')

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(hoje, i))
      const mesStr = format(mesRef, 'yyyy-MM-dd')

      // Parcelas do cartão
      for (const t of transacoes) {
        const dataTransacao = new Date(t.data)
        const mesTransacao = startOfMonth(dataTransacao)
        const mesesDiff = (mesRef.getMonth() - mesTransacao.getMonth()) + (mesRef.getFullYear() - mesTransacao.getFullYear()) * 12

        if (t.parcela_atual && t.total_parcelas) {
          if (mesesDiff >= 0 && mesesDiff < t.total_parcelas) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        } else {
          if (mesStr === t.projeto_fatura) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        }
      }

      // Débitos Extras (parcelados ou fixos)
      for (const e of extras) {
        if (e.parcela_atual && e.total_parcelas) {
          const mesesDiff = i
          if (mesesDiff >= 0 && mesesDiff < e.total_parcelas) {
            resultados.extra[i] += e.valor_previsto
            resultados.total[i] += e.valor_previsto
          }
        } else {
          if (mesStr === e.mes_referencia) {
            resultados.extra[i] += e.valor_previsto
            resultados.total[i] += e.valor_previsto
          }
        }
      }
    }
    return NextResponse.json(resultados)
  } catch (error) {
    return NextResponse.json({ error: 'Erro na projeção' }, { status: 500 })
  }
}
EOF

# 5. Atualizar Dashboard
mkdir -p app/dashboard
cat > app/dashboard/page.tsx << 'EOF'
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import GraficoProjecao from '@/components/GraficoProjecao'
import DrawerDetalhes from '@/components/DrawerDetalhes'

export default function Dashboard() {
  const [fatura, setFatura] = useState({ totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0, jenifferAtual: 0, jenifferPrevisto: 0, sobraMatheus: 0, sobraJeniffer: 0 })
  const [resumoCaixa, setResumoCaixa] = useState({ totalGastos: 0, sobraLiquida: 0, percentualComprometimento: 0 })
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<any>(null)

  useEffect(() => { carregarDados() }, [])

  async function carregarDados() {
    const hoje = new Date()
    const primeiroDia = startOfMonth(hoje)
    const ultimoDia = endOfMonth(hoje)
    const mesRef = format(primeiroDia, 'yyyy-MM-dd')

    const { data: transacoes } = await supabase.from('transacoes_nubank').select('valor, responsavel').gte('data', format(primeiroDia, 'yyyy-MM-dd')).lte('data', format(ultimoDia, 'yyyy-MM-dd'))
    const totalRealizado = transacoes?.reduce((acc, t) => acc + t.valor, 0) || 0
    const matheusAtual = transacoes?.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0) || 0
    const jenifferAtual = transacoes?.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0) || 0

    const { data: planejamento } = await supabase.from('planejamento').select('*').eq('mes_referencia', mesRef)
    const matheusPrevisto = planejamento?.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
    const jenifferPrevisto = (planejamento?.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) + (planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)

    const receitaTotal = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
    const contasFixas = planejamento?.filter(p => p.categoria === 'Fixa').reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const debitosExtras = planejamento?.filter(p => p.categoria === 'Extra').reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const totalGastos = contasFixas + totalRealizado + debitosExtras
    const sobraLiquida = receitaTotal - totalGastos
    const percentualComprometimento = (totalGastos / receitaTotal) * 100

    setFatura({ totalRealizado, matheusAtual, matheusPrevisto, jenifferAtual, jenifferPrevisto, sobraMatheus: matheusPrevisto - matheusAtual, sobraJeniffer: jenifferPrevisto - jenifferAtual })
    setResumoCaixa({ totalGastos, sobraLiquida, percentualComprometimento: isNaN(percentualComprometimento) ? 0 : percentualComprometimento })
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <div className="sticky top-0 bg-gray-50 pt-2 pb-4 z-10"><h1 className="text-2xl font-bold">Dashboard Financeiro</h1><p className="text-sm text-gray-500">{format(new Date(), 'MMMM yyyy', { locale: ptBR })}</p></div>
      <div className="bg-white rounded-xl shadow p-4 mb-6"><h2 className="text-lg font-semibold mb-3">💳 Gestão de Fatura Nubank</h2><div className="text-2xl font-bold text-blue-600 mb-4">R$ {fatura.totalRealizado.toFixed(2)}</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 p-3 rounded-lg"><p className="font-medium">Matheus</p><p className="text-sm">Atual: R$ {fatura.matheusAtual.toFixed(2)}</p><p className="text-sm">Previsto: R$ {fatura.matheusPrevisto.toFixed(2)}</p><p className={`text-sm font-semibold ${fatura.sobraMatheus >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fatura.sobraMatheus >= 0 ? 'Sobra' : 'Excesso'}: R$ {Math.abs(fatura.sobraMatheus).toFixed(2)}</p></div>
          <div className="bg-gray-50 p-3 rounded-lg"><p className="font-medium">Jeniffer</p><p className="text-sm">Atual: R$ {fatura.jenifferAtual.toFixed(2)}</p><p className="text-sm">Previsto: R$ {fatura.jenifferPrevisto.toFixed(2)}</p><p className={`text-sm font-semibold ${fatura.sobraJeniffer >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fatura.sobraJeniffer >= 0 ? 'Sobra' : 'Excesso'}: R$ {Math.abs(fatura.sobraJeniffer).toFixed(2)}</p></div>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow p-4 mb-6"><h2 className="text-lg font-semibold mb-3">💰 Resumo de Caixa</h2><div className="space-y-2"><div className="flex justify-between"><span>Total de Gastos</span><span className="font-bold">R$ {resumoCaixa.totalGastos.toFixed(2)}</span></div><div className="flex justify-between"><span>Sobra Líquida</span><span className={`font-bold ${resumoCaixa.sobraLiquida >= 0 ? 'text-green-600' : 'text-red-600'}`}>R$ {resumoCaixa.sobraLiquida.toFixed(2)}</span></div><div className="flex justify-between"><span>Comprometimento da Renda</span><span className="font-bold">{resumoCaixa.percentualComprometimento.toFixed(1)}%</span></div></div></div>
      <div className="bg-white rounded-xl shadow p-4"><h2 className="text-lg font-semibold mb-3">📈 Projeção de Parcelamentos (6 meses)</h2><GraficoProjecao onPontoClicado={(serie, mes, valor, itens) => { setDetalhesPonto({ serie, mes, valor, itens }); setDrawerAberto(true) }} /></div>
      <DrawerDetalhes aberto={drawerAberto} onClose={() => setDrawerAberto(false)} dados={detalhesPonto} />
    </div>
  )
}
EOF

# 6. Atualizar componente do gráfico (datalabels e cores)
cat > components/GraficoProjecao.tsx << 'EOF'
'use client'
import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { addMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

export default function GraficoProjecao({ onPontoClicado }) {
  const [dadosGrafico, setDadosGrafico] = useState(null)
  useEffect(() => { carregarProjecao() }, [])
  async function carregarProjecao() {
    const meses = []
    const hoje = new Date()
    for (let i = 0; i < 6; i++) meses.push(format(addMonths(hoje, i), 'MMM/yyyy', { locale: ptBR }))
    const res = await fetch('/api/projection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meses }) })
    const { total, matheus, jeniffer, extra } = await res.json()
    setDadosGrafico({ labels: meses, datasets: [
      { label: 'Total', data: total, borderColor: 'rgb(139, 92, 246)', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderWidth: 3, tension: 0.3, fill: false },
      { label: 'Matheus', data: matheus, borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.3, fill: false },
      { label: 'Jeniffer', data: jeniffer, borderColor: 'rgb(236, 72, 153)', backgroundColor: 'rgba(236, 72, 153, 0.1)', tension: 0.3, fill: false },
      { label: 'Extra', data: extra, borderColor: 'rgb(234, 179, 8)', backgroundColor: 'rgba(234, 179, 8, 0.1)', tension: 0.3, fill: false }
    ] })
  }
  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false },
      datalabels: {
        backgroundColor: 'white', borderRadius: 4, padding: 4, font: { weight: 'bold', size: 11 },
        formatter: (value) => `R$ ${value.toFixed(0)}`,
        align: 'top', offset: 4
      }
    },
    onClick: async (event, elements) => {
      if (elements.length) {
        const { datasetIndex, index } = elements[0]
        const serie = dadosGrafico.datasets[datasetIndex].label
        const mes = dadosGrafico.labels[index]
        const valor = dadosGrafico.datasets[datasetIndex].data[index]
        const res = await fetch('/api/projection/details', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serie, mes, dataIndex: index }) })
        const { itens } = await res.json()
        onPontoClicado(serie, mes, valor, itens)
      }
    }
  }
  if (!dadosGrafico) return <div className="h-80 flex items-center justify-center">Carregando...</div>
  return <div className="h-80"><Line data={dadosGrafico} options={options} plugins={[ChartDataLabels]} /></div>
}
EOF

echo "✅ Todos os arquivos foram atualizados com sucesso!"
echo "⚠️ Agora você precisa executar a query SQL no Supabase para adicionar as colunas de parcela na tabela transacoes_nubank."
echo "Copie o comando abaixo e execute no SQL Editor do Supabase:"
echo ""
echo "ALTER TABLE transacoes_nubank ADD COLUMN IF NOT EXISTS parcela_atual INT, ADD COLUMN IF NOT EXISTS total_parcelas INT;"
echo ""
echo "Depois, reinicie o servidor: npm run dev"