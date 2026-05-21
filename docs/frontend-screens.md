# Documentação das Telas — Gestão Financeira Familiar

> Contexto para outra IA: este é um PWA de gestão financeira para um casal (Matheus e Jeniffer). O app roda em Next.js 16 com App Router, usa Supabase como backend, Tailwind CSS para estilos e Google Gemini para features de IA. É mobile-first e funciona offline.

---

## 1. Arquitetura Global

### Providers (envolvem toda a aplicação — `app/layout.tsx`)

| Provider | Responsabilidade |
|---|---|
| `ThemeProvider` | Gerencia light/dark/system. Persiste em `localStorage('theme')`. Aplica classe `dark` no `<html>` com transição de 320ms. Anti-FOUC via script inline no `<head>`. |
| `RefreshProvider` | Registra o status de sync de todos os hooks de dados. Alimenta o `DataStatusIndicator`. |
| `MesProvider` | Mês selecionado globalmente (`mesAtual: Date`). Persiste em `localStorage`. Todos os seletores de mês compartilham este estado. |
| `CategorizacaoProvider` | Controla o estado de categorização em lote de transações (usado na tela `/importar`). |
| `ClientShell` | Wrapper cliente que renderiza `BottomNav`, gerencia notificações e injeta o indicador de status de dados. |

### Navegação

**Mobile** — `BottomNav` (barra fixa na base da tela, z-index 50):
- 5 itens visíveis: **Dashboard**, **Finanças**, **Compras**, **Lista** (mercado), **Mais** (abre sheet lateral)
- Botão FAB central `+` abre `FabQuickLaunchSheet` com ações rápidas
- Ícone de badge laranja no item "Compras" quando há transações para categorizar
- Ícone `WifiOff` quando offline; rotas bloqueadas offline redirecionam para `/dashboard` ou `/lista-mercado`

**Desktop** — Sidebar vertical à esquerda com todos os itens:
- Dashboard, Despesas, Receitas, Investir, Compras, Assinaturas, Chat, Lista de Mercado, Wishlist, Importar, Analytics, Configurações

**Padrão de layout de página:**
```
sticky header (título + MonthSelector) → page-content (scroll)
```

---

## 2. Telas

### 2.1 Dashboard (`/dashboard`)

**Propósito:** Visão geral do mês — gastos por cartão, caixa, assinaturas em atraso, projeção de parcelas e evolução histórica.

**Fontes de dados:** `useGlobalSync` buscando `transacoes_nubank` + `planejamento`. Cache key: `dashboard:{mes}`.

**Estrutura visual (de cima para baixo):**

1. **Header sticky** — título "Dashboard" + `MonthSelector` + ícone `PeriodSelectorSheet` (seleção de período) + `NotificacoesBell` (sino com contagem de não lidas)

2. **Cards de fatura por cartão** — um card por cartão (NuBank Matheus, NuBank Jeniffer, NuBank Conjunto, Cartão 1, Cartão 2):
   - Exibe: valor gasto, percentual do limite/previsto, barra de progresso colorida
   - Cor da barra: verde (<70%), amarelo (70–90%), vermelho (>90%)
   - Clicável: abre `DrawerDetalhes` com breakdown de transações do cartão

3. **Card Resumo de Caixa** — saldo líquido previsto do mês:
   - `Receita Total − (Contas Fixas + Faturas + Investimentos)`
   - Exibe: valor positivo (verde) ou negativo (vermelho)
   - `InfoPopover` explica o cálculo

4. **Card Assinaturas não pagas** — contagem de assinaturas vencidas por pessoa (Matheus / Jeniffer), com link para `/assinaturas`

5. **`GraficoProjecao`** — gráfico de barras Chart.js mostrando projeção de gastos com parcelas dos próximos 6 meses. Clicável nas barras: abre `DrawerDetalhes` com lista de parcelas do mês clicado.

6. **`GraficoEvolucaoMensal`** — linha histórica de receitas vs despesas vs investimentos (últimos 6 meses). Clicável: abre `DrawerDetalhes`.

7. **`GraficoEvolucaoInvestimentos`** — gráfico de área mostrando evolução do saldo de investimentos.

**Comportamentos especiais:**
- Todos os gráficos são `dynamic import` com `ssr: false` para evitar erros de hidratação
- `PeriodSelectorSheet` permite selecionar um intervalo de datas customizado para os gráficos
- `DataStatusIndicator` no rodapé mostra status de sync: `loading` / `success` / `error` / `stale`

---

