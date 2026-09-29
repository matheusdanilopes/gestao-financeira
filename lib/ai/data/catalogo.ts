/**
 * Catálogo de fontes de dados legíveis pela IA.
 *
 * Fonte única de verdade do que o assessor pode ler, com que nomes de campo e
 * em que formato. A ferramenta genérica `explorar_dados` se apoia só nele, e
 * o prompt/`listar_dimensoes` descrevem ao modelo o que está aqui — adicionar
 * uma fonte nova ao app é declarar mais uma entrada, sem mexer no agente.
 *
 * É também uma LISTA BRANCA: só estas tabelas e estes campos chegam ao
 * modelo. No Telegram a leitura usa a service role (sem RLS), então tabelas
 * como telegram_vinculos, push_subscriptions ou messages nunca entram aqui.
 *
 * Dois tipos de fonte:
 *  - `nucleo`: derivada dos dados já carregados e auditados do turno (compras,
 *    contas, assinaturas…). Os números batem com as ferramentas especializadas.
 *  - `tabela`: lida do banco só quando pedida (histórico de preço das
 *    assinaturas, atividade no app, importações…), com cache curto.
 */

import type { EnrichedData, Planejamento } from '../types'
import {
  getMesEfetivo,
  isPlanejamentoDespesaReal,
  cartaoLabelsFromPlanejamento,
  nomeCartao,
} from '../insightsEngine'
import { horaLocal } from '../tempo'
import { responsavelDoEmail } from '../agent/interlocutor'
import type { ConsultaTabela } from './leitura'

export type TipoCampo = 'texto' | 'moeda' | 'numero' | 'data' | 'mes' | 'datahora' | 'booleano'

export interface Campo {
  nome: string
  tipo: TipoCampo
  descricao: string
}

export type Valor = string | number | boolean | null
export type Linha = Record<string, Valor>

interface FonteBase {
  id: string
  descricao: string
  campos: Campo[]
  /** Campo exibido primeiro em cada linha (o "nome" do registro). */
  campoTitulo: string
  /** Campo de data/datahora usado por dataInicio/dataFim e na ordenação padrão. */
  campoData?: string
  /** Campo de mês ('YYYY-MM') usado por mesInicio/mesFim. Sem ele, o mês sai de campoData. */
  campoMes?: string
  /** Campo somado por padrão nos totais. */
  campoValor?: string
  /** Observação que acompanha todo resultado desta fonte. */
  nota?: string
}

export interface FonteNucleo extends FonteBase {
  origem: 'nucleo'
  /** true = depende do histórico de compras/planejamento (estendido sob demanda). */
  historico?: boolean
  linhas: (d: EnrichedData) => Linha[]
}

export interface FonteTabela extends FonteBase {
  origem: 'tabela'
  consulta: Omit<ConsultaTabela, 'filtros'>
  /** Coluna do BANCO usada para recortar o período na própria consulta. */
  colunaPeriodo: string
  /** Fontes volumosas: período padrão (em meses) quando a pergunta não traz um. */
  janelaPadraoMeses?: number
  transformar: (linhas: Record<string, unknown>[], d: EnrichedData) => Linha[]
}

