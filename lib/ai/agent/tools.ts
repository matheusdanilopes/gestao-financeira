/**
 * Catálogo de ferramentas do agente financeiro.
 *
 * Cada ferramenta é declarada para o Gemini (function calling) e mapeada para
 * uma função do queryEngine (ou do explorador genérico), que opera em memória
 * sobre dados lidos pelo GatewayDados. O gateway estende o histórico e lê as
 * fontes extras sob demanda, conforme o período e a fonte que a chamada pede.
 * O modelo nunca recebe SQL, conexão ou credencial: ele descreve *o que
 * quer*, e a validação de cada argumento acontece aqui.
 *
 * Princípio de projeto: é melhor dar ao modelo poucas ferramentas amplas e bem
 * descritas do que muitas estreitas. A versão anterior deste chat montava o
 * contexto por regex de intenção e só liberava busca em mensagens de follow-up
 * — qualquer pergunta fora dos padrões previstos virava "não tenho esse dado".
 * Aqui o modelo enxerga TODO o espaço de consulta desde a primeira mensagem.
 */

import type { EnrichedData } from '../types'
import type { GatewayDados } from '../data/gateway'
import { descreverFontes, IDS_FONTES } from '../data/catalogo'
import { explorarDados, OPERADORES, AGRUPAMENTOS_TEMPO } from './explorador'
import {
  consultarTransacoes,
  consultarMetas,
  capacidadeDeGasto,
  consultarPlanejamento,
  consultarReceitas,
  consultarAssinaturas,
  consultarInvestimentos,
  consultarEstornos,
  resumoMensal,
  compararPeriodos,
  projecaoFutura,
  projetarParcelamentos,
  simularCompra,
  consultarListas,
  calcular,
  listarDimensoes,
  FiltroInvalido,
  type Referencias,
} from './queryEngine'
import {
  proporPagamento,
  proporNovaDespesa,
  proporNovaReceita,
  proporRecebimento,
  proporAporteInvestimento,
  proporItemMercado,
  proporItemWishlist,
  proporLote,
  avisosDeDuplicidade,
  combinarPropostas,
  estagiarProposta,
  MAX_ITENS_LOTE,
  TIPOS_ITEM_LOTE,
  type ItemLote,
  type Proposta,
  type PropostaOk,
  confirmarOperacao,
  cancelarOperacao,
  type ContextoEscrita,
} from './writeEngine'

// ─── Schema (subconjunto do OpenAPI aceito pelo Gemini) ──────────────────────

type SchemaTipo = 'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY'

interface Schema {
  type: SchemaTipo
  description?: string
  enum?: string[]
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters: Schema
}

const str = (description: string, values?: string[]): Schema =>
  values ? { type: 'STRING', description, enum: values } : { type: 'STRING', description }

const num = (description: string): Schema => ({ type: 'NUMBER', description })
const bool = (description: string): Schema => ({ type: 'BOOLEAN', description })

// Um único vocabulário de mês em todas as ferramentas: o mês do seletor do app
// (a fatura que FECHA nesse mês + contas fixas + receitas do mesmo mês).
const MES = 'Mês no formato YYYY-MM, no vocabulário do app (a fatura que fecha nesse mês).'
const UM_MES = 'Para um mês só, mande mesInicio e mesFim iguais; só mesInicio significa "desse mês em diante".'

// Sem enum de responsável: existem mais valores que as duas pessoas (despesas
// conjuntas têm responsável próprio) e um enum fixo fazia o filtro ser
// descartado em silêncio, devolvendo o total de todo mundo.
const RESPONSAVEL = 'Nome exato do responsável, como aparece em listar_dimensoes (ex.: uma das pessoas, ou o rótulo usado para gastos conjuntos).'
const AGRUPAR = ['mes', 'categoria', 'responsavel', 'cartao', 'descricao']

// ─── Declarações ─────────────────────────────────────────────────────────────

