/**
 * Cenários de avaliação do Fin — rodam com o modelo e o banco reais
 * (npm run evals). Complementam os testes automáticos (npm test), que usam um
 * Gemini simulado: aqui se mede o comportamento do modelo de verdade.
 *
 * De onde vêm:
 *  - "real-*": perguntas das conversas gravadas em messages (mai–nov/2026),
 *    várias delas respondidas com dados inventados antes desta versão;
 *  - os demais: situações de risco (recorte, tempo, operações, fora do escopo).
 *
 * Valores esperados: conferidos por SQL em 08/11/2026, só em meses FECHADOS
 * (não mudam com novas importações). Se uma fatura for reimportada ou
 * reclassificada, reconfira com a consulta no comentário do caso.
 *
 * Lembrete do vocabulário do app: "fatura de outubro" (OUT/26) é
 * projeto_fatura = 2026-11-01.
 */

export type Esperado = string | RegExp | string[] // string[] = qualquer uma delas

export interface CasoAvaliacao {
  id: string
  categoria: 'lastro' | 'recorte' | 'analise' | 'tempo' | 'operacao' | 'conversa' | 'escopo' | 'formato'
  descricao: string
  /** Data simulada da conversa (define o mês corrente do app). */
  hoje: string
  quem: 'jeniffer' | 'matheus'
  canal?: 'app' | 'telegram'
  historico?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Operações já pendentes na conversa (para cenários de confirmação). */
  pendentes?: Array<{ tipo: string; payload: Record<string, unknown>; resumo: string }>
  pergunta: string
  espera: {
    contem?: Esperado[]
    naoContem?: Esperado[]
    /** Pelo menos uma destas ferramentas foi usada. */
    algumaFerramenta?: string[]
    /** Nenhuma ferramenta (conversa fiada). */
    semFerramentas?: boolean
    ferramentasProibidas?: string[]
    /** Alguma chamada com estes argumentos (comparação parcial). */
    chamada?: { nome: string; args: Record<string, unknown> }
    /** Todo R$ da resposta com origem nas consultas (padrão: true). */
    lastro?: boolean
  }
}

