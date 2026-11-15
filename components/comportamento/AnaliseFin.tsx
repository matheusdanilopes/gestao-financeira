'use client'

/**
 * Análise do Fin — a parte de cima da tela, para quem não entende de finanças:
 * o recado do Fin, a nota em uma frase, quanto dá para gastar no próximo mês,
 * o que ele descobriu e as dicas com quanto cada uma economiza. Tabelas,
 * gráficos e contas ficam em "Ver detalhes" (ResultadoComportamento).
 */

import Link from 'next/link'
import {
  TrendingUp, TrendingDown, Lightbulb, CalendarDays, MessageCircle, ShieldCheck, Calculator, ChevronDown, Wallet, Sparkles,
} from 'lucide-react'
import { RoboAvatar } from '@/components/chat/RoboAvatar'
import { destaqueCurto, rotuloFaturaFoco } from '@/lib/comportamento/tipos'
import { rotuloMesIso } from '@/lib/comportamento/documento'
import type { AnaliseIA, IndicadorSaude, MetricasComportamento, ProximoMes } from '@/lib/comportamento/tipos'
import { AnelNota, rotuloNota } from './ResultadoComportamento'

const BRL_INTEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const brl = (v: number) => BRL_INTEIRO.format(Number.isFinite(v) ? v : 0)

/** O que cada faixa da nota quer dizer, sem jargão. */
function significadoNota(nota: number): string {
  if (nota >= 85) return 'Suas finanças estão muito bem. É manter o ritmo.'
  if (nota >= 75) return 'Você está no caminho certo, com poucos pontos para ajustar.'
  if (nota >= 50) return 'Dá para melhorar: alguns hábitos estão pesando no bolso.'
  if (nota >= 30) return 'O dinheiro está apertado. Vale agir já nas dicas abaixo.'
  return 'Situação delicada: o gasto está passando do que entra.'
}

function Caixa({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`bg-white rounded-3xl shadow-soft p-4 space-y-3 ${className}`}>{children}</section>
}

function Titulo({ Icon, cor, children }: { Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; cor: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-bold text-gray-900 tracking-tight">
      <Icon className={`w-4 h-4 ${cor}`} strokeWidth={2} />
      {children}
    </h2>
  )
}

function ComoCalculei({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl bg-gray-50 border border-gray-100">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-1.5 px-3 py-2
                          text-[11px] font-semibold text-primary-700 rounded-2xl
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
        <Calculator className="w-3.5 h-3.5" strokeWidth={2} />
        Como calculei
        <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 space-y-1.5 text-[11px] text-gray-600 leading-snug">{children}</div>
    </details>
  )
}

// ─── Recado do Fin ───────────────────────────────────────────────────────────

export function RecadoFin({ analise: a, metricas: m }: { analise: AnaliseIA; metricas?: MetricasComportamento }) {
  const fatura = m?.mesFoco ? rotuloFaturaFoco(m.mesFoco) : null
  return (
    <Caixa>
      {fatura && (
        <p className="text-[11px] font-semibold text-gray-500 flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          {fatura.titulo} · {fatura.compras}
        </p>
      )}
      <div className="flex items-start gap-3">
        <RoboAvatar tamanho={48} humor="feliz" titulo="Fin" className="shrink-0" />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-primary-50 px-3.5 py-3 space-y-1.5">
          <p className="text-[15px] font-bold text-gray-900 leading-snug">{a.manchete}</p>
          {a.resumo && <p className="text-[13px] text-gray-700 leading-relaxed">{a.resumo.replace(/\n+/g, ' ')}</p>}
        </div>
      </div>
      {a.perfil.nome && (
        <p className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" strokeWidth={2} />
          Seu jeito de gastar:
          <span className="font-semibold text-violet-700 bg-violet-50 rounded-full px-2 py-0.5">{a.perfil.nome}</span>
        </p>
      )}
    </Caixa>
  )
}

// ─── Nota em uma frase ───────────────────────────────────────────────────────