export const FINANCIAL_TOOLS: FunctionDeclaration[] = [
  {
    name: 'listar_dimensoes',
    description:
      'Mostra o que existe no banco: período coberto, categorias realmente usadas, cartões, responsáveis, volumes e as ' +
      'fontes extras de explorar_dados. Use ANTES de concluir que um dado não existe, ou quando estiver em dúvida sobre ' +
      'qual valor exato usar em um filtro.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'consultar_transacoes',
    description:
      'Consulta compras no cartão de crédito (a principal fonte de gastos). Combina busca por texto na descrição do ' +
      'estabelecimento, categoria, responsável, cartão, faixa de valor e intervalo de meses. Retorna totais, ' +
      'agrupamentos (inclusive por cartão) e os maiores lançamentos — nunca a lista completa. ' +
      'Busca também pelo nome que o usuário deu à compra no app. ' +
      'Use para "quanto gastei com X", "compras no iFood", "maior compra do mês", "o que comprei ontem", "parcelamentos na fatura de agosto". ' +
      'Só enxerga faturas já importadas: para meses futuros ou evolução de parcelas, use projetar_parcelamentos. ' +
      'Quando houver mais de um cartão, cite de qual é o número que você usar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Texto procurado na descrição do estabelecimento (ex.: "ifood", "uber", "posto"). Ignora acentos e maiúsculas.'),
        categoria: str('Categoria financeira exata (ex.: Alimentação, Transporte). Use listar_dimensoes se não souber.'),
        responsavel: str(`Quem fez a compra. ${RESPONSAVEL}`),
        cartao: str('Cartão usado.', ['nubank', 'cartao1', 'cartao2']),
        mesInicio: str(`Primeiro mês do intervalo. ${MES} ${UM_MES}`),
        mesFim: str(`Último mês do intervalo. ${MES}`),
        valorMinimo: num('Considera apenas compras com valor maior ou igual a este.'),
        valorMaximo: num('Considera apenas compras com valor menor ou igual a este.'),
        apenasParceladas: bool('true = retorna somente compras parceladas.'),
        agruparPor: str('Dimensão extra de agrupamento no resultado ("descricao" agrupa por loja, juntando variações do nome).', AGRUPAR),
        limite: { type: 'INTEGER', description: 'Quantos lançamentos individuais listar por página (1 a 15).' },
        ordenarPor: str('Ordem da lista de lançamentos: maiores valores (padrão) ou mais recentes.', ['valor', 'data']),
        pagina: { type: 'INTEGER', description: 'Página da lista de lançamentos (1, 2, 3…), quando o resultado disser LISTA PARCIAL.' },
        dataInicio: str('Primeiro DIA da compra, AAAA-MM-DD. Use para "ontem", "esta semana", "no fim de semana", "dia 15" (combine com dataFim). Independe do mês da fatura.'),
        dataFim: str('Último DIA da compra, AAAA-MM-DD. Para um dia só, igual a dataInicio.'),
        tipo: str(
          'Recorte pela Composição da fatura do app: "novas" = compras novas (SEM assinaturas e SEM parcelas de compras ' +
          'anteriores — o mesmo "Novas" da tela); "parcelas_anteriores" = parcelas 2/N em diante; "assinaturas" = ' +
          'cobranças de assinaturas cadastradas; "sem_assinaturas" = tudo menos assinaturas; "sem_parcelas_anteriores" = ' +
          'novas + assinaturas. Use para "ignore as assinaturas", "só compras novas", "tire as parcelas". ' +
          'Padrão: "sem_parcelas_anteriores" com dataInicio/dataFim (gasto feito no dia/semana), "todas" nos demais casos.',
          ['todas', 'novas', 'parcelas_anteriores', 'assinaturas', 'sem_assinaturas', 'sem_parcelas_anteriores']
        ),
      },
    },
  },
  {
    name: 'consultar_planejamento',
    description:
      'Consulta despesas fixas planejadas / contas do orçamento (aluguel, energia, internet, boletos). ' +
      'NÃO são compras de cartão. Permite filtrar por status de pagamento e vencimento. ' +
      'Use para "o que está em aberto", "tem conta vencida", "quanto orçei para o mês", "quanto pago de aluguel".',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Texto procurado no nome do item (ex.: "aluguel", "energia").'),
        categoria: str('Categoria financeira exata.'),
        responsavel: str(`Responsável pelo pagamento. ${RESPONSAVEL}`),
        mesInicio: str(`Primeiro mês do intervalo. ${MES} ${UM_MES}`),
        mesFim: str(`Último mês do intervalo. ${MES}`),
        status: str('Filtro de situação: pago, aberto (não pago), vencido (não pago e já passou do vencimento) ou todos.', ['todos', 'pago', 'aberto', 'vencido']),
        agruparPor: str('Dimensão extra de agrupamento.', AGRUPAR),
        limite: { type: 'INTEGER', description: 'Quantos itens individuais listar (1 a 15).' },
      },
    },
  },
  {
    name: 'consultar_receitas',
    description:
      'Consulta entradas de dinheiro (salário, freelance, bônus, reembolsos). ' +
      'Use para "quanto entrou este mês", "qual minha renda", "já recebi tudo".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês de referência. ${MES}`),
        mesFim: str(`Último mês de referência. ${MES}`),
        responsavel: str(`Quem recebe. ${RESPONSAVEL}`),
        status: str('Situação: recebido (inteiro), parcial (recebido em parte), aberto (falta receber algo, inclui parciais) ou todos.', ['todos', 'recebido', 'parcial', 'aberto']),
      },
    },
  },
  {
    name: 'consultar_assinaturas',
    description:
      'Consulta serviços de cobrança recorrente mensal (Netflix, Spotify, academia digital…). ' +
      'Use para "quanto pago de assinatura", "dá para cancelar alguma", "tem assinatura duplicada".',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Texto procurado no nome do serviço.'),
        status: str('Quais assinaturas incluir. "pausadas" = desativadas temporariamente, voltam a cobrar numa data.', ['ativas', 'pausadas', 'canceladas', 'todas']),
        categoria: str('Categoria da assinatura (ex.: Streaming, Música, Jogos, Tecnologia).'),
        responsavel: str(`Responsável pela assinatura. ${RESPONSAVEL}`),
        cartao: str('Cartão em que é cobrada.', ['nubank', 'cartao1', 'cartao2']),
      },
    },
  },
  {
    name: 'consultar_investimentos',
    description:
      'Consulta a carteira de investimentos: aportes feitos e o último saldo informado pelo usuário em cada investimento. ' +
      'Use para "quanto já investi", "quanto tenho investido", "quando foi o último aporte", "qual ativo recebeu mais".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês dos aportes. ${MES}`),
        mesFim: str(`Último mês dos aportes. ${MES}`),
      },
    },
  },
  {
    name: 'resumo_mensal',
    description:
      'Fecha a conta de um ou mais meses do app: fatura de cartão (por cartão) + contas fixas + receitas + assinaturas, ' +
      'com sobra ou déficit — o mesmo recorte do Dashboard. É a ferramenta certa para "como fechou o mês", ' +
      '"quanto sobrou", "estou no azul".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês do recorte. ${MES} Se omitido, usa o mês corrente.`),
        mesFim: str(`Último mês do recorte. ${MES} Se omitido, usa o mesmo de mesInicio.`),
      },
    },
  },
  {
    name: 'comparar_periodos',
    description:
      'Compara gastos entre dois períodos e mostra o que mais variou, item a item da dimensão escolhida. Aceita filtro por ' +
      'pessoa, categoria, cartão e loja. Por padrão só cartão; incluirContasFixas=true soma as contas fixas (a base do ' +
      '"total do mês"). Com o mês corrente em formação, use mesmoPonto=true para comparar até o mesmo dia do mês anterior. ' +
      'Use para "gastei mais que mês passado?", "o que puxou a alta", "a Jeniffer gastou mais com mercado?".',
    parameters: {
      type: 'OBJECT',
      properties: {
        periodoAInicio: str(`Início do período A (o mais recente). ${MES}`),
        periodoAFim: str(`Fim do período A. ${MES} Se omitido, igual ao início.`),
        periodoBInicio: str(`Início do período B (a base de comparação). ${MES} Se omitido, usa o mês anterior ao A.`),
        periodoBFim: str(`Fim do período B. ${MES} Se omitido, igual ao início.`),
        dimensao: str('Como quebrar a comparação.', ['categoria', 'responsavel', 'cartao', 'descricao', 'total']),
        responsavel: str(`Só compras desta pessoa. ${RESPONSAVEL}`),
        categoria: str('Só esta categoria.'),
        cartao: str('Só este cartão.', ['nubank', 'cartao1', 'cartao2']),
        busca: str('Só compras cuja descrição contém este texto (ex.: "ifood").'),
        incluirContasFixas: bool('true = soma também as contas fixas do planejamento nos dois períodos.'),
        mesmoPonto: bool('true = no período de comparação, só entram compras feitas até o dia equivalente a hoje (comparação justa com o mês em formação).'),
      },
    },
  },
  {
    name: 'projecao_futura',
    description:
      'Projeta os próximos meses: fatura real onde já foi importada; depois, parcelas em aberto + contas fixas (as já ' +
      'cadastradas, ou a média recente) + assinaturas. Traz também um "cenário provável" com o gasto à vista típico, e ' +
      'os limites de parcelamento. Use para "quanto vou pagar nos próximos meses", "como fica dezembro", "sobra dinheiro em janeiro".',
    parameters: {
      type: 'OBJECT',
      properties: {
        meses: { type: 'INTEGER', description: 'Quantos meses projetar à frente (1 a 12). Padrão: 6.' },
      },
    },
  },
  {
    name: 'projetar_parcelamentos',
    description:
      'Evolução das compras parceladas mês a mês — por pessoa, por cartão ou por estabelecimento. Nos meses com fatura ' +
      'já importada usa o valor lançado; depois da última fatura importada, PROJETA avançando cada parcela (3/10 → 4/10…). ' +
      'Mostra o total de cada mês, quanto reduz de um mês para o outro, quais compras pagam a última parcela em cada mês ' +
      'e a lista compra a compra com o mês de término. É a ferramenta certa para "quanto reduz mês a mês", ' +
      '"quando acabam as parcelas do X", "quanto vou pagar de parcela em dezembro", "quanto ainda devo de parcelamento". ' +
      'consultar_transacoes NÃO serve para meses futuros: ele só vê faturas já importadas e devolveria zero.',
    parameters: {
      type: 'OBJECT',
      properties: {
        responsavel: str(`Dono das compras parceladas. ${RESPONSAVEL}`),
        cartao: str('Cartão.', ['nubank', 'cartao1', 'cartao2']),
        busca: str('Texto na descrição da compra, para acompanhar um parcelamento específico.'),
        mesInicio: str(`Primeiro mês da série. ${MES} Padrão: mês corrente.`),
        meses: { type: 'INTEGER', description: 'Quantos meses mostrar a partir de mesInicio (1 a 24). Padrão: 6.' },
        incluirContas: bool('Inclui as contas parceladas do planejamento (padrão: true, como a tela de Parcelamentos). false = só cartões. Ignorado quando há filtro de cartão.'),
      },
    },
  },
  {
    name: 'simular_compra',
    description:
      'Simula uma compra nova ("e se eu comprar X em N vezes?"): soma a parcela aos parcelamentos da pessoa e aos ' +
      'compromissos do casal em cada mês e compara com o limite de parcelamento. Use para "cabe um celular de 3 mil em 10x?", ' +
      '"se eu parcelar a viagem em 6x, como fica?", "estouro o limite se comprar isso?".',
    parameters: {
      type: 'OBJECT',
      properties: {
        valorTotal: num('Valor total da compra.'),
        valorParcela: num('Valor de cada parcela (alternativa ao valorTotal).'),
        parcelas: { type: 'INTEGER', description: 'Número de parcelas (1 = à vista).' },
        responsavel: str(`Quem faria a compra. ${RESPONSAVEL}`),
        cartao: str('Cartão em que seria feita.', ['nubank', 'cartao1', 'cartao2']),
        mesPrimeiraParcela: str(`Mês da 1ª parcela. ${MES} Padrão: mês corrente (compra feita hoje).`),
        descricao: str('Nome da compra, só para o texto.'),
      },
    },
  },
  {
    name: 'consultar_metas',
    description:
      'Metas de gasto do mês e quanto já foi usado de cada uma: limites por categoria (ex.: Alimentação R$ 1.000), ' +
      'metas por pessoa (compras no cartão) e a meta total do casal (cartões + contas fixas). Use para "estou dentro da ' +
      'meta?", "quanto falta para o limite de mercado", "qual categoria estourou", "qual era minha meta". ' +
      'Não confunda com o limite de parcelamento, que vale só para parcelas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: str(`Mês. ${MES} Padrão: mês corrente.`),
      },
    },
  },
  {
    name: 'capacidade_de_gasto',
    description:
      'Quanto ainda dá para gastar num mês: receitas previstas − o que já está comprometido (cartão, parcelas, contas ' +
      'fixas, assinaturas), o cenário provável com o gasto à vista típico, o que resta da meta e o limite de ' +
      'parcelamento. É a ferramenta certa para "quanto posso gastar em novembro", "dá para gastar mais este mês", ' +
      '"quanto sobra se eu mantiver o ritmo".',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: str(`Mês. ${MES} Padrão: mês corrente.`),
        responsavel: str(`Pessoa, para incluir a meta individual dela. ${RESPONSAVEL}`),
      },
    },
  },
  {
    name: 'consultar_listas',
    description:
      'Consulta a lista de desejos (itens que o casal quer comprar, com valor estimado e prioridade), a lista de mercado ' +
      'e as listas de compras. Use para "quanto custa a lista de desejos", "o que falta comprar no mercado", ' +
      '"dá para comprar o item X da lista de desejos este mês".',
    parameters: {
      type: 'OBJECT',
      properties: {
        tipo: str('Qual lista.', ['desejos', 'mercado', 'compras', 'todas']),
        busca: str('Texto no nome do item.'),
      },
    },
  },
  {
    name: 'calcular',
    description:
      'Calculadora exata. Use SEMPRE que precisar somar, subtrair, dividir, tirar média ou percentual de valores que não ' +
      'vieram prontos de uma consulta — nunca faça conta de cabeça. Aceita + - * / ^, parênteses e %.',
    parameters: {
      type: 'OBJECT',
      properties: {
        expressoes: {
          type: 'ARRAY',
          description: 'Expressões no formato "rótulo: expressão", ex.: "redução: 2261.60 - 2180.17", "variação %: (2180.17 - 2261.60) / 2261.60 * 100". Use ponto como separador decimal.',
          items: { type: 'STRING' },
        },
      },
      required: ['expressoes'],
    },
  },
  {
    name: 'consultar_estornos',
    description:
      'Lista compras estornadas/canceladas. Elas já saíram do total da fatura — use apenas para explicar por que uma ' +
      'compra sumiu ou por que a fatura ficou menor que o esperado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mesInicio: str(`Primeiro mês de fatura. ${MES}`),
        mesFim: str(`Último mês de fatura. ${MES}`),
      },
    },
  },

  {
    name: 'explorar_dados',
    description:
      'Consulta genérica sobre QUALQUER fonte de dados do app, com filtros por campo, período, agrupamento, soma e ' +
      'paginação. Use quando nenhuma ferramenta especializada cobre a pergunta ou quando precisar de um campo que ' +
      'elas não mostram — antes de dizer que não tem o dado. Para totais do mês, fatura, comparação e projeção, ' +
      'prefira as especializadas. Fontes:\n' + descreverFontes(),
    parameters: {
      type: 'OBJECT',
      properties: {
        fonte: str('Fonte de dados.', IDS_FONTES),
        busca: str('Texto procurado em todos os campos de texto da fonte (ignora acentos e maiúsculas).'),
        filtros: {
          type: 'ARRAY',
          description: 'Filtros por campo, todos combinados (E). Datas no formato AAAA-MM-DD; em campos de data, "igual" casa o dia inteiro.',
          items: {
            type: 'OBJECT',
            properties: {
              campo: str('Nome do campo, exatamente como listado na fonte.'),
              operador: str('Comparação.', [...OPERADORES]),
              valor: str('Valor comparado (número com ponto decimal, true/false, data AAAA-MM-DD ou texto). Omita em vazio/preenchido.'),
            },
            required: ['campo', 'operador'],
          },
        },
        dataInicio: str('Primeiro dia (AAAA-MM-DD) no campo de data principal da fonte.'),
        dataFim: str('Último dia (AAAA-MM-DD) no campo de data principal da fonte.'),
        mesInicio: str(`Primeiro mês. ${MES}`),
        mesFim: str(`Último mês. ${MES}`),
        agruparPor: str(`Campo da fonte para agrupar, ou um destes: ${AGRUPAMENTOS_TEMPO.join(', ')}.`),
        somar: str('Campo numérico a somar nos totais/grupos (padrão: o campo de valor da fonte).'),
        ordenarPor: str('Campo para ordenar a lista (padrão: data mais recente primeiro, ou valor).'),
        ordem: str('Direção da ordenação.', ['desc', 'asc']),
        campos: { type: 'ARRAY', description: 'Campos a mostrar em cada linha (padrão: todos).', items: { type: 'STRING' } },
        limite: { type: 'INTEGER', description: 'Linhas por página (1 a 30). Padrão: 10.' },
        pagina: { type: 'INTEGER', description: 'Página, quando o resultado disser LISTA PARCIAL.' },
      },
      required: ['fonte'],
    },
  },

  // ── Escrita: só PREPARAM a operação (nunca gravam). Toda propor_* devolve
  // um resumo que precisa ser mostrado ao usuário antes de confirmar_operacao. ──
  {
    name: 'propor_pagamento',
    description:
      'Prepara o pagamento de uma despesa JÁ EXISTENTE e em aberto no planejamento (ex.: "paga a luz", "quitei o ' +
      'aluguel", "marca o cartão como pago"). NÃO grava nada ainda: valida se existe exatamente uma despesa em ' +
      'aberto com esse nome e devolve um resumo para você mostrar ao usuário e pedir confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Nome (ou parte do nome) da despesa a pagar, como aparece no planejamento.'),
        valorPago: num('Valor efetivamente pago.'),
        dataPagamento: str('Data do pagamento, AAAA-MM-DD. Padrão: hoje.'),
        mes: str(`Mês da despesa, use para desambiguar quando houver mais de uma parecida. ${MES}`),
        responsavel: str(`Responsável pela despesa, para desambiguar. ${RESPONSAVEL}`),
      },
      required: ['busca', 'valorPago'],
    },
  },
  {
    name: 'propor_nova_despesa',
    description:
      'Prepara uma NOVA conta/despesa no planejamento do mês (ex.: "lança uma conta de internet de 120 reais", ' +
      '"adiciona uma despesa de mercado de 80 reais"). NÃO grava nada ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        descricao: str('Nome da despesa (ex.: "Internet", "Mercado").'),
        valor: num('Valor previsto da despesa.'),
        categoria: str('Categoria (ex.: Fixa, Extra, Moradia, Alimentação, Transporte, Saúde, Lazer, Outros). Padrão: Extra.'),
        responsavel: str(`Quem é o responsável. ${RESPONSAVEL} Padrão: quem está falando (veja QUEM ESTÁ FALANDO).`),
        dataVencimento: str('Data de vencimento, AAAA-MM-DD. Sem padrão: se o usuário não disser, fica sem vencimento.'),
        mes: str(`Mês de referência da despesa. ${MES} Padrão: mês corrente.`),
      },
      required: ['descricao', 'valor'],
    },
  },
  {
    name: 'propor_recebimento',
    description:
      'Prepara o registro de um recebimento (total ou parcial) de uma receita JÁ EXISTENTE no planejamento (ex.: ' +
      '"recebi o salário", "caiu 500 reais do freelance"). NÃO grava nada ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Nome (ou parte do nome) da receita, como aparece em consultar_receitas.'),
        valor: num('Valor recebido agora (pode ser parcial).'),
        dataRecebimento: str('Data do recebimento, AAAA-MM-DD. Padrão: hoje.'),
        mes: str(`Mês da receita, para desambiguar. ${MES}`),
        responsavel: str(`Quem recebeu, para desambiguar. ${RESPONSAVEL}`),
      },
      required: ['busca', 'valor'],
    },
  },
  {
    name: 'propor_nova_receita',
    description:
      'Prepara uma NOVA receita planejada para um mês (ex.: "cadastra uma receita de freelance de 800 reais em ' +
      'dezembro"). NÃO grava nada ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        descricao: str('Nome da receita (ex.: "Freelance", "13º salário").'),
        valor: num('Valor previsto da receita.'),
        responsavel: str(`Quem recebe. ${RESPONSAVEL} Padrão: quem está falando (veja QUEM ESTÁ FALANDO).`),
        mes: str(`Mês de referência. ${MES} Padrão: mês corrente.`),
      },
      required: ['descricao', 'valor'],
    },
  },
  {
    name: 'propor_aporte_investimento',
    description:
      'Prepara um aporte num investimento JÁ CADASTRADO (ex.: "investi 300 reais na reserva de emergência"). Não ' +
      'cria investimento novo — se não existir nenhum parecido, diga que é preciso cadastrá-lo primeiro pelo app. ' +
      'NÃO grava nada ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        busca: str('Nome do investimento, como aparece em consultar_investimentos.'),
        valor: num('Valor do aporte.'),
        dataAporte: str('Data do aporte, AAAA-MM-DD. Padrão: hoje.'),
        saldoAtual: num('Novo saldo total do investimento, se o usuário informar (opcional).'),
        observacao: str('Observação livre sobre o aporte (opcional).'),
      },
      required: ['busca', 'valor'],
    },
  },
  {
    name: 'propor_item_lista_mercado',
    description:
      'Prepara a adição de um item à lista de mercado (ex.: "coloca leite na lista de mercado"). NÃO grava nada ' +
      'ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: str('Nome do item.'),
        quantidade: num('Quantidade. Padrão: 1.'),
      },
      required: ['nome'],
    },
  },
  {
    name: 'propor_item_wishlist',
    description:
      'Prepara a adição de um item à lista de desejos (ex.: "coloca um fone de ouvido de 400 reais na wishlist"). ' +
      'NÃO grava nada ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: str('Nome do item.'),
        valorEstimado: num('Valor estimado (opcional).'),
        categoria: str('Categoria (ex.: Eletrônicos, Casa, Moda, Viagem, Lazer, Esporte, Saúde, Educação, Outros).'),
        prioridade: str('Prioridade.', ['alta', 'media', 'baixa']),
      },
      required: ['nome'],
    },
  },
  {
    name: 'propor_lote',
    description:
      'Prepara VÁRIAS operações de uma vez, numa única proposta para o usuário confirmar com um "sim" só. Use sempre ' +
      'que o pedido tiver mais de um item: uma lista de compras ("coloca arroz, feijão, 2 leites e café na lista"), ' +
      'várias contas pagas ("paguei luz 150, água 80 e internet 100"), vários recebimentos, despesas e receitas ' +
      'misturadas. Cada item tem um tipo e os mesmos campos da ferramenta propor_* equivalente. Tudo ou nada: se um ' +
      `item tiver problema, nada é preparado e a resposta diz qual. Máximo de ${MAX_ITENS_LOTE} itens. ` +
      'NÃO grava nada ainda — devolve um resumo para confirmação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        itens: {
          type: 'ARRAY',
          description: 'As operações, na ordem em que o usuário falou.',
          items: {
            type: 'OBJECT',
            properties: {
              tipo: str(
                'pagamento = pagar despesa já existente; nova_despesa; recebimento = receber receita já existente; ' +
                'nova_receita; aporte_investimento = investimento já cadastrado; item_mercado = lista de mercado; ' +
                'item_wishlist = lista de desejos.',
                [...TIPOS_ITEM_LOTE]
              ),
              nome: str(
                'Em pagamento/recebimento/aporte_investimento: nome (ou parte) do registro existente. Nos demais: ' +
                'descrição do item novo.'
              ),
              valor: num(
                'Valor pago (pagamento), recebido (recebimento), previsto (nova_despesa/nova_receita), do aporte, ou ' +
                'estimado (item_wishlist). Não se aplica a item_mercado.'
              ),
              quantidade: num('Só item_mercado. Padrão: 1.'),
              categoria: str('nova_despesa (padrão: Extra) ou item_wishlist.'),
              responsavel: str(
                `nova_despesa/nova_receita: de quem é (padrão: quem está falando). pagamento/recebimento: só para ` +
                `desambiguar. ${RESPONSAVEL}`
              ),
              data: str(
                'AAAA-MM-DD. Data do pagamento, do recebimento ou do aporte (padrão: hoje); vencimento em nova_despesa ' +
                '(padrão: sem vencimento).'
              ),
              mes: str(`Mês de referência (nova_despesa/nova_receita) ou para desambiguar (pagamento/recebimento). ${MES}`),
              prioridade: str('Só item_wishlist.', ['alta', 'media', 'baixa']),
              saldoAtual: num('Só aporte_investimento: novo saldo total, se o usuário informar.'),
              observacao: str('Só aporte_investimento: observação livre.'),
            },
            required: ['tipo', 'nome'],
          },
        },
      },
      required: ['itens'],
    },
  },
  {
    name: 'confirmar_operacao',
    description:
      'Executa de fato a operação pendente mais recente desta conversa (a última que você preparou com um ' +
      'propor_*). Só chame isto DEPOIS que o usuário confirmar explicitamente numa mensagem dele (ex.: "sim", ' +
      '"confirma", "pode lançar", "isso mesmo") — nunca na mesma resposta em que você acabou de propor algo, e ' +
      'nunca porque "parece que é isso que o usuário quer".',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'cancelar_operacao',
    description:
      'Descarta a operação pendente mais recente desta conversa, sem gravar nada. Use quando o usuário recusar, ' +
      'pedir para mudar algo proposto, ou desistir.',
    parameters: { type: 'OBJECT', properties: {} },
  },
]