### 2.2 Finanças (`/financas`)

**Propósito:** Hub de planejamento mensal com 3 abas — Despesas, Receitas e Investimentos.

**Seleção de aba:** via `?tab=despesas|receitas|investimentos` na URL (sincronizado com `useSearchParams`). Default: `despesas`.

**Header:** título dinâmico conforme aba ativa + `MonthSelector`.

**Card de Saldo** (visível na aba Investimentos): mostra `saldo real` e `saldo previsto` calculados via `calcularSaldo()` — função que cruza `transacoes_nubank` com `planejamento`.

#### Aba Despesas → `ChecklistMensal`

Componente: `components/ChecklistMensal.tsx`

- Lista todas as despesas do `planejamento` do mês (exceto receitas e cartões de crédito)
- Cada item exibe: nome, valor previsto, valor real (se pago), checkbox de "pago"
- **Swipe para esquerda** → delete (via `SwipeableItem`)
- **Toque no item** → abre modal de edição inline (nome, valor previsto, valor real, responsável)
- **Barra de progresso** geral: soma das despesas pagas / soma total prevista
- **Botão "+"** → modal para adicionar nova despesa ao planejamento
- Cards de totais: previsto vs realizado, por pessoa (Matheus / Jeniffer)
- Categorias marcadas com cor à esquerda (4px border-left)

#### Aba Receitas → `ReceitasMensal`

Componente: `components/ReceitasMensal.tsx`

- Lista itens prefixados com `[RECEITA]` no `planejamento` + linha "Receita Total"
- Mesmo padrão de CRUD do ChecklistMensal
- Exibe total previsto de receitas e diferença vs mês anterior

#### Aba Investimentos → `InvestimentosMensal`

Componente: `components/InvestimentosMensal.tsx`

- Lista fundos/ativos de investimento com meta percentual (% do saldo)
- Cada linha: nome do fundo, % meta, valor calculado, status (atingido/abaixo)
- Mostra saldo disponível após despesas no topo
- Botão para adicionar novo fundo

---

### 2.3 Compras (`/compras`)

**Propósito:** Visualizar e editar todas as transações importadas de cartão, agrupadas por data.

**Fontes de dados:** `useGlobalSync` em `transacoes_nubank`. Cache key: `compras:{mesRef}`.

**Filtros disponíveis (barra de filtros horizontal scrollável):**
- Por cartão: NuBank / Cartão 1 / Cartão 2
- Por responsável: Matheus / Jeniffer
- Por categoria: dropdown com todas as categorias existentes
- Busca por texto (descrição)
- Filtro "sem categoria" para identificar transações não classificadas

**Agrupamento:** as transações são agrupadas por `data_compra` (ou `data`). O cabeçalho do grupo exibe "Hoje", "Ontem" ou dia da semana formatado.

**Card de transação:**
- Emoji/ícone da categoria à esquerda
- Nome da transação + categoria + parcela (ex: "3/12")
- Valor em destaque
- Badge colorido por responsável (azul=Matheus, rosa=Jeniffer)
- Badge do cartão (NuBank / Cartão 1 / Cartão 2)
- Swipe para esquerda → delete com confirmação
- Toque → abre modal de edição: descrição, valor, responsável, categoria, data

**Rodapé:** total de transações filtradas + soma dos valores.

**Badge no BottomNav:** número de transações sem categoria (cor laranja).

---

### 2.4 Lista de Mercado (`/lista-mercado`)

**Propósito:** Lista de compras colaborativa e offline-first entre o casal.

**Hook:** `useListaMercado` — gerencia fila offline com `offlineQueue`.

**Estados do cabeçalho:**
- `WifiOff` badge quando offline
- Contagem de operações pendentes na fila offline

**Funcionalidades:**

1. **Adicionar item:**
   - Campo de texto com autocomplete do histórico dos últimos 50 itens (salvo em `localStorage`)
   - Botão de câmera → abre `CameraOCR` para ler preço via câmera
   - Após adicionar: item aparece no topo da lista

2. **Item da lista:**
   - Checkbox de "comprado" (risco e fundo esmaecido)
   - Nome + quantidade (botões − / +)
   - Preço unitário (editável inline)
   - Avatar colorido do criador (Matheus=azul, Jeniffer=rosa, outros=paleta)
   - Swipe para esquerda → delete
   - Dica de swipe exibida na primeira visita (persiste em `localStorage('lista-mercado-swipe-hint')`)

