'use client'

import { useCallback, useMemo, useState } from 'react'
import { Sparkles, Database, Check, Copy, Loader2, FileText } from 'lucide-react'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import {
  buscarDadosIA,
  estimarTamanho,
  montarDocumentoDadosIA,
  CONJUNTOS,
  JANELAS_DADOS,
  PROMPTS_SUGERIDOS,
  type ConjuntoDados,
  type JanelaDados,
  type NivelDetalhe,
  type RelatorioDadosIA,
} from '@/lib/relatorioDadosIA'
import { copiarTexto, documentoParaMarkdown } from '@/lib/relatorioDocumento'
import { useRelatorio } from '@/lib/useRelatorio'

const OPCOES_JANELA = JANELAS_DADOS.map(m => ({ valor: m, label: m === 1 ? '1 mês' : `${m} meses` }))

const OPCOES_NIVEL = [
  { valor: 'resumido' as NivelDetalhe, label: 'Resumido' },
  { valor: 'detalhado' as NivelDetalhe, label: 'Detalhado' },
]

const PADRAO: ConjuntoDados[] = ['resumo', 'despesas', 'compras', 'categorias']

/** Acima disso o pacote tende a não caber numa conversa comum. */
const LIMITE_TOKENS_CONFORTAVEL = 60_000

export default function RelatorioDadosIAPage() {
  const [janela, setJanela] = useState<JanelaDados>(6)
  const [nivel, setNivel] = useState<NivelDetalhe>('resumido')
  const [conjuntos, setConjuntos] = useState<ConjuntoDados[]>(PADRAO)
  const [promptCopiado, setPromptCopiado] = useState<string | null>(null)

  // useRelatorio mantém o pacote anterior na tela enquanto a nova seleção
  // carrega — marcar um conjunto de dados não pode apagar os próprios chips.
  const buscar = useCallback(
    () => buscarDadosIA(janela, conjuntos, nivel),
    [janela, conjuntos, nivel],
  )
  const { dados: relatorio, status, atualizando, recarregar } = useRelatorio<RelatorioDadosIA>(buscar)

  const documento = useMemo(
    () => (relatorio ? montarDocumentoDadosIA(relatorio) : null),
    [relatorio],
  )

  const tamanho = useMemo(() => (documento ? estimarTamanho(documento) : null), [documento])
  const previa = useMemo(
    () => (documento ? documentoParaMarkdown(documento).slice(0, 1400) : ''),
    [documento],
  )

  function alternarConjunto(chave: ConjuntoDados) {
    setConjuntos(atual =>
      atual.includes(chave) ? atual.filter(c => c !== chave) : [...atual, chave],
    )
  }

  async function copiarPrompt(titulo: string, texto: string) {
    const ok = await copiarTexto(texto)
    if (ok) {
      setPromptCopiado(titulo)
      setTimeout(() => setPromptCopiado(null), 2500)
    }
  }

  const montarDocumento = useCallback(() => documento, [documento])

  return (
    <RelatorioShell
      titulo="Dados para IA"
      IconeErro={Database}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
      filtros={
        <div className="space-y-2">
          <SeletorOpcoes
            opcoes={OPCOES_JANELA}
            valor={janela}
            onChange={v => setJanela(v as JanelaDados)}
            ariaLabel="Período exportado"
          />
          <SeletorOpcoes
            opcoes={OPCOES_NIVEL}
            valor={nivel}
            onChange={setNivel}
            ariaLabel="Nível de detalhe"
          />
        </div>
      }
    >
      <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary-600" strokeWidth={1.8} />
          </div>
          <h2 className="font-bold text-gray-900 tracking-tight flex-1">O que levar para a IA</h2>
          {atualizando && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
        </div>

        <p className="text-xs text-gray-500 leading-snug">
          Escolha os conjuntos de dados, copie em Markdown e cole na conversa com qualquer IA. O pacote já vai
          com um dicionário explicando as convenções da base — sem ele o modelo interpreta os números do jeito
          que quiser.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CONJUNTOS.map(conjunto => {
            const ativo = conjuntos.includes(conjunto.chave)
            return (
              <button
                key={conjunto.chave}
                type="button"
                onClick={() => alternarConjunto(conjunto.chave)}
                aria-pressed={ativo}
                className={`text-left p-3 rounded-2xl border transition-all duration-150 tap-scale
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300
                            ${ativo
                              ? 'bg-primary-50 border-primary-200'
                              : 'bg-gray-50 border-gray-100 hover:bg-gray-100'}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0
                                ${ativo ? 'bg-primary-600' : 'bg-white border border-gray-300'}`}
                  >
                    {ativo && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className={`text-xs font-semibold ${ativo ? 'text-primary-700' : 'text-gray-700'}`}>
                    {conjunto.label}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug pl-6">{conjunto.descricao}</p>
              </button>
            )
          })}
        </div>

        {conjuntos.length === 0 && (
          <p className="text-xs text-amber-600">
            Selecione ao menos um conjunto — o pacote sairia só com o dicionário de dados.
          </p>
        )}

        {tamanho && (
          <div className="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-1">
            <p className="text-xs font-semibold text-gray-700">
              Tamanho estimado: {tamanho.caracteres.toLocaleString('pt-BR')} caracteres
              {' · '}~{tamanho.tokens.toLocaleString('pt-BR')} tokens
            </p>
            <p className="text-[11px] text-gray-500 leading-snug">
              {tamanho.tokens > LIMITE_TOKENS_CONFORTAVEL
                ? 'Pacote grande: prefira o modo resumido ou uma janela menor, ou anexe o arquivo .md em vez de colar o texto.'
                : 'Cabe numa conversa comum — pode colar direto no chat.'}
            </p>
          </div>
        )}
      </section>

      <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-violet-600" strokeWidth={1.8} />
          </div>
          <h2 className="font-bold text-gray-900 tracking-tight">Perguntas prontas</h2>
        </div>
        <p className="text-xs text-gray-500 leading-snug">
          Copie uma destas perguntas, cole na IA e em seguida cole o pacote de dados.
        </p>
        <ul className="space-y-2">
          {PROMPTS_SUGERIDOS.map(prompt => (
            <li key={prompt.titulo} className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{prompt.titulo}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{prompt.texto}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copiarPrompt(prompt.titulo, prompt.texto)}
                  className="shrink-0 px-2.5 py-1.5 rounded-xl bg-white border border-gray-200
                             text-[11px] font-semibold text-gray-600 hover:bg-gray-100
                             transition-colors flex items-center gap-1
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                  aria-label={`Copiar pergunta: ${prompt.titulo}`}
                >
                  {promptCopiado === prompt.titulo
                    ? <><Check className="w-3 h-3" /> Copiado</>
                    : <><Copy className="w-3 h-3" /> Copiar</>}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {previa && (
        <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
          <h2 className="font-bold text-gray-900 tracking-tight">Prévia do pacote</h2>
          <p className="text-xs text-gray-500 leading-snug">
            Primeiros trechos do Markdown que será copiado — o arquivo completo inclui todas as seções marcadas.
          </p>
          <pre className="text-[10px] leading-relaxed text-gray-600 bg-gray-50 border border-gray-100
                          rounded-2xl p-3 overflow-x-auto max-h-72 whitespace-pre-wrap">
            {previa}
            {'\n…'}
          </pre>
        </section>
      )}
    </RelatorioShell>
  )
}