export const NOMES_FERRAMENTAS = new Set(FINANCIAL_TOOLS.map(t => t.name))

// ─── Rótulos amigáveis (exibidos ao usuário durante a execução) ──────────────

const ROTULOS: Record<string, string> = {
  listar_dimensoes: 'Mapeando os dados disponíveis',
  consultar_transacoes: 'Consultando compras no cartão',
  consultar_planejamento: 'Consultando contas e orçamento',
  consultar_receitas: 'Consultando receitas',
  consultar_assinaturas: 'Consultando assinaturas',
  consultar_investimentos: 'Consultando investimentos',
  resumo_mensal: 'Fechando a conta do mês',
  comparar_periodos: 'Comparando períodos',
  projecao_futura: 'Projetando os próximos meses',
  projetar_parcelamentos: 'Projetando parcelamentos',
  simular_compra: 'Simulando a compra',
  consultar_listas: 'Consultando as listas',
  consultar_metas: 'Conferindo as metas de gasto',
  capacidade_de_gasto: 'Calculando quanto ainda cabe no mês',
  calcular: 'Calculando',
  consultar_estornos: 'Verificando estornos',
  explorar_dados: 'Explorando os dados',
  propor_pagamento: 'Preparando pagamento',
  propor_nova_despesa: 'Preparando nova despesa',
  propor_recebimento: 'Preparando recebimento',
  propor_nova_receita: 'Preparando nova receita',
  propor_aporte_investimento: 'Preparando aporte',
  propor_item_lista_mercado: 'Preparando item da lista de mercado',
  propor_item_wishlist: 'Preparando item da wishlist',
  propor_lote: 'Preparando lançamentos em lote',
  confirmar_operacao: 'Gravando operação',
  cancelar_operacao: 'Cancelando operação',
}