3. **Resumo de compras:**
   - Total estimado (soma de `preco_unit × quantidade` dos itens não comprados)
   - Botão "Finalizar compra" → salva sessão no histórico e limpa a lista

4. **Botão histórico** (ícone relógio) → navega para `/lista-mercado/historico`

**Modo offline:** mutações (add/update/delete) entram na fila como `PendingOp` e são executadas quando a conexão volta. Visual: items com operação pendente exibem ícone de relógio.

---

### 2.5 Histórico de Compras (`/lista-mercado/historico`)

**Propósito:** Ver compras passadas finalizadas.

**Hook:** `useHistoricoCompras`.

**Visual:** lista de sessões com data, valor total da sessão e itens comprados. Expansível por sessão para ver os itens individuais.

---

### 2.6 Wishlist (`/wishlist`)

**Propósito:** Lista de desejos compartilhada do casal com prioridades, categorias e identificação por IA.

**Hook:** `useWishlist` — CRUD com fila offline.

**Filtros/ordenação:**
- Por prioridade: Alta / Média / Baixa (badge colorido: vermelho/âmbar/cinza)
- Por categoria: dropdown com as categorias (`Eletrônicos`, `Casa`, `Moda`, etc.)
- Busca por texto
- Alternância: mostrar/ocultar itens já realizados
- Ordenação: por data, por valor, por prioridade

**Card de item:**
- Emoji selecionável (grade com 60 emojis organizados por categoria)
- Nome, categoria, valor estimado
- Badge de prioridade com borda colorida lateral
- Imagem (se identificada pela IA): miniatura clicável
- Badge `ai_status`: `pendente` / `identificado` / `nao_identificado`
- Avatar do criador (ou "conjunto")
- Coração (favoritar)
- Swipe para esquerda: deletar / marcar como realizado

**Modal de adicionar/editar:**
- Campo nome
- Seletor de emoji (grade scrollável)
- Valor estimado
- Prioridade (Alta/Média/Baixa)
- Categoria (dropdown)
- Botão câmera → `CameraOCR` → envia imagem para `/api/wishlist-items/identify` → Gemini identifica o produto e preenche campos automaticamente
- Quem adicionou: Matheus / Jeniffer / Conjunto

**Compartilhamento:** botão "Compartilhar" gera link de compartilhamento para `/wishlist/share-recebido?token=...`.

---

### 2.7 Wishlist Compartilhada (`/wishlist/share-recebido`)

**Propósito:** Receber e visualizar uma wishlist compartilhada pela outra pessoa.

**Fluxo:** o token na URL identifica a wishlist. Exibe os itens em modo somente-leitura com opção de adicionar à própria wishlist.

---

### 2.8 Chat IA (`/chat`)

**Propósito:** Assistente financeiro com histórico de conversas, alimentado pelo Gemini.

**Estrutura:**

1. **Sidebar de conversas** (em desktop, drawer em mobile):
   - Lista conversas anteriores com preview e contagem de mensagens
   - Botão "Nova conversa" (`+`)
   - Botão de lixeira por conversa

2. **Área de mensagens:**
   - Bolhas diferenciadas: usuário (fundo primary, à direita) / IA (fundo branco, à esquerda)
   - Ícone de robô (`Bot`) nas mensagens da IA
   - Renderização de markdown: `**bold**`, `*itálico*`, `` `code` ``, `# heading`, listas `- item`, blocos de código com fundo escuro

3. **Sugestões rápidas** (quando conversa vazia):
   - 6 botões de sugestão pré-definidos: "Como estamos no orçamento esse mês?", "Quais foram os 5 maiores gastos?", etc.

4. **Input:**
   - Textarea expansível (Enter envia, Shift+Enter quebra linha)
   - Botão de envio desabilitado enquanto aguarda resposta
   - Indicador de "digitando" (3 pontos animados) enquanto IA responde

5. **Contexto enviado à IA:** transações do mês, planejamento, resumo de caixa — tudo serializado e injetado no system prompt via `/api/chat`.

**Persistência:** conversas salvas no Supabase (tabelas `chat_conversations` + `chat_messages`).

---

### 2.9 Assinaturas (`/assinaturas`)

**Propósito:** Controle de assinaturas recorrentes (streaming, serviços, etc.).

**Componente:** `AssinaturasMensal`.

**Visual:**
- Agrupado por responsável: Matheus / Jeniffer / Conjunto
- Cada assinatura: nome, valor mensal, data de vencimento, status (ativa/inativa)
- Toggle de ativo/inativo
- Badge de vencida quando data de vencimento já passou sem pagamento
- Total por pessoa no rodapé de cada grupo

