'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export type StatusRelatorio = 'loading' | 'ready' | 'error'

interface EstadoRelatorio<T> {
  dados: T | null
  status: StatusRelatorio
  /** Identidade do carregamento que produziu estes dados. */
  chave: object | null
}

/**
 * Carrega os dados de um relatório e cuida do ciclo carregando/pronto/erro.
 *
 * Duas escolhas que explicam o formato:
 *
 * - **Nenhum `setState` síncrono dentro do efeito.** Trocar um filtro dispara o
 *   efeito; marcar "carregando" ali dentro provocaria uma cascata de renders
 *   (é o que a regra `react-hooks/set-state-in-effect` aponta). Em vez disso, o
 *   estado só muda quando a promessa resolve, e "está atualizando" é derivado
 *   comparando o carregamento pedido com o último concluído.
 * - **Os dados antigos ficam na tela durante a recarga.** Mudar de "6 meses"
 *   para "12 meses" não devolve o usuário ao esqueleto: a tabela continua lá,
 *   com o ícone de atualizar girando, e é substituída quando a nova carga chega.
 */
export function useRelatorio<T>(carregarDados: () => Promise<T>) {
  const [versao, setVersao] = useState(0)
  const [estado, setEstado] = useState<EstadoRelatorio<T>>({
    dados: null,
    status: 'loading',
    chave: null,
  })

  // Um objeto novo por combinação de (função de carga, versão): serve de
  // identidade do carregamento atual, comparável com o que já concluiu.
  const chave = useMemo(() => ({ carregarDados, versao }), [carregarDados, versao])

  useEffect(() => {
    let ativo = true

    chave.carregarDados()
      .then(dados => {
        if (ativo) setEstado({ dados, status: 'ready', chave })
      })
      .catch(err => {
        console.error('[relatorios] Falha ao carregar dados:', err)
        if (ativo) setEstado(atual => ({ ...atual, status: 'error', chave }))
      })

    return () => { ativo = false }
  }, [chave])

  const recarregar = useCallback(() => setVersao(v => v + 1), [])

  return {
    dados: estado.dados,
    status: estado.status,
    /** Há uma carga em andamento sobre dados já exibidos. */
    atualizando: estado.chave !== chave && estado.status !== 'loading',
    recarregar,
  }
}