export function rotuloFerramenta(nome: string, args: Record<string, unknown> = {}): string {
  const base = ROTULOS[nome] ?? 'Consultando dados financeiros'
  const detalhes: string[] = []
  if (typeof args.busca === 'string' && args.busca.trim()) detalhes.push(`"${args.busca.trim().slice(0, 24)}"`)
  if (typeof args.categoria === 'string' && args.categoria.trim()) detalhes.push(args.categoria.trim().slice(0, 24))
  if (typeof args.responsavel === 'string' && args.responsavel.trim()) detalhes.push(args.responsavel.trim().slice(0, 16))
  if (typeof args.cartao === 'string' && args.cartao.trim()) detalhes.push(args.cartao.trim().slice(0, 16))
  if (nome === 'explorar_dados' && typeof args.fonte === 'string') detalhes.unshift(args.fonte.replace(/_/g, ' '))
  if (nome === 'propor_lote' && Array.isArray(args.itens)) {
    detalhes.push(`${args.itens.length} ${args.itens.length === 1 ? 'item' : 'itens'}`)
  }
  return detalhes.length > 0 ? `${base} · ${detalhes.join(' · ')}` : base
}

// ─── Execução ────────────────────────────────────────────────────────────────

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/** Estado de escrita de UM turno (uma chamada a executarAgente) — nunca persiste entre turnos. */
export interface EstadoTurno {
  /** true assim que qualquer propor_* for chamado nesta rodada de function-calling. */
  propostaNesteTurno: boolean
  /**
   * Propostas válidas já estagiadas nesta resposta. Vários propor_* na mesma
   * resposta se somam num lote, em vez de cada um cancelar o anterior (o
   * usuário veria todos no texto, mas o "sim" confirmaria só o último).
   */
  propostas: PropostaOk[]
}