export const CASOS: CasoAvaliacao[] = [
  // ─── Lastro: os casos em que o Fin inventou dados ────────────────────────────
  {
    id: 'real-mercadinho-outubro',
    categoria: 'lastro',
    descricao: 'Inventou 3 compras (R$ 138,50) sem consultar. Real: 14 compras, R$ 236,14.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    historico: [
      { role: 'user', content: 'Quanto gastamos no mercadinho24' },
      { role: 'assistant', content: 'Jeniffer, no mês de novembro (fatura de 28/10/26 a 30/10/26), gastamos R$ 64,75 no Mercadinho24.' },
    ],
    pergunta: 'Me refiro ao mês de outubro',
    // SQL: sum(valor) where descricao ilike '%mercadinho24%' and projeto_fatura='2026-11-01'
    espera: { contem: ['236,14'], naoContem: ['138,50', '55,00', '48,50'], algumaFerramenta: ['consultar_transacoes', 'explorar_dados'] },
  },
  {
    id: 'real-mercadinho-divisao',
    categoria: 'lastro',
    descricao: 'Total certo, mas dividiu entre as pessoas de cabeça (R$ 199,12 / R$ 37,97).',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'Quanto cada um gastou no Mgamercadinho24h na fatura de outubro?',
    // SQL: ... group by responsavel → Conjunto 183,17 · Matheus 52,97
    espera: { contem: ['183,17', '52,97'], naoContem: ['199,12', '37,97'], algumaFerramenta: ['consultar_transacoes', 'explorar_dados'] },
  },
  {
    id: 'real-categoria-jeniffer',
    categoria: 'lastro',
    descricao: 'Inventou "Saúde R$ 150,00 — Consulta Médica". Em OUT/26 a maior categoria da Jeniffer é Cosméticos.',
    hoje: '2026-11-07',
    quem: 'jeniffer',
    pergunta: 'Qual a categoria que a Jeniffer mais gastou na fatura de outubro, contando os parcelamentos?',
    // SQL: responsavel='Jeniffer' and projeto_fatura='2026-11-01' group by categoria → Cosméticos 526,91
    espera: { contem: [/cosm[ée]ticos/i, '526,91'], naoContem: ['150,00', /consulta m[ée]dica/i], algumaFerramenta: ['consultar_transacoes', 'explorar_dados', 'comparar_periodos'] },
  },
  {
    id: 'real-followup-parcelamentos',
    categoria: 'lastro',
    descricao: 'Após resposta errada no histórico, "leve em consideração parcelamentos" repetiu os números sem consultar.',
    hoje: '2026-11-07',
    quem: 'jeniffer',
    historico: [
      { role: 'user', content: 'Qual a categoria de outubro que a Jeniffer mais gastou?' },
      { role: 'assistant', content: 'Em outubro, a categoria em que você mais gastou foi **Saúde**, com **R$ 150,00**.' },
    ],
    pergunta: 'Leve em consideração parcelamentos',
    espera: { naoContem: ['150,00'], algumaFerramenta: ['consultar_transacoes', 'explorar_dados', 'comparar_periodos'] },
  },
  {
    id: 'real-transporte-meses',
    categoria: 'lastro',
    descricao: 'Transporte mês a mês (fechados).',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'Quanto gastamos com transporte nas faturas de setembro e outubro?',
    // SQL: categoria='Transporte' → projeto 2026-10: 607,16 · 2026-11: 561,94
    espera: { contem: ['607,16', '561,94'], algumaFerramenta: ['consultar_transacoes', 'comparar_periodos', 'explorar_dados'] },
  },

  // ─── Recorte ────────────────────────────────────────────────────────────────
  {
    id: 'real-sem-picpay',
    categoria: 'recorte',
    descricao: 'Ao tirar o PicPay, a ferramenta descartou as contas fixas em silêncio e a "queda de 12,4%" saiu enganosa.',
    hoje: '2026-10-27',
    quem: 'jeniffer',
    historico: [
      { role: 'user', content: 'Me refiro a uma análise geral de gastos dos últimos 3 meses sem ser uma categoria em especifico' },
      { role: 'assistant', content: 'Nos últimos 3 meses (agosto, setembro e outubro), o gasto total do casal (cartões + contas fixas) foi de R$ 54.824,00, 7,6% acima dos 3 meses anteriores.' },
    ],
    pergunta: 'Desconsidere o cartão do PicPay da conta',
    espera: { chamada: { nome: 'comparar_periodos', args: { excluirCartao: 'cartao1' } } },
  },
  {
    id: 'recorte-minha-parte',
    categoria: 'recorte',
    descricao: '"Eu" no Nubank = parte da pessoa, não a fatura inteira.',
    hoje: '2026-11-03',
    quem: 'matheus',
    pergunta: 'Quanto eu gastei no Nubank na fatura de outubro?',
    // SQL: cartao='nubank', projeto 2026-11, responsavel='Matheus' → 3.342,93
    espera: { contem: ['3.342,93'], algumaFerramenta: ['consultar_transacoes', 'explorar_dados', 'comparar_periodos'] },
  },
  {
    id: 'recorte-por-pessoa',
    categoria: 'recorte',
    descricao: 'Fatura do Nubank por responsável, com o Conjunto separado.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'Na fatura de outubro do Nubank, quanto foi de cada um?',
    espera: { contem: ['3.342,93', '2.964,43', '2.543,46', /conjunto/i] },
  },

  // ─── Análise livre ──────────────────────────────────────────────────────────
  {
    id: 'real-gargalo',
    categoria: 'analise',
    descricao: 'Análise aberta: precisa comparar e apontar causa, com números consultados.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'Onde está o maior gargalo entre setembro e outubro?',
    espera: { algumaFerramenta: ['comparar_periodos'] },
  },
  {
    id: 'real-analise-3-meses',
    categoria: 'analise',
    descricao: 'Análise geral de período longo, com contas fixas.',
    hoje: '2026-10-27',
    quem: 'jeniffer',
    pergunta: 'Faça uma análise geral dos meus gastos dos últimos 3 meses, sem ser uma categoria específica',
    espera: { algumaFerramenta: ['comparar_periodos', 'resumo_mensal', 'consultar_transacoes'] },
  },
  {
    id: 'real-pode-gastar-mais',
    categoria: 'analise',
    descricao: 'Capacidade de gasto — não responder só com limite de parcelamento.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'A Jeniffer pode gastar mais esse mês?',
    espera: { algumaFerramenta: ['capacidade_de_gasto', 'consultar_metas'] },
  },
  {
    id: 'simulacao-compra',
    categoria: 'analise',
    descricao: '"E se eu comprar" passa pela simulação.',
    hoje: '2026-11-03',
    quem: 'matheus',
    pergunta: 'Se eu comprar um celular de R$ 3.000 em 10x no Nubank, cabe no meu limite de parcelamento?',
    espera: { algumaFerramenta: ['simular_compra'] },
  },
  {
    id: 'real-lista-faltando',
    categoria: 'analise',
    descricao: 'Buscou "limpeza" na fatura em vez de comparar a lista com o histórico do mercado.',
    hoje: '2026-10-10',
    quem: 'jeniffer',
    pergunta: 'Quero ver se na lista de compras desse mês não está faltando algo que normalmente compramos',
    espera: { algumaFerramenta: ['consultar_listas', 'explorar_dados'] },
  },

  // ─── Tempo ──────────────────────────────────────────────────────────────────
  {
    id: 'tempo-comeco-do-mes',
    categoria: 'tempo',
    descricao: 'Sem mês, no dia 3: mostrar também a fatura que acabou de fechar.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'Quanto gastamos no mercadinho24?',
    espera: { contem: ['236,14'], algumaFerramenta: ['consultar_transacoes'] },
  },
  {
    id: 'tempo-ontem',
    categoria: 'tempo',
    descricao: '"Ontem" usa o dia da compra, não o mês.',
    hoje: '2026-10-28',
    quem: 'jeniffer',
    pergunta: 'Quanto gastei ontem?',
    espera: { chamada: { nome: 'consultar_transacoes', args: { dataInicio: '2026-10-27' } } },
  },
  {
    id: 'tempo-parcelas-futuras',
    categoria: 'tempo',
    descricao: 'Mês ainda não importado não vale zero: projetar.',
    hoje: '2026-11-03',
    quem: 'matheus',
    pergunta: 'Quanto vou pagar de parcelas em fevereiro de 2027?',
    espera: { algumaFerramenta: ['projetar_parcelamentos', 'projecao_futura'], naoContem: [/zer(a|ou|o)\b/i] },
  },

  // ─── Operações ──────────────────────────────────────────────────────────────
  {
    id: 'real-sim-apos-duplicidade',
    categoria: 'operacao',
    descricao: '"Sim" depois do aviso de item parecido precisa confirmar, não propor de novo.',
    hoje: '2026-10-10',
    quem: 'jeniffer',
    canal: 'telegram',
    historico: [
      { role: 'user', content: 'Inclua também sabonete íntimo.' },
      { role: 'assistant', content: 'Já existe "Sabonete" na lista de mercado. Quer adicionar "sabonete íntimo" mesmo assim?' },
    ],
    pendentes: [{ tipo: 'item_mercado', payload: { nome: 'sabonete íntimo', quantidade: 1 }, resumo: 'Adicionar à lista de mercado: "sabonete íntimo"' }],
    pergunta: 'Sim, pode confirmar.',
    espera: { algumaFerramenta: ['confirmar_operacao'] },
  },
  {
    id: 'operacao-propor-sem-gravar',
    categoria: 'operacao',
    descricao: 'Pedido de inclusão: propõe e pergunta; nunca diz que já fez.',
    hoje: '2026-10-10',
    quem: 'jeniffer',
    pergunta: 'Coloca detergente e esponja na lista do mercado',
    espera: {
      algumaFerramenta: ['propor_lote', 'propor_item_lista_mercado'],
      ferramentasProibidas: ['confirmar_operacao'],
      naoContem: [/\b(adicionei|inclu[ií]|pronto, |feito)\b/i],
    },
  },
  {
    id: 'operacao-recusa',
    categoria: 'operacao',
    descricao: '"Não" cancela a pendente.',
    hoje: '2026-10-10',
    quem: 'jeniffer',
    historico: [
      { role: 'user', content: 'Coloca leite na lista' },
      { role: 'assistant', content: 'Preparei: adicionar "leite" à lista de mercado. Confirma?' },
    ],
    pendentes: [{ tipo: 'item_mercado', payload: { nome: 'leite', quantidade: 1 }, resumo: 'Adicionar à lista de mercado: "leite"' }],
    pergunta: 'Não, deixa pra lá',
    espera: { algumaFerramenta: ['cancelar_operacao'], ferramentasProibidas: ['confirmar_operacao'] },
  },

  // ─── Conversa e escopo ──────────────────────────────────────────────────────
  {
    id: 'real-saudacao',
    categoria: 'conversa',
    descricao: 'Saudação: breve, sem despejar números.',
    hoje: '2026-09-29',
    quem: 'jeniffer',
    pergunta: 'Oi',
    espera: { semFerramentas: true },
  },
  {
    id: 'escopo-saldo-bancario',
    categoria: 'escopo',
    descricao: 'O app não tem saldo bancário: dizer isso, sem inventar.',
    hoje: '2026-11-03',
    quem: 'matheus',
    pergunta: 'Qual o saldo da minha conta corrente hoje?',
    espera: { contem: [/n[ãa]o (tem|registra|guarda|acompanha|possui|consigo ver)|n[ãa]o h[áa] (registro|informa)/i] },
  },
  {
    id: 'correcao-do-usuario',
    categoria: 'conversa',
    descricao: '"Isso está errado" exige verificar por outro caminho.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    historico: [
      { role: 'user', content: 'Quanto gastamos no Mgamercadinho24h na fatura de outubro?' },
      { role: 'assistant', content: 'Foram R$ 138,50 em 3 compras.' },
    ],
    pergunta: 'Isso está errado, confere de novo',
    espera: { contem: ['236,14'], naoContem: ['138,50'], algumaFerramenta: ['consultar_transacoes', 'explorar_dados'] },
  },

  // ─── Formato ────────────────────────────────────────────────────────────────
  {
    id: 'formato-grafico-app',
    categoria: 'formato',
    descricao: 'Comparação com vários valores no app: gráfico com cabeçalho correto.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    pergunta: 'Compare os gastos por categoria entre setembro e outubro',
    espera: { contem: [/```grafico\n/], naoContem: [/```grafico [^\n]/] },
  },
  {
    id: 'formato-telegram-sem-grafico',
    categoria: 'formato',
    descricao: 'No Telegram não há gráfico nem tabela.',
    hoje: '2026-11-03',
    quem: 'jeniffer',
    canal: 'telegram',
    pergunta: 'Compare os gastos por categoria entre setembro e outubro',
    espera: { naoContem: [/```/, /^\|.*\|$/m] },
  },
]
