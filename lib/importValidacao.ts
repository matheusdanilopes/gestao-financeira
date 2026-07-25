import { TransacaoNubank } from '@/lib/csvparser'
import { ResultadoConciliacao, ResultadoEstorno } from '@/lib/conciliacao'

// Mapeamento único (compartilhado por /api/nubank/importar, /api/import e /api/import/cartao)
// entre o resultado de conciliarTransacao/conciliarEstorno e a linha persistida em
// import_validacoes — garante que os 3 endpoints de importação capturem exatamente as
// mesmas decisões, sem cada um reimplementar (e divergir) essa lógica.

export type DecisaoValidacao =
  | 'inserida' | 'removida' | 'duplicada' | 'conflito'
  | 'conciliada' | 'conciliacao_desfeita'
  | 'estorno_aplicado' | 'estorno_registrado' | 'estorno_removido' | 'estorno_ignorado'

export interface LinhaValidacaoInsert {
  descricao: string
  valor: number
  data_compra: string
  decisao: DecisaoValidacao
  transacao_id: string | null
  dados_linha: Record<string, unknown>
  estado_anterior: Record<string, unknown> | null
  notificacao_id: string | null
  registro_conflitante: Record<string, unknown> | null
}

// Payload cru da linha (sem occurrence_index, que não é persistido) — guardado para
// permitir reinserir a transação depois, caso o usuário reverta uma decisão manualmente.
export function dadosLinhaDe(item: TransacaoNubank): Record<string, unknown> {
  const { occurrence_index: _oi, ...base } = item as TransacaoNubank & { occurrence_index?: number }
  return base
}

export function linhaDeTransacao(item: TransacaoNubank, resultado: ResultadoConciliacao): LinhaValidacaoInsert | null {
  const base = {
    descricao: item.descricao,
    valor: item.valor,
    data_compra: item.data_compra,
    dados_linha: dadosLinhaDe(item),
  }

  switch (resultado.acao) {
    case 'inserido':
      return resultado.inseriu
        ? { ...base, decisao: 'inserida', transacao_id: resultado.transacaoId ?? null, estado_anterior: null, notificacao_id: null, registro_conflitante: null }
        : { ...base, decisao: 'duplicada', transacao_id: resultado.matchExistenteId ?? null, estado_anterior: null, notificacao_id: null, registro_conflitante: resultado.registroConflitante ? { ...resultado.registroConflitante } : null }
    case 'conciliado':
      return {
        ...base,
        decisao: 'conciliada',
        transacao_id: resultado.transacaoId ?? resultado.matchExistenteId ?? null,
        estado_anterior: resultado.estadoAnterior ? { ...resultado.estadoAnterior } : null,
        notificacao_id: null,
        registro_conflitante: null,
      }
    case 'conflito':
      return {
        ...base,
        decisao: 'conflito',
        transacao_id: resultado.transacaoId ?? null,
        estado_anterior: null,
        notificacao_id: resultado.notificacaoId ?? null,
        registro_conflitante: resultado.registroConflitante ? { ...resultado.registroConflitante } : null,
      }
    case 'ignorado':
      return {
        ...base,
        decisao: 'duplicada',
        transacao_id: resultado.matchExistenteId ?? null,
        estado_anterior: null,
        notificacao_id: null,
        registro_conflitante: resultado.registroConflitante ? { ...resultado.registroConflitante } : null,
      }
    default:
      return null
  }
}

export function linhaDeEstorno(estorno: TransacaoNubank, resultado: ResultadoEstorno): LinhaValidacaoInsert {
  const base = {
    descricao: estorno.descricao,
    valor: estorno.valor,
    data_compra: estorno.data_compra,
    dados_linha: dadosLinhaDe(estorno),
  }

  if (resultado.acao === 'aplicado') {
    return {
      ...base,
      decisao: 'estorno_aplicado',
      transacao_id: resultado.transacaoId ?? null,
      estado_anterior: resultado.originalId
        ? { original_id: resultado.originalId, status_anterior: resultado.statusAnteriorOriginal }
        : null,
      notificacao_id: null,
      registro_conflitante: null,
    }
  }
  if (resultado.acao === 'registrado') {
    return { ...base, decisao: 'estorno_registrado', transacao_id: resultado.transacaoId ?? null, estado_anterior: null, notificacao_id: null, registro_conflitante: null }
  }
  return {
    ...base,
    decisao: 'estorno_ignorado',
    transacao_id: null,
    estado_anterior: null,
    notificacao_id: null,
    registro_conflitante: resultado.registroConflitante ? { ...resultado.registroConflitante } : null,
  }
}