/** Estagia a proposta somada às anteriores desta mesma resposta. */
async function estagiar(
  escrita: { ctx: ContextoEscrita; estado: EstadoTurno }, data: EnrichedData, proposta: Proposta
): Promise<string> {
  escrita.estado.propostaNesteTurno = true
  if (!proposta.ok) return await estagiarProposta(escrita.ctx, proposta)
  const acumuladas = [...escrita.estado.propostas, proposta]
  const combinada = combinarPropostas(acumuladas)
  const resultado = await estagiarProposta(escrita.ctx, combinada, avisosDeDuplicidade(data, combinada))
  if (resultado.startsWith('PROPOSTA PENDENTE')) escrita.estado.propostas = acumuladas
  return resultado
}

/** Converte os itens de propor_lote, descartando o que não é objeto. */
function itensLote(v: unknown): ItemLote[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    .map(i => ({
      tipo: asString(i.tipo)?.trim(),
      nome: asString(i.nome),
      valor: asNumber(i.valor),
      quantidade: asNumber(i.quantidade),
      categoria: asString(i.categoria),
      responsavel: asString(i.responsavel),
      data: asString(i.data),
      mes: asString(i.mes),
      prioridade: asString(i.prioridade),
      saldoAtual: asNumber(i.saldoAtual),
      observacao: asString(i.observacao),
    }))
}