**CRUD:** adicionar/editar/deletar assinaturas. Modal com campos: nome, valor, dia de vencimento, responsável, ativo.

---

### 2.10 Investimentos (`/investimentos`)

**Propósito:** Acompanhar metas de investimento mensais por fundo.

**Visual:** cards por fundo com:
- Nome do fundo
- Meta em %
- Valor calculado (% × saldo disponível)
- Barra de progresso
- Valor já investido vs meta

---

### 2.11 Receitas (`/receitas`)

**Propósito:** Planejar e registrar entradas de dinheiro do mês. Equivale à aba Receitas da tela Finanças, mas acessível diretamente pelo menu desktop.

---

### 2.12 Importar CSV (`/importar`)

**Propósito:** Upload de extratos CSV do NuBank/cartões e ferramentas de diagnóstico.

**Estrutura:**

1. **Seletor de cartão:** tabs NuBank / Cartão 1 / Cartão 2

2. **Drop zone de arquivo:**
   - Arrastar e soltar ou clicar para selecionar CSV
   - Exibe nome do arquivo selecionado
   - Upload via `POST /api/import` (NuBank) ou `/api/import/cartao`
   - Resumo pós-importação: total lido, novas linhas, duplicatas, valor por responsável

3. **Botão "Categorizar com IA"** (ativa após import):
   - Usa `CategorizacaoProvider` para chamar `/api/categorizar` em lote
   - Mostra progresso e mensagem de resultado

4. **Diagnóstico de duplicatas:**
   - Botão "Verificar duplicatas" → `GET /api/import/diagnostico`
   - Exibe pares suspeitos com: descrição, valor, datas, diferença em dias, fatura
   - Dois modos de correção: "Conservador" (remove apenas mesma fatura) e "Completo" (remove todos os pares)
   - Confirmação antes de executar a remoção

5. **Log de atividades:** últimas importações registradas com timestamp e descrição

6. **Modal de API:** exibe endpoint e token para importação programática via API (ex: automação NuBank)

---

### 2.13 Configurações (`/configuracoes`)

**Propósito:** Configurar ciclos de faturamento, datas de fechamento, categorias e visualizar logs de atividade.

**Seções:**

1. **Ciclos de cartão:** data de fechamento e vencimento por cartão (NuBank, Cartão 1, Cartão 2). Determina o `projeto_fatura` de cada transação.

2. **Categorias customizadas:** adicionar/remover categorias além das padrão. Persiste em tabela `configuracoes`.

3. **Nomes dos cartões:** personalizar labels "Cartão 1" e "Cartão 2".

4. **Log de atividades:** tabela com últimas ações (import, edição, delete) com usuário, descrição e timestamp.

5. **Tema:** seletor Light / Dark / Sistema.

6. **Notificações:** configurar alertas de vencimento de contas.

---

### 2.14 Analytics (`/analytics`)

**Propósito:** Dashboard analítico avançado, otimizado para desktop.

**Componente:** `AnalyticsDesktop`.

**Visual:** grade de cards com gráficos maiores — tendências de 6 meses, breakdown por categoria, comparativo entre pessoas, evolução de investimentos.

---

### 2.15 Extras (`/extras`)

**Propósito:** Atalhos para Chat e Configurações em mobile (itens que não cabem no BottomNav de 5 itens).

---

### 2.16 Login (`/login`)

**Propósito:** Autenticação.

**Visual:** card centralizado com campos email + senha. Submit via Supabase Auth (`signInWithPassword`). Redirect para `/dashboard` após sucesso.

---

## 3. Componentes Compartilhados

### `MonthSelector`
Seletor de mês com setas ← →. Exibe "mês/ano" em português. Ao mudar, atualiza `MesProvider` e todos os hooks reagem.

### `BottomNav`
Barra de navegação mobile fixa. Ver seção 1 (Navegação).

### `SwipeableItem`
Wrapper de swipe-to-delete. Deslizar para esquerda revela botão de delete vermelho. Toque cancel reverte. Usado em: Compras, Lista Mercado, Wishlist, Despesas.

### `ModalPortal`
Renderiza modais em `#modal-root` (fora da árvore de componentes) via `createPortal`. Evita problemas de z-index e overflow.

### `EmptyState`
Placeholder para listas vazias. Props: ícone, título, descrição, CTA opcional.

### `DataStatusIndicator`
Indicador discreto de status de sync dos dados. Estados: `syncing` (spinner), `error` (vermelho), `stale` (amarelo — dado do cache), `ok` (invisível).