export type Fonte = FonteNucleo | FonteTabela

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RECEITA_PREFIXO = '[RECEITA] '
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const dia = (v: unknown): string | null => (v ? String(v).substring(0, 10) : null)
const mes = (v: unknown): string | null => (v ? String(v).substring(0, 7) : null)
const somarMeses = (m: string, delta: number) => {
  const [a, n] = m.split('-').map(Number)
  const d = new Date(a, n - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** projeto_fatura → mês do app (a fatura que FECHA nesse mês). */
const mesDoApp = (projetoFatura: string | null | undefined) =>
  projetoFatura ? somarMeses(projetoFatura.substring(0, 7), -1) : null

const pagaPl = (p: Planejamento) => Boolean(p.data_pagamento || p.pago)
const parcelaDe = (atual?: number | null, total?: number | null) =>
  total && total > 1 ? `${atual ?? '?'}/${total}` : null
const pessoa = (email: unknown) => responsavelDoEmail(String(email ?? '')) ?? txt(email)

function nomesAssinaturas(d: EnrichedData): Map<string, string> {
  return new Map(d.assinaturas.filter(a => a.id).map(a => [a.id!, a.nome]))
}

/** Resumo legível de um jsonb de itens de compra de mercado. */
function resumoItens(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const nomes = v
    .map(i => {
      if (!i || typeof i !== 'object') return null
      const o = i as Record<string, unknown>
      const nome = txt(o.nome ?? o.name)
      if (!nome) return null
      const q = num(o.quantidade ?? o.quantity)
      return q && q > 1 ? `${q}× ${nome}` : nome
    })
    .filter(Boolean) as string[]
  if (nomes.length === 0) return null
  return nomes.length > 12 ? `${nomes.slice(0, 12).join(', ')} +${nomes.length - 12}` : nomes.join(', ')
}

// ─── Fontes ──────────────────────────────────────────────────────────────────

export const FONTES: Fonte[] = [
  {
    id: 'compras',
    origem: 'nucleo',
    historico: true,
    descricao: 'Compras no cartão (todas as faturas importadas, sem estornos). Tem data da compra, nome dado pelo usuário, parcela e quando foi importada.',
    campoTitulo: 'nome',
    campoData: 'data',
    campoMes: 'mes',
    campoValor: 'valor',
    nota: 'Mesmo recorte de consultar_transacoes: "mes" é o mês do app (a fatura que fecha nele); "data" é o dia da compra.',
    campos: [
      { nome: 'data', tipo: 'data', descricao: 'dia da compra' },
      { nome: 'nome', tipo: 'texto', descricao: 'nome exibido no app (o personalizado, se houver)' },
      { nome: 'descricao_fatura', tipo: 'texto', descricao: 'descrição original da fatura' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor da compra/parcela' },
      { nome: 'responsavel', tipo: 'texto', descricao: 'quem fez' },
      { nome: 'categoria', tipo: 'texto', descricao: 'categoria' },
      { nome: 'cartao', tipo: 'texto', descricao: 'cartão (nome exibido)' },
      { nome: 'mes', tipo: 'mes', descricao: 'mês do app (fatura que fecha nele)' },
      { nome: 'parcela', tipo: 'texto', descricao: 'parcela atual/total, se parcelada' },
      { nome: 'parcelada', tipo: 'booleano', descricao: 'true se parcelada' },
      { nome: 'status', tipo: 'texto', descricao: 'PENDENTE ou CONCILIADO (conciliada com a fatura)' },
      { nome: 'importada_em', tipo: 'datahora', descricao: 'quando entrou no app' },
    ],
    linhas: d => {
      const labels = cartaoLabelsFromPlanejamento(d.planejamento)
      return d.transacoes.map(t => ({
        data: dia(t.data),
        nome: t.descricao_personalizada?.trim() || t.descricao,
        descricao_fatura: t.descricao,
        valor: Number(t.valor ?? 0),
        responsavel: txt(t.responsavel),
        categoria: txt(t.categoria),
        cartao: nomeCartao(t.cartao, labels),
        mes: mesDoApp(getMesEfetivo(t)),
        parcela: parcelaDe(t.parcela_atual, t.total_parcelas),
        parcelada: Boolean(t.total_parcelas && t.total_parcelas > 1),
        status: txt(t.status),
        importada_em: horaLocal(t.created_at),
      }))
    },
  },
  {
    id: 'contas',
    origem: 'nucleo',
    historico: true,
    descricao: 'Contas fixas / despesas do planejamento mensal (aluguel, luz, boletos, cartões extras lançados como conta).',
    campoTitulo: 'item',
    campoData: 'vencimento',
    campoMes: 'mes',
    campoValor: 'valor',
    nota: '"valor" é o pago de fato quando a conta já foi paga e o previsto enquanto está em aberto (como a tela de Finanças).',
    campos: [
      { nome: 'mes', tipo: 'mes', descricao: 'mês de referência' },
      { nome: 'item', tipo: 'texto', descricao: 'nome da conta' },
      { nome: 'categoria', tipo: 'texto', descricao: 'categoria' },
      { nome: 'responsavel', tipo: 'texto', descricao: 'responsável' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor efetivo (pago ou previsto)' },
      { nome: 'valor_previsto', tipo: 'moeda', descricao: 'valor orçado' },
      { nome: 'valor_pago', tipo: 'moeda', descricao: 'valor pago registrado' },
      { nome: 'paga', tipo: 'booleano', descricao: 'true se já paga' },
      { nome: 'vencimento', tipo: 'data', descricao: 'data de vencimento' },
      { nome: 'data_pagamento', tipo: 'data', descricao: 'quando foi paga' },
      { nome: 'parcela', tipo: 'texto', descricao: 'parcela atual/total' },
      { nome: 'criada_em', tipo: 'datahora', descricao: 'quando foi lançada' },
    ],
    linhas: d => d.planejamento
      .filter(p => !(p.item ?? '').startsWith(RECEITA_PREFIXO) && isPlanejamentoDespesaReal(p.item ?? ''))
      .map(p => ({
        mes: mes(p.mes_referencia),
        item: p.item,
        categoria: txt(p.categoria),
        responsavel: txt(p.responsavel),
        valor: pagaPl(p) ? Number(p.valor_real ?? p.valor_previsto ?? 0) : Number(p.valor_previsto ?? 0),
        valor_previsto: num(p.valor_previsto),
        valor_pago: num(p.valor_real),
        paga: pagaPl(p),
        vencimento: dia(p.data_vencimento),
        data_pagamento: dia(p.data_pagamento),
        parcela: parcelaDe(p.parcela_atual, p.total_parcelas),
        criada_em: horaLocal(p.created_at),
      })),
  },
  {
    id: 'recebimentos',
    origem: 'nucleo',
    historico: true,
    descricao: 'Cada recebimento registrado de uma receita (inclui recebimentos parciais), com data e observação.',
    campoTitulo: 'receita',
    campoData: 'data',
    campoMes: 'mes',
    campoValor: 'valor',
    campos: [
      { nome: 'data', tipo: 'data', descricao: 'dia do recebimento' },
      { nome: 'receita', tipo: 'texto', descricao: 'nome da receita' },
      { nome: 'responsavel', tipo: 'texto', descricao: 'quem recebeu' },
      { nome: 'mes', tipo: 'mes', descricao: 'mês de referência da receita' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor recebido' },
      { nome: 'observacao', tipo: 'texto', descricao: 'observação' },
    ],
    linhas: d => {
      const porId = new Map(d.planejamento.filter(p => p.id).map(p => [p.id!, p]))
      return (d.recebimentos ?? []).map(r => {
        const p = porId.get(r.planejamento_id)
        return {
          data: dia(r.data_recebimento),
          receita: p ? (p.item ?? '').replace(RECEITA_PREFIXO, '') : 'Receita (fora do período carregado)',
          responsavel: txt(p?.responsavel),
          mes: mes(p?.mes_referencia),
          valor: Number(r.valor ?? 0),
          observacao: txt(r.observacao),
        }
      })
    },
  },
  {
    id: 'assinaturas',
    origem: 'nucleo',
    descricao: 'Cadastro de assinaturas (ativas, pausadas e canceladas), com moeda de origem e observação.',
    campoTitulo: 'nome',
    campoData: 'criada_em',
    campoValor: 'valor',
    campos: [
      { nome: 'nome', tipo: 'texto', descricao: 'serviço' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor mensal em R$' },
      { nome: 'situacao', tipo: 'texto', descricao: 'ativa, pausada ou cancelada' },
      { nome: 'categoria', tipo: 'texto', descricao: 'categoria' },
      { nome: 'cartao', tipo: 'texto', descricao: 'cartão cobrado' },
      { nome: 'responsavel', tipo: 'texto', descricao: 'responsável' },
      { nome: 'dia_cobranca', tipo: 'numero', descricao: 'dia do mês da cobrança' },
      { nome: 'pausada_ate', tipo: 'data', descricao: 'volta a cobrar nesta data' },
      { nome: 'moeda', tipo: 'texto', descricao: 'moeda de cobrança (ex.: USD)' },
      { nome: 'valor_origem', tipo: 'numero', descricao: 'valor na moeda de origem' },
      { nome: 'observacao', tipo: 'texto', descricao: 'observação' },
      { nome: 'criada_em', tipo: 'datahora', descricao: 'quando foi cadastrada' },
    ],
    linhas: d => {
      const labels = cartaoLabelsFromPlanejamento(d.planejamento)
      return d.assinaturas.map(a => ({
        nome: a.nome,
        valor: Number(a.valor ?? 0),
        situacao: a.ativa ? 'ativa' : a.pausada_ate ? 'pausada' : 'cancelada',
        categoria: txt(a.categoria),
        cartao: nomeCartao(a.cartao, labels),
        responsavel: txt(a.responsavel),
        dia_cobranca: num(a.dia_cobranca),
        pausada_ate: dia(a.pausada_ate),
        moeda: txt(a.moeda),
        valor_origem: num(a.valor_origem),
        observacao: txt(a.observacao),
        criada_em: horaLocal(a.created_at),
      }))
    },
  },
  {
    id: 'historico_assinaturas',
    origem: 'tabela',
    descricao: 'Histórico de PREÇO das assinaturas: cada valor e a data desde quando vale. Use para "quando a Netflix aumentou", "quanto pagava antes".',
    campoTitulo: 'assinatura',
    campoData: 'vigente_desde',
    campoValor: 'valor',
    colunaPeriodo: 'vigente_desde',
    consulta: {
      tabela: 'assinaturas_historico',
      colunas: ['assinatura_id', 'valor', 'vigente_desde', 'criado_em'],
      ordem: [{ coluna: 'vigente_desde', asc: false }, { coluna: 'id', asc: true }],
    },
    campos: [
      { nome: 'assinatura', tipo: 'texto', descricao: 'serviço' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor mensal a partir da data' },
      { nome: 'vigente_desde', tipo: 'data', descricao: 'data a partir da qual o valor vale' },
      { nome: 'registrado_em', tipo: 'datahora', descricao: 'quando a mudança foi registrada' },
    ],
    transformar: (linhas, d) => {
      const nomes = nomesAssinaturas(d)
      return linhas.map(l => ({
        assinatura: nomes.get(String(l.assinatura_id)) ?? 'Assinatura excluída',
        valor: num(l.valor),
        vigente_desde: dia(l.vigente_desde),
        registrado_em: horaLocal(txt(l.criado_em)),
      }))
    },
  },
  {
    id: 'historico_status_assinaturas',
    origem: 'tabela',
    descricao: 'Quando cada assinatura foi ativada, pausada ou cancelada ("desde quando a Disney está cancelada?").',
    campoTitulo: 'assinatura',
    campoData: 'vigente_desde',
    colunaPeriodo: 'vigente_desde',
    consulta: {
      tabela: 'assinaturas_status_historico',
      colunas: ['assinatura_id', 'ativa', 'vigente_desde', 'criado_em'],
      ordem: [{ coluna: 'vigente_desde', asc: false }, { coluna: 'id', asc: true }],
    },
    campos: [
      { nome: 'assinatura', tipo: 'texto', descricao: 'serviço' },
      { nome: 'ativa', tipo: 'booleano', descricao: 'true = passou a cobrar; false = parou' },
      { nome: 'vigente_desde', tipo: 'data', descricao: 'a partir de quando' },
      { nome: 'registrado_em', tipo: 'datahora', descricao: 'quando foi registrado' },
    ],
    transformar: (linhas, d) => {
      const nomes = nomesAssinaturas(d)
      return linhas.map(l => ({
        assinatura: nomes.get(String(l.assinatura_id)) ?? 'Assinatura excluída',
        ativa: Boolean(l.ativa),
        vigente_desde: dia(l.vigente_desde),
        registrado_em: horaLocal(txt(l.criado_em)),
      }))
    },
  },
  {
    id: 'aportes',
    origem: 'nucleo',
    descricao: 'Cada aporte em investimento, com o saldo informado na hora e a observação.',
    campoTitulo: 'investimento',
    campoData: 'data',
    campoValor: 'valor',
    campos: [
      { nome: 'data', tipo: 'data', descricao: 'dia do aporte' },
      { nome: 'investimento', tipo: 'texto', descricao: 'investimento' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor aportado' },
      { nome: 'saldo_informado', tipo: 'moeda', descricao: 'saldo total que o usuário digitou nesse aporte' },
      { nome: 'observacao', tipo: 'texto', descricao: 'observação' },
    ],
    linhas: d => {
      const nomes = new Map(d.investimentos.map(i => [i.id, i.descricao]))
      return d.aportes.map(a => ({
        data: dia(a.data_aporte),
        investimento: nomes.get(a.investimento_id) ?? 'Investimento',
        valor: Number(a.valor ?? 0),
        saldo_informado: num(a.saldo_atual),
        observacao: txt(a.observacao),
      }))
    },
  },
  {
    id: 'investimentos',
    origem: 'nucleo',
    descricao: 'Carteira: cada investimento, a % da sobra do mês destinada a ele (NÃO é rendimento) e o saldo cadastrado.',
    campoTitulo: 'investimento',
    campoMes: 'mes',
    campoValor: 'saldo_atual',
    campos: [
      { nome: 'investimento', tipo: 'texto', descricao: 'nome' },
      { nome: 'percentual_da_sobra', tipo: 'numero', descricao: '% da sobra destinada' },
      { nome: 'saldo_atual', tipo: 'moeda', descricao: 'saldo cadastrado no investimento' },
      { nome: 'mes', tipo: 'mes', descricao: 'mês de referência do cadastro' },
    ],
    linhas: d => d.investimentos.map(i => ({
      investimento: i.descricao,
      percentual_da_sobra: num(i.percentual),
      saldo_atual: num(i.saldo_atual),
      mes: mes(i.mes_referencia),
    })),
  },
  {
    id: 'estornos',
    origem: 'nucleo',
    historico: true,
    descricao: 'Compras estornadas/canceladas (já fora dos totais de fatura).',
    campoTitulo: 'descricao',
    campoData: 'data',
    campoMes: 'mes',
    campoValor: 'valor',
    campos: [
      { nome: 'data', tipo: 'data', descricao: 'data' },
      { nome: 'descricao', tipo: 'texto', descricao: 'descrição' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor estornado' },
      { nome: 'cartao', tipo: 'texto', descricao: 'cartão' },
      { nome: 'mes', tipo: 'mes', descricao: 'mês do app da fatura' },
      { nome: 'status', tipo: 'texto', descricao: 'ESTORNO (crédito) ou ESTORNADO (compra cancelada)' },
    ],
    linhas: d => {
      const labels = cartaoLabelsFromPlanejamento(d.planejamento)
      return d.estornos.map(e => ({
        data: dia(e.data),
        descricao: e.descricao,
        valor: Math.abs(Number(e.valor ?? 0)),
        cartao: nomeCartao(e.cartao, labels),
        mes: mesDoApp(e.projeto_fatura),
        status: txt(e.status),
      }))
    },
  },
  {
    id: 'fechamentos',
    origem: 'nucleo',
    descricao: 'Data de fechamento registrada de cada fatura, por cartão.',
    campoTitulo: 'cartao',
    campoData: 'data_fechamento',
    campoMes: 'mes',
    campos: [
      { nome: 'cartao', tipo: 'texto', descricao: 'cartão' },
      { nome: 'mes', tipo: 'mes', descricao: 'mês do app da fatura' },
      { nome: 'data_fechamento', tipo: 'data', descricao: 'dia do fechamento' },
    ],
    linhas: d => {
      const labels = cartaoLabelsFromPlanejamento(d.planejamento)
      return (d.faturas ?? []).map(f => ({
        cartao: nomeCartao(f.cartao, labels),
        mes: mesDoApp(f.mes_referencia),
        data_fechamento: dia(f.data_fechamento),
      }))
    },
  },
  {
    id: 'limites_parcelamento',
    origem: 'nucleo',
    descricao: 'Histórico dos limites mensais de parcelamento de cada pessoa (cada valor vale a partir do mês até o próximo).',
    campoTitulo: 'responsavel',
    campoMes: 'desde_mes',
    campoValor: 'valor',
    campos: [
      { nome: 'responsavel', tipo: 'texto', descricao: 'pessoa' },
      { nome: 'desde_mes', tipo: 'mes', descricao: 'vale a partir deste mês' },
      { nome: 'valor', tipo: 'moeda', descricao: 'limite mensal' },
    ],
    linhas: d => (d.limites ?? []).map(l => ({
      responsavel: l.responsavel,
      desde_mes: mes(l.mes_referencia),
      valor: Number(l.valor ?? 0),
    })),
  },
  {
    id: 'desejos',
    origem: 'nucleo',
    descricao: 'Lista de desejos completa (em aberto e já realizados), com nota, link, quem adicionou e quando foi realizado.',
    campoTitulo: 'nome',
    campoData: 'adicionado_em',
    campoValor: 'valor_estimado',
    campos: [
      { nome: 'nome', tipo: 'texto', descricao: 'item' },
      { nome: 'valor_estimado', tipo: 'moeda', descricao: 'valor estimado' },
      { nome: 'prioridade', tipo: 'texto', descricao: 'alta, media ou baixa' },
      { nome: 'categoria', tipo: 'texto', descricao: 'categoria' },
      { nome: 'realizado', tipo: 'booleano', descricao: 'true se já foi comprado' },
      { nome: 'realizado_em', tipo: 'datahora', descricao: 'quando foi marcado como realizado' },
      { nome: 'criado_por', tipo: 'texto', descricao: 'quem adicionou' },
      { nome: 'nota', tipo: 'texto', descricao: 'nota' },
      { nome: 'link', tipo: 'texto', descricao: 'link de referência' },
      { nome: 'adicionado_em', tipo: 'datahora', descricao: 'quando entrou na lista' },
    ],
    linhas: d => (d.desejos ?? []).map(w => ({
      nome: w.nome,
      valor_estimado: num(w.valor_estimado),
      prioridade: txt(w.prioridade),
      categoria: txt(w.categoria),
      realizado: Boolean(w.realizado),
      realizado_em: horaLocal(w.realizado_em),
      criado_por: txt(w.criado_por),
      nota: txt(w.nota),
      link: txt(w.link_ref),
      adicionado_em: horaLocal(w.created_at),
    })),
  },
  {
    id: 'mercado',
    origem: 'nucleo',
    descricao: 'Itens da lista de mercado (a comprar e já comprados), com preço, unidade e quem adicionou.',
    campoTitulo: 'nome',
    campoData: 'adicionado_em',
    campos: [
      { nome: 'nome', tipo: 'texto', descricao: 'item' },
      { nome: 'quantidade', tipo: 'numero', descricao: 'quantidade' },
      { nome: 'unidade', tipo: 'texto', descricao: 'unidade' },
      { nome: 'preco_unit', tipo: 'moeda', descricao: 'preço unitário informado' },
      { nome: 'preco_estimado', tipo: 'moeda', descricao: 'preço estimado' },
      { nome: 'categoria', tipo: 'texto', descricao: 'seção do mercado' },
      { nome: 'comprado', tipo: 'booleano', descricao: 'true se já comprado' },
      { nome: 'criado_por', tipo: 'texto', descricao: 'quem adicionou' },
      { nome: 'adicionado_em', tipo: 'datahora', descricao: 'quando foi adicionado' },
    ],
    linhas: d => (d.mercado ?? []).map(m => ({
      nome: m.nome,
      quantidade: num(m.quantidade),
      unidade: txt(m.unit),
      preco_unit: num(m.preco_unit),
      preco_estimado: num(m.estimated_price),
      categoria: txt(m.category),
      comprado: Boolean(m.comprado),
      criado_por: txt(m.criado_por),
      adicionado_em: horaLocal(m.created_at),
    })),
  },
  {
    id: 'compras_mercado',
    origem: 'tabela',
    descricao: 'Histórico de idas ao mercado finalizadas pela lista de mercado: data, total gasto, quantos e quais itens.',
    campoTitulo: 'itens',
    campoData: 'data',
    campoValor: 'valor_total',
    colunaPeriodo: 'data_hora',
    consulta: {
      tabela: 'historico_compras',
      colunas: ['data_hora', 'valor_total', 'itens_count', 'itens', 'usuario'],
      ordem: [{ coluna: 'data_hora', asc: false }, { coluna: 'id', asc: true }],
    },
    campos: [
      { nome: 'data', tipo: 'datahora', descricao: 'quando a compra foi finalizada' },
      { nome: 'valor_total', tipo: 'moeda', descricao: 'total gasto' },
      { nome: 'quantidade_itens', tipo: 'numero', descricao: 'quantos itens' },
      { nome: 'itens', tipo: 'texto', descricao: 'itens comprados' },
      { nome: 'quem', tipo: 'texto', descricao: 'quem finalizou' },
    ],
    transformar: linhas => linhas.map(l => ({
      data: horaLocal(txt(l.data_hora)),
      valor_total: num(l.valor_total),
      quantidade_itens: num(l.itens_count),
      itens: resumoItens(l.itens),
      quem: pessoa(l.usuario),
    })),
  },
  {
    id: 'itens_listas_compras',
    origem: 'nucleo',
    descricao: 'Itens de TODAS as listas de compras (ativas e arquivadas), com previsto, pago, pessoa e data da compra.',
    campoTitulo: 'nome',
    campoData: 'data_compra',
    campoValor: 'preco_pago',
    campos: [
      { nome: 'lista', tipo: 'texto', descricao: 'nome da lista' },
      { nome: 'situacao_lista', tipo: 'texto', descricao: 'ativa ou arquivada' },
      { nome: 'nome', tipo: 'texto', descricao: 'item' },
      { nome: 'quantidade', tipo: 'numero', descricao: 'quantidade' },
      { nome: 'pessoa', tipo: 'texto', descricao: 'para quem' },
      { nome: 'preco_previsto', tipo: 'moeda', descricao: 'preço previsto' },
      { nome: 'preco_pago', tipo: 'moeda', descricao: 'preço pago' },
      { nome: 'status', tipo: 'texto', descricao: 'situação do item' },
      { nome: 'data_compra', tipo: 'datahora', descricao: 'quando foi comprado' },
    ],
    linhas: d => (d.listasCompras ?? []).map(i => ({
      lista: i.lista,
      situacao_lista: txt(i.status_lista),
      nome: i.nome,
      quantidade: num(i.quantidade),
      pessoa: txt(i.pessoa),
      preco_previsto: num(i.preco_previsto),
      preco_pago: num(i.preco_pago),
      status: txt(i.status),
      data_compra: horaLocal(i.data_compra),
    })),
  },
  {
    id: 'atividade',
    origem: 'tabela',
    descricao: 'Registro de atividade do app: quem lançou, editou, pagou, importou ou excluiu o quê, com valor antes/depois. Use para "quem lançou…", "o que mudou hoje", "quando foi paga", "o que foi excluído".',
    campoTitulo: 'descricao',
    campoData: 'quando',
    campoValor: 'valor',
    colunaPeriodo: 'created_at',
    janelaPadraoMeses: 3,
    consulta: {
      tabela: 'activity_logs',
      colunas: ['created_at', 'usuario', 'acao', 'tabela', 'descricao', 'valor', 'valor_anterior'],
      ordem: [{ coluna: 'created_at', asc: false }, { coluna: 'id', asc: true }],
      maxPaginas: 20,
    },
    campos: [
      { nome: 'quando', tipo: 'datahora', descricao: 'data e hora (Brasília)' },
      { nome: 'quem', tipo: 'texto', descricao: 'pessoa que fez' },
      { nome: 'acao', tipo: 'texto', descricao: 'inserir, editar, excluir, pagar, receber, importar, aporte…' },
      { nome: 'area', tipo: 'texto', descricao: 'compras, contas, receitas, assinaturas, investimentos, mercado' },
      { nome: 'descricao', tipo: 'texto', descricao: 'o que foi feito' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor depois da ação' },
      { nome: 'valor_anterior', tipo: 'moeda', descricao: 'valor antes (edições)' },
    ],
    transformar: linhas => {
      const AREAS: Record<string, string> = {
        transacoes_nubank: 'compras',
        planejamento: 'contas',
        receitas: 'receitas',
        assinaturas: 'assinaturas',
        investimentos: 'investimentos',
        lista_mercado_itens: 'mercado',
      }
      return linhas.map(l => ({
        quando: horaLocal(txt(l.created_at)),
        quem: pessoa(l.usuario),
        acao: txt(l.acao),
        area: AREAS[String(l.tabela)] ?? txt(l.tabela),
        descricao: txt(l.descricao),
        valor: num(l.valor),
        valor_anterior: num(l.valor_anterior),
      }))
    },
  },
  {
    id: 'notificacoes',
    origem: 'tabela',
    descricao: 'Avisos gerados pelo app (pagamentos, divergência de fatura, conflitos de conciliação, itens novos em listas), com quem gerou e se foram resolvidos.',
    campoTitulo: 'descricao',
    campoData: 'quando',
    campoValor: 'valor',
    colunaPeriodo: 'created_at',
    janelaPadraoMeses: 3,
    consulta: {
      tabela: 'notificacoes',
      colunas: ['created_at', 'nome_usuario', 'acao', 'descricao', 'valor', 'lida', 'resolvido_em', 'resolvido_por'],
      ordem: [{ coluna: 'created_at', asc: false }, { coluna: 'id', asc: true }],
      maxPaginas: 10,
    },
    campos: [
      { nome: 'quando', tipo: 'datahora', descricao: 'data e hora' },
      { nome: 'de', tipo: 'texto', descricao: 'quem gerou' },
      { nome: 'tipo', tipo: 'texto', descricao: 'pagar, receber, aporte, fatura_divergencia, conciliacao_conflito, lista_item_adicionado, wishlist_novo_item…' },
      { nome: 'descricao', tipo: 'texto', descricao: 'texto do aviso' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor' },
      { nome: 'lida', tipo: 'booleano', descricao: 'já lida' },
      { nome: 'resolvida_em', tipo: 'datahora', descricao: 'quando foi resolvida' },
      { nome: 'resolvida_por', tipo: 'texto', descricao: 'quem resolveu' },
    ],
    transformar: linhas => linhas.map(l => ({
      quando: horaLocal(txt(l.created_at)),
      de: txt(l.nome_usuario),
      tipo: txt(l.acao),
      descricao: txt(l.descricao),
      valor: num(l.valor),
      lida: Boolean(l.lida),
      resolvida_em: horaLocal(txt(l.resolvido_em)),
      resolvida_por: pessoa(l.resolvido_por),
    })),
  },
  {
    id: 'importacoes',
    origem: 'tabela',
    descricao: 'O que aconteceu com cada linha das faturas importadas: inserida, conciliada, duplicada (ignorada), estorno, conflito. Use para "essa compra foi importada?", "por que tal compra não aparece?".',
    campoTitulo: 'descricao',
    campoData: 'data_compra',
    campoValor: 'valor',
    colunaPeriodo: 'data_compra',
    janelaPadraoMeses: 2,
    consulta: {
      tabela: 'import_validacoes',
      colunas: ['created_at', 'data_compra', 'descricao', 'valor', 'decisao', 'revertido_em'],
      ordem: [{ coluna: 'data_compra', asc: false }, { coluna: 'id', asc: true }],
      maxPaginas: 15,
    },
    nota: 'A mesma compra aparece em várias importações (cada reimportação da fatura gera "duplicada" ou "conciliada"). Para saber se ela está no app, procure uma linha "inserida" ou "conciliada".',
    campos: [
      { nome: 'data_compra', tipo: 'data', descricao: 'dia da compra na fatura' },
      { nome: 'descricao', tipo: 'texto', descricao: 'descrição na fatura' },
      { nome: 'valor', tipo: 'moeda', descricao: 'valor' },
      { nome: 'decisao', tipo: 'texto', descricao: 'inserida, conciliada, duplicada, conflito, estorno_ignorado, estorno_registrado, estorno_aplicado, removida' },
      { nome: 'revertida', tipo: 'booleano', descricao: 'true se a importação foi desfeita' },
      { nome: 'importada_em', tipo: 'datahora', descricao: 'quando a importação rodou' },
    ],
    transformar: linhas => linhas.map(l => ({
      data_compra: dia(l.data_compra),
      descricao: txt(l.descricao),
      valor: num(l.valor),
      decisao: txt(l.decisao),
      revertida: Boolean(l.revertido_em),
      importada_em: horaLocal(txt(l.created_at)),
    })),
  },
]

export const IDS_FONTES = FONTES.map(f => f.id)

export function fontePorId(id: string): Fonte | undefined {
  const alvo = id.trim().toLowerCase()
  return FONTES.find(f => f.id === alvo)
}

/** Uma linha por fonte — vai para listar_dimensoes e para a descrição da ferramenta. */
export function descreverFontes(): string {
  return FONTES.map(f => `  • ${f.id}: ${f.descricao} Campos: ${f.campos.map(c => c.nome).join(', ')}.`).join('\n')
}