/** Ferramentas que, sem período, olham para todo o histórico de compras/planejamento. */
const LEEM_HISTORICO_INTEIRO = new Set([
  'listar_dimensoes',
  'consultar_transacoes',
  'consultar_planejamento',
  'consultar_receitas',
  'consultar_estornos',
])

/** Mês mais antigo ('YYYY-MM') pedido nos argumentos, se houver. */
function mesMaisAntigo(args: Record<string, unknown>): string | undefined {
  const meses = ['mesInicio', 'mesFim', 'periodoAInicio', 'periodoBInicio', 'dataInicio', 'dataFim', 'mes']
    .map(k => args[k])
    .filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}/.test(v.trim()))
    .map(v => v.trim().substring(0, 7))
    .sort()
  return meses[0]
}

/**
 * Antes de consultar: garante em memória o histórico que a chamada precisa.
 * Um período anterior à janela quente é buscado agora; uma consulta sem
 * período, nas ferramentas que olham o histórico inteiro, traz tudo.
 */
async function prepararHistorico(gw: GatewayDados, nome: string, args: Record<string, unknown>): Promise<void> {
  if (nome === 'explorar_dados') return // o explorador decide pela fonte
  const inicio = mesMaisAntigo(args)
  if (inicio) {
    // Um mês antes: a fatura de um mês pode ter compras feitas no anterior.
    const [a, m] = inicio.split('-').map(Number)
    const d = new Date(a, m - 2, 1)
    await gw.garantirDesde(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  } else if (LEEM_HISTORICO_INTEIRO.has(nome)) {
    await gw.garantirTudo()
  }
}

/**
 * Despacha uma chamada de ferramenta. Devolve sempre uma string legível —
 * inclusive para nome desconhecido (alucinação) ou erro interno, para que o
 * loop do agente possa continuar em vez de abortar o turno.
 */
export async function executarFerramenta(
  nome: string,
  args: Record<string, unknown>,
  gw: GatewayDados,
  refs: Referencias,
  escrita: { ctx: ContextoEscrita; estado: EstadoTurno }
): Promise<string> {
  try {
    await prepararHistorico(gw, nome, args)
    const data = await gw.dados()

    switch (nome) {
      case 'listar_dimensoes': {
        const cobertura = gw.cobertura
        return [
          listarDimensoes(data, refs),
          cobertura.primeiroNoBanco
            ? `Histórico no banco desde ${cobertura.primeiroNoBanco} — todo ele é consultável (meses antigos são buscados na hora).`
            : '',
          'Fontes extras (explorar_dados), com os campos de cada uma:',
          descreverFontes(),
        ].filter(Boolean).join('\n')
      }

      case 'explorar_dados':
        return await explorarDados(gw, {
          fonte: asString(args.fonte),
          busca: asString(args.busca),
          filtros: args.filtros,
          dataInicio: asString(args.dataInicio),
          dataFim: asString(args.dataFim),
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          agruparPor: asString(args.agruparPor),
          somar: asString(args.somar),
          ordenarPor: asString(args.ordenarPor),
          ordem: asString(args.ordem),
          campos: args.campos,
          limite: asNumber(args.limite),
          pagina: asNumber(args.pagina),
        }, refs)

      case 'consultar_transacoes':
        return consultarTransacoes(data, {
          busca: asString(args.busca),
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          dataInicio: asString(args.dataInicio),
          dataFim: asString(args.dataFim),
          valorMinimo: asNumber(args.valorMinimo),
          valorMaximo: asNumber(args.valorMaximo),
          apenasParceladas: asBool(args.apenasParceladas),
          tipo: asString(args.tipo) as never,
          agruparPor: asString(args.agruparPor) as never,
          limite: asNumber(args.limite),
          ordenarPor: asString(args.ordenarPor) as never,
          pagina: asNumber(args.pagina),
        }, refs)

      case 'consultar_planejamento':
        return consultarPlanejamento(data, {
          busca: asString(args.busca),
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          status: asString(args.status) as never,
          agruparPor: asString(args.agruparPor) as never,
          limite: asNumber(args.limite),
        }, refs)

      case 'consultar_receitas':
        return consultarReceitas(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
          responsavel: asString(args.responsavel),
          status: asString(args.status) as never,
        }, refs)

      case 'consultar_assinaturas':
        return consultarAssinaturas(data, {
          busca: asString(args.busca),
          status: asString(args.status) as never,
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
        })

      case 'consultar_investimentos':
        return consultarInvestimentos(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        }, refs)

      case 'resumo_mensal':
        return resumoMensal(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        }, refs)

      case 'comparar_periodos':
        return compararPeriodos(data, {
          periodoAInicio: asString(args.periodoAInicio),
          periodoAFim: asString(args.periodoAFim),
          periodoBInicio: asString(args.periodoBInicio),
          periodoBFim: asString(args.periodoBFim),
          dimensao: asString(args.dimensao) as never,
          responsavel: asString(args.responsavel),
          categoria: asString(args.categoria),
          cartao: asString(args.cartao),
          busca: asString(args.busca),
          incluirContasFixas: asBool(args.incluirContasFixas),
          mesmoPonto: asBool(args.mesmoPonto),
        }, refs)

      case 'projecao_futura':
        return projecaoFutura(data, { meses: asNumber(args.meses) }, refs)

      case 'projetar_parcelamentos':
        return projetarParcelamentos(data, {
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
          busca: asString(args.busca),
          mesInicio: asString(args.mesInicio),
          meses: asNumber(args.meses),
          incluirContas: asBool(args.incluirContas),
        }, refs)

      case 'simular_compra':
        return simularCompra(data, {
          valorTotal: asNumber(args.valorTotal),
          valorParcela: asNumber(args.valorParcela),
          parcelas: asNumber(args.parcelas),
          responsavel: asString(args.responsavel),
          cartao: asString(args.cartao),
          mesPrimeiraParcela: asString(args.mesPrimeiraParcela),
          descricao: asString(args.descricao),
        }, refs)

      case 'consultar_metas':
        return consultarMetas(data, { mes: asString(args.mes) }, refs)

      case 'capacidade_de_gasto':
        return capacidadeDeGasto(data, { mes: asString(args.mes), responsavel: asString(args.responsavel) }, refs)

      case 'consultar_listas':
        return consultarListas(data, { tipo: asString(args.tipo), busca: asString(args.busca) })

      case 'calcular':
        return calcular({ expressoes: args.expressoes })

      case 'consultar_estornos':
        return consultarEstornos(data, {
          mesInicio: asString(args.mesInicio),
          mesFim: asString(args.mesFim),
        })

      case 'propor_pagamento': {
        const proposta = proporPagamento(data, refs, {
          busca: asString(args.busca),
          valorPago: asNumber(args.valorPago),
          dataPagamento: asString(args.dataPagamento),
          mes: asString(args.mes),
          responsavel: asString(args.responsavel),
        })
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_nova_despesa': {
        const proposta = proporNovaDespesa(refs, {
          descricao: asString(args.descricao),
          valor: asNumber(args.valor),
          categoria: asString(args.categoria),
          responsavel: asString(args.responsavel),
          dataVencimento: asString(args.dataVencimento),
          mes: asString(args.mes),
        }, escrita.ctx.responsavelPadrao ?? undefined)
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_recebimento': {
        const proposta = proporRecebimento(data, refs, {
          busca: asString(args.busca),
          valor: asNumber(args.valor),
          dataRecebimento: asString(args.dataRecebimento),
          mes: asString(args.mes),
          responsavel: asString(args.responsavel),
        })
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_nova_receita': {
        const proposta = proporNovaReceita(refs, {
          descricao: asString(args.descricao),
          valor: asNumber(args.valor),
          responsavel: asString(args.responsavel),
          mes: asString(args.mes),
        }, escrita.ctx.responsavelPadrao ?? undefined)
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_aporte_investimento': {
        const proposta = proporAporteInvestimento(data, refs, {
          busca: asString(args.busca),
          valor: asNumber(args.valor),
          dataAporte: asString(args.dataAporte),
          saldoAtual: asNumber(args.saldoAtual),
          observacao: asString(args.observacao),
        })
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_item_lista_mercado': {
        const proposta = proporItemMercado({
          nome: asString(args.nome),
          quantidade: asNumber(args.quantidade),
        })
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_item_wishlist': {
        const proposta = proporItemWishlist({
          nome: asString(args.nome),
          valorEstimado: asNumber(args.valorEstimado),
          categoria: asString(args.categoria),
          prioridade: asString(args.prioridade),
        })
        return await estagiar(escrita, data, proposta)
      }

      case 'propor_lote': {
        const proposta = proporLote(data, refs, itensLote(args.itens), escrita.ctx.responsavelPadrao ?? undefined)
        return await estagiar(escrita, data, proposta)
      }

      case 'confirmar_operacao': {
        const resultado = await confirmarOperacao(escrita.ctx, escrita.estado.propostaNesteTurno)
        // Gravou: a próxima consulta (até nesta mesma resposta) precisa ver o dado novo.
        if (resultado.startsWith('CONFIRMADO E GRAVADO')) gw.invalidar()
        return resultado
      }

      case 'cancelar_operacao':
        return await cancelarOperacao(escrita.ctx)

      default:
        return `Ferramenta "${nome}" não existe. Ferramentas disponíveis: ${[...NOMES_FERRAMENTAS].join(', ')}. Escolha uma delas.`
    }
  } catch (err) {
    // Filtro que não casa com nada: a mensagem já diz os valores válidos, e o
    // modelo deve refazer a chamada — não responder com um total sem filtro.
    if (err instanceof FiltroInvalido) return `FILTRO INVÁLIDO em "${nome}": ${err.message}`
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return `Falha ao executar "${nome}": ${msg}. Tente outra ferramenta ou outros filtros.`
  }
}