### `NotificacoesBell`
Ícone de sino com badge de contagem. Busca notificações não lidas do Supabase.

### `CameraOCR`
Abre câmera do dispositivo via `getUserMedia`. Captura frame e envia para `/api/ocr-preco` para extrair valor monetário da imagem. Usado em Lista de Mercado e Wishlist.

### `DrawerDetalhes`
Drawer (bottom sheet) com detalhes de um ponto do gráfico clicado. Exibe lista de transações ou parcelas do período.

### `GraficoProjecao`
Gráfico de barras (Chart.js) com projeção de parcelas dos próximos 6 meses. Dados de `/api/projection`. Barras clicáveis.

### `GraficoEvolucaoMensal`
Gráfico de linhas com receitas/despesas/investimentos dos últimos 6 meses. Dados de `/api/analytics`.

### `GraficoEvolucaoInvestimentos`
Gráfico de área com saldo de investimentos ao longo do tempo.

### `PeriodSelectorSheet`
Bottom sheet para selecionar intervalo de datas (de/até mês). Usado no Dashboard para filtrar os gráficos.

### `FabQuickLaunchSheet`
Sheet com ações rápidas acessadas pelo FAB `+` central do BottomNav. Ações típicas: adicionar despesa, adicionar receita, ir para importação.

### `InfoPopover`
Balão de informação/tooltip. Props: texto explicativo. Exibido ao toque em ícone `?`.

---

## 4. Padrões de Dados e Sync

### Cache e Realtime
Todos os hooks de dados usam `useGlobalSync` (wrapper de `useDataSync`) que:
1. Serve cache do `localStorage` imediatamente (sem loading)
2. Assina realtime do Supabase via WebSocket
3. Faz polling a cada 45s como fallback
4. Atualiza cache e UI ao receber dados novos

### Offline Queue
Mutações offline são salvas como `PendingOp` em `localStorage`. Ao voltar online, são executadas na ordem de criação. Erros são logados mas não bloqueiam.

### Modelo de dados central

```
Transacao {
  hash_linha        -- ID único (hash do CSV)
  data_compra       -- data real da compra
  data              -- data do extrato
  descricao         -- nome do estabelecimento
  valor             -- valor em R$
  responsavel       -- 'Matheus' | 'Jeniffer'
  categoria         -- categoria classificada
  cartao            -- 'nubank' | 'cartao1' | 'cartao2'
  parcela_atual     -- número da parcela (nullable)
  total_parcelas    -- total de parcelas (nullable)
  projeto_fatura    -- mês de referência da fatura (yyyy-MM-dd)
  categoria_origem  -- 'MANUAL' | 'AI' | null
}

Planejamento {
  item              -- nome do item (com prefixos especiais)
  mes_referencia    -- mês (yyyy-MM-dd, primeiro dia)
  responsavel       -- pessoa responsável
  valor_previsto    -- meta/orçamento
  valor_real        -- valor efetivamente pago (nullable)
  pago              -- boolean
}
```

**Prefixos especiais em `planejamento.item`:**
- `[RECEITA] Nome` → entrada de receita
- `[CARTAO1] Nome` → parcela referente ao Cartão 1
- `[CARTAO2] Nome` → parcela referente ao Cartão 2
- `NuBank Matheus` / `NuBank Jeniffer` / `NuBank Jeniffer Conjunto` → fatura NuBank
- `Receita Total` → linha especial de receita base

---

## 5. Sistema de Temas e Cores

- **primary**: indigo/roxo (botões, seleções, links)
- **matheus**: azul — identifica transações/elementos do Matheus
- **jeniffer**: rosa/magenta — identifica transações/elementos da Jeniffer
- **emerald**: sucesso, valores positivos
- **red**: perigo, valores negativos, exclusão
- **amber**: aviso, itens próximos do limite

Modo escuro (`dark:`) via classe no `<html>`. Transição suave de 320ms entre temas.

Cards usam `rounded-2xl` / `rounded-3xl`, `shadow-card` (custom), `border border-gray-100`.

---

## 6. PWA e Mobile

- Manifesto em `/manifest.json`
- Service Worker em `/sw.js`: cache de GETs, background sync, push notifications
- Splash screens iOS em múltiplas resoluções (light + dark)
- `safe-area-inset-*` para notch
- Padding inferior da página aumenta quando offline (exibe banner offline)
- Toque mínimo de 44×44px nos controles interativos