export function SaudeSimples({ metricas: m, notaAnterior }: { metricas: MetricasComportamento; notaAnterior: number | null }) {
  const nota = m.saude.nota
  const delta = notaAnterior === null ? null : nota - notaAnterior
  const ordenados = [...m.saude.indicadores].sort((x, y) => x.nota - y.nota)
  const pesam = ordenados.filter(i => i.nota < 60).slice(0, 2)
  const ajudam = [...ordenados].reverse().filter(i => i.nota >= 75).slice(0, 1)
  const linha = (i: IndicadorSaude, bom: boolean) => (
    <li key={i.chave} className="flex items-start gap-2 text-xs leading-snug">
      {bom
        ? <TrendingUp className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" strokeWidth={2.2} />
        : <TrendingDown className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" strokeWidth={2.2} />}
      <span className="text-gray-700"><b className="font-semibold">{i.nome}:</b> {i.medida}</span>
    </li>
  )

  return (
    <Caixa>
      <div className="flex items-center gap-4">
        <AnelNota nota={nota} tamanho={84} />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold text-gray-500">Saúde financeira</p>
          <p className="text-lg font-bold text-gray-900 leading-tight">{rotuloNota(nota)}</p>
          <p className="text-xs text-gray-600 leading-snug">{significadoNota(nota)}</p>
          {delta !== null && delta !== 0 && (
            <p className={`text-[11px] font-semibold ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {delta > 0 ? '+' : ''}{delta} pontos desde a análise anterior
            </p>
          )}
        </div>
      </div>
      {(pesam.length > 0 || ajudam.length > 0) && (
        <ul className="space-y-1.5 border-t border-gray-100 pt-3">
          {ajudam.map(i => linha(i, true))}
          {pesam.map(i => linha(i, false))}
        </ul>
      )}
    </Caixa>
  )
}

// ─── Próximo mês ─────────────────────────────────────────────────────────────

export function ProximoMesSimples({ p }: { p: ProximoMes }) {
  const sobra = p.folga >= 0
  return (
    <Caixa>
      <Titulo Icon={Wallet} cor="text-primary-600">{rotuloMesIso(p.mes)}</Titulo>
      {p.margemLivre > 0 ? (
        <div className="space-y-0.5">
          <p className="text-xs text-gray-500">Para fechar o mês no azul, gaste no máximo</p>
          <p className="text-2xl font-bold text-gray-900 num leading-tight">
            {brl(p.tetoSemanal)} <span className="text-sm font-semibold text-gray-500">por semana</span>
          </p>
          <p className="text-[11px] text-gray-400">em compras novas e extras, depois de pagar contas, parcelas e assinaturas.</p>
        </div>
      ) : (
        <p className="text-sm font-semibold text-red-600 leading-snug">
          As contas e parcelas já passam do que vai entrar: qualquer compra nova aumenta o saldo negativo.
        </p>
      )}
      <p className={`text-xs font-semibold rounded-2xl px-3 py-2 ${sobra ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
        {sobra
          ? `Se gastar como num mês normal, devem sobrar ${brl(p.folga)}.`
          : `Se gastar como num mês normal, devem faltar ${brl(Math.abs(p.folga))}.`}
      </p>
      <ComoCalculei>
        <p className="num">
          {p.receitaFonte === 'planejada' ? 'Receita planejada' : 'Receita média'} {brl(p.receita)} − contas {brl(p.contas)} −
          parcelas já feitas {brl(p.parcelas)}{p.assinaturas > 0 ? ` − assinaturas ${brl(p.assinaturas)}` : ''} ={' '}
          <b>{brl(p.margemLivre)}</b> livres no mês.
        </p>
        {p.margemLivre > 0 && <p className="num">Livre no mês ÷ semanas do mês = {brl(p.tetoSemanal)} por semana.</p>}
        <p className="num">
          Livre no mês {brl(p.margemLivre)} − compras de um mês normal {brl(p.variavelHabitual)} = {sobra ? 'sobra' : 'falta'} de {brl(Math.abs(p.folga))}.
        </p>
      </ComoCalculei>
    </Caixa>
  )
}

// ─── O que eu descobri ───────────────────────────────────────────────────────

export function Descobertas({ analise: a }: { analise: AnaliseIA }) {
  if (a.padroes.length === 0) return null
  return (
    <Caixa>
      <Titulo Icon={Lightbulb} cor="text-amber-500">O que eu descobri</Titulo>
      <ul className="space-y-2.5">
        {a.padroes.map(p => {
          const cor = p.impacto === 'negativo' ? 'text-red-500 bg-red-50' : p.impacto === 'positivo' ? 'text-green-700 bg-green-50' : 'text-gray-700 bg-gray-100'
          const destaque = destaqueCurto(p.destaque)
          return (
            <li key={p.titulo} className="flex items-start gap-3">
              <span className={`shrink-0 min-w-[4.5rem] text-center rounded-xl px-2 py-1.5 text-sm font-bold num ${cor}`}>
                {destaque || '•'}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-gray-900 leading-snug">{p.titulo}</p>
                <p className="text-xs text-gray-600 leading-snug">{p.descricao}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Caixa>
  )
}

// ─── Minhas dicas ────────────────────────────────────────────────────────────

const DIFICULDADE: Record<string, string> = { facil: 'Fácil', media: 'Médio', dificil: 'Difícil' }

export function Dicas({ analise: a }: { analise: AnaliseIA }) {
  if (a.planoDeAcao.length === 0) return null
  const total = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)
  const comRegra = a.planoDeAcao.filter(p => p.economiaMensal > 0)
  return (
    <Caixa>
      <Titulo Icon={ShieldCheck} cor="text-green-600">Minhas dicas para você</Titulo>
      {total > 0 && (
        <div className="rounded-2xl bg-green-50 px-3.5 py-2.5">
          <p className="text-xs text-green-700">Seguindo as dicas, você pode economizar</p>
          <p className="text-xl font-bold text-green-700 num leading-tight">
            {brl(total)} <span className="text-sm font-semibold">por mês</span>
          </p>
          <p className="text-[11px] text-green-700 num">≈ {brl(total * 12)} em um ano</p>
        </div>
      )}
      <ol className="space-y-3">
        {a.planoDeAcao.map((p, i) => (
          <li key={p.acao} className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-[13px] font-semibold text-gray-900 leading-snug">{p.acao}</p>
              <p className="text-xs text-gray-600 leading-snug">{p.porque}</p>
              <p className="flex flex-wrap gap-1.5 pt-0.5">
                {p.economiaMensal > 0 && (
                  <span className="text-[11px] font-semibold text-green-700 bg-green-50 rounded-full px-2 py-0.5 num">
                    economiza {brl(p.economiaMensal)}/mês
                  </span>
                )}
                <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{DIFICULDADE[p.dificuldade] ?? 'Médio'}</span>
                {p.prazo && <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{p.prazo}</span>}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {comRegra.length > 0 && (
        <ComoCalculei>
          <p>A economia de cada dica é calculada pelo app a partir dos seus números — não é chute da IA:</p>
          <ul className="list-disc pl-4 space-y-1">
            {comRegra.map(p => (
              <li key={p.acao} className="num">{p.regra ?? `${p.acao}: ${brl(p.economiaMensal)} por mês.`}</li>
            ))}
          </ul>
          {a.economiaAjustada && <p>Algumas dicas atacam o mesmo gasto; o app reduziu o total para não contar a mesma economia duas vezes.</p>}
        </ComoCalculei>
      )}
    </Caixa>
  )
}

// ─── Conversar com o Fin ─────────────────────────────────────────────────────

export function ConversarComFin() {
  // O chat abre uma conversa nova com esta análise anexada (lib/comportamento/contextoChat).
  return (
    <Link
      href="/chat?analise=1"
      className="w-full py-3.5 rounded-full font-semibold text-sm text-white bg-primary-600 flex items-center justify-center gap-2
                 transition-all duration-150 ease-spring active:scale-[0.98]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400"
    >
      <MessageCircle className="w-4 h-4" />
      Conversar com o Fin sobre isso
    </Link>
  )
}

/** Selo de confiança: os valores citados pelo Fin foram conferidos com os dados. */
export function SeloConferencia({ analise: a }: { analise: AnaliseIA }) {
  if (!a.conferencia || a.conferencia.citados === 0) return null
  const { citados, removidos } = a.conferencia
  return (
    <p className="text-[11px] text-gray-500 text-center leading-snug px-2 flex items-center justify-center gap-1">
      <ShieldCheck className="w-3.5 h-3.5 text-green-600 shrink-0" strokeWidth={2} />
      {removidos.length === 0
        ? `Os ${citados} valores em reais desta análise foram conferidos com os seus dados.`
        : `Conferi os valores com os seus dados e tirei ${removidos.length === 1 ? '1 trecho' : `${removidos.length} trechos`} que não batiam.`}
    </p>
  )
}
