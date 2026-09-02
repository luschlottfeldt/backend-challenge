# Arquitetura

Processador distribuído de apostas: recebe transações de provedores (HTTP e SQS), aplica-as a
carteiras com correção financeira e garantias de concorrência/idempotência, e publica eventos de
integração via Transactional Outbox.

Rascunho com o histórico completo de decisões e trade-offs: [`DECISIONS.md`](./DECISIONS.md).

## Como foi desenvolvido

O desenvolvimento foi feito com **Claude Code 2.1.258** (modelo Claude Sonnet 5), em blocos
(domínio → persistência → casos de uso → HTTP → mensageria → observabilidade/testes), com
**revisão a cada bloco e ao final**. Após a conclusão, a suíte de testes foi **executada
manualmente** contra o Postgres e o LocalStack reais (`bun test test/unit`, `test/integration`,
`test/concurrency`), além de `tsc --noEmit`, `oxlint` e um boot completo da aplicação.

## Stack

- **Bun 1.4** (runtime, gerenciador de pacotes e test runner) + **NestJS 12** + TypeScript strict.
- **MikroORM 7** com PostgreSQL 16 — Data Mapper: entidades de domínio puras, entidades de
  persistência separadas, mapeadores explícitos entre as duas.
- **PostgreSQL 16** + **LocalStack (SQS)** via Docker Compose.
- `decimal.js` (interno ao VO `Money`), `prom-client` (métricas), `@aws-sdk/client-sqs`.

## Camadas

Arquitetura hexagonal, dependências apontando só para dentro:

- **domain** — entidades, value objects, máquina de estados, erros. Zero import de framework.
- **application** — casos de uso, o serviço `WagerTransactionProcessor` (lógica compartilhada
  entre HTTP/SQS/reprocessamento) e as *portas* (`TransactionRunner`, `Clock`, `IdGenerator`,
  `Logger`, `Metrics`, `LogContextStore`, `MessagePublisher`, repositórios).
- **infrastructure** — adapters: repositórios MikroORM, cliente/consumidor/publicador SQS,
  relógio, gerador de UUID, logger estruturado, métricas Prometheus.
- **presentation** — controllers HTTP, DTOs (`class-validator`), filtro de exceção, interceptor
  de contexto de log, guard de auth (no-op — ver abaixo).

## Modelo de domínio

- **`Money`** — value object sobre `Decimal`, escala fixa 2, rejeita entradas malformadas e
  operações entre moedas diferentes.
- **`Wallet`** — agregado com saldo, moeda e `version`. `version` é um contador monotônico de
  alterações de saldo (inicia em 1, incrementa só em `debit`/`credit`), exposto na API e no
  evento `WalletBalanceChanged`; **não** é usado para optimistic locking — o controle de
  concorrência é 100% pessimista (`SELECT ... FOR UPDATE`). `open()` gera a transação `OPENING` +
  lançamento `CREDIT` quando o saldo inicial é positivo. `debit()`/`credit()` produzem o
  lançamento no ledger e recusam débito sem saldo.
- **`WagerTransaction`** — máquina de estados como tabela de transições
  (`PENDING → PROCESSED | PENDING_REFERENCE | REJECTED | FAILED`), transições inválidas lançam.
  `REFUND`/`ROLLBACK` exigem referência; `ROLLBACK` inverte a direção do lançamento referenciado.
- **`WalletLedgerEntry`** — lançamento imutável, valida que `saldoAntes ∓ valor = saldoDepois`.
- **`InboxMessage` / `OutboxMessage`** — deduplicação de entrada e outbox transacional.
- Fábricas estáticas com construtor privado; `rehydrate()` nunca revalida (reconstrói estado
  persistido).

## Garantias no schema

As invariantes da seção 6 são aplicadas **no banco**, não só em código (restrição 9):

- **Não-negatividade** — `check (balance_amount >= 0)` em `wallets`.
- **Unicidade de identidade** — `unique (player_id, currency)` em `wallets`; `unique
  (idempotency_key)` e `unique (provider_id, external_transaction_id)` em `wager_transactions`;
  `unique (wallet_id, transaction_id)` em `wallet_ledger_entries` (no máximo um lançamento por
  transação por wallet).
- **Reversão única por tipo** (regra 7.4) — `unique (reference_transaction_id, kind)` em
  `wager_transactions`. `reference_transaction_id` só é preenchido em `REFUND`/`ROLLBACK`
  `PROCESSED`; `NULL` é distinto no índice, então `BET`/`WIN`/`LOSS`/`OPENING` e rejeições não
  são afetados. A violação vira `REFERENCE_ALREADY_REVERSED` (422), igual à checagem em código.
- **Imutabilidade do ledger** — triggers `BEFORE UPDATE`/`BEFORE DELETE` em
  `wallet_ledger_entries` que sempre lançam; `UPDATE`/`DELETE` (inclusive SQL cru) falha no
  banco. MikroORM roda com `schemaGenerator.ignoreTriggers`/`ignoreRoutines` para não dropá-los
  no diff.
- **Inbox** — PK composta `(consumer_name, message_id)`.

## Concorrência

A unidade de concorrência é a **carteira**. Ao processar uma transação, a carteira é lida com
`SELECT ... FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) — duas transações na mesma carteira
serializam no banco, o saldo nunca fica negativo e cada aposta gera no máximo um lançamento.
Pessimista (não otimista) por causa da alta contenção esperada nos cenários do desafio.
O worker do outbox usa `FOR UPDATE SKIP LOCKED` para rodar com múltiplos publicadores.

## Idempotência

- O header **`Idempotency-Key`** é a fonte da verdade (default `"{providerId}:{externalTxId}"`).
- `payloadHash` = SHA-256 de um JSON canônico (chaves ordenadas) **só dos campos de negócio** —
  header e metadados de transporte ficam de fora.
- Mesma key + mesmo payload → mesma resposta com `idempotentReplay: true`. Mesma key + payload
  diferente → `409`, nunca replay.
- O replay devolve o **saldo observado quando a transação foi processada**, não o saldo atual: o
  processador grava `result_balance_amount` na `wager_transactions` em todo desfecho terminal
  (inclusive `LOSS`, `REJECTED` e `PENDING_REFERENCE`, que não geram lançamento). Fallback para
  transações antigas sem a coluna: `balanceAfter` do lançamento, depois o saldo atual.
- Entrada por SQS deduplica adicionalmente pelo **inbox persistente** `(consumerName, messageId)`,
  gravado na **mesma transação** do efeito de negócio.

## Mensageria

- **Outbox** — a transação de negócio (transação, saldo, ledger, inbox) e as linhas de evento na
  `outbox_messages` são gravadas na **mesma transação SQL**; o evento nunca é publicado antes do
  commit. Um worker agendado, em transação separada, reclama os pendentes com
  `FOR UPDATE SKIP LOCKED` (vários publicadores em paralelo, sem repetir linha), publica na fila
  `integration-events.fifo` e marca `published_at`; em falha, `scheduleRetry` com backoff
  exponencial. A publicação e o `markPublished` acontecem dentro dessa transação do worker: se o
  processo morre no meio, a transação aborta, as linhas voltam a `pending` e outra instância
  republica — publicação duplicada é segura (o consumidor deduplica pelo inbox e pela dedup FIFO).
- **Consumidor SQS** — long-polling em `wager-transactions.fifo`, reusa o mesmo caso de uso do
  HTTP. Classificação de erro: negócio (terminal, `ack`) · malformada / erro de domínio
  permanente (DLQ + `ack`) · transitório (sem `ack`, reentrega; a SQS manda pra DLQ após 5
  tentativas). `SIGTERM` conclui a mensagem em andamento antes de sair.
- **Referências fora de ordem** — `REFUND`/`ROLLBACK` sem a transação referenciada ficam
  `PENDING_REFERENCE`; um worker reprocessa com backoff exponencial e, esgotadas 10 tentativas,
  rejeita com `REFERENCE_NOT_FOUND`.
- **Processo único** — API + os 3 workers rodam juntos, cada worker ligável por env
  (`OUTBOX_PUBLISHER_ENABLED`, `SQS_CONSUMER_ENABLED`, `REFERENCE_REPROCESS_ENABLED`), então dá
  para escalar réplicas com papéis diferentes sem mudar código.

## API HTTP

Status mapeados de forma consistente entre todos os endpoints (o provedor decide o que fazer sem
ler mensagem de erro):

| Situação | Status |
|---|---|
| Payload inválido | `400` |
| Conflito de idempotência / carteira duplicada | `409` |
| Rejeição por regra de negócio (com `failureCode`) | `422` |
| Aceite com processamento pendente | `202` |
| Não encontrado | `404` |
| Falha transitória de infraestrutura | `503` |

Corpo de erro padronizado: `{ code, message, failureCode?, details? }`.
Paginação do ledger por **cursor opaco e estável** (`created_at` + `id`, base64url).

## Observabilidade

- **Logs estruturados JSON** — `StructuredLogger` é instalado como logger da aplicação
  (`app.useLogger` em `main.ts`), então tudo (framework, exceções, workers) sai em JSON, com
  `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` propagados por
  `AsyncLocalStorage`. Nenhum valor monetário é logado — a divergência de reconciliação registra
  só `walletId`, `checkedEntries` e a direção (`stored-below/above-ledger`), sem os montantes. O
  SQL debug do MikroORM fica **desligado** por padrão (`MIKRO_ORM_DEBUG=true` para ligar).
- **Métricas Prometheus** em `GET /metrics`: transações por status, duplicatas detectadas,
  retries, mensagens em DLQ, conflitos de lock, latência de processamento (histograma), outbox
  lag e divergências de reconciliação.
- **Health checks** separados: `GET /health/live` (processo) e `GET /health/ready` (Postgres +
  SQS).
- Divergência de reconciliação nunca é corrigida em silêncio — é logada, contabilizada em métrica
  e sinalizada na resposta.

## Testes

- **Unidade** (`test/unit/`) — domínio puro, sem I/O.
- **Integração** (`test/integration/`) — Postgres + LocalStack reais, incluindo o boot do
  `AppModule` inteiro via `supertest`.
- **Concorrência** (`test/concurrency/`) — os cenários obrigatórios: 50 apostas idênticas em
  paralelo → 1 débito; saldo 100 + duas apostas de 80 → 1 `PROCESSED` + 1 `REJECTED` + saldo 20;
  3 consumidores competindo pela fila; worker que commita e morre antes do `ack`; dois
  publicadores concorrentes; `REFUND` antes da referência.
- **Multi-processo** (`test/concurrency/multi-process.spec.ts`) — o harness
  `harness/instance.ts` é iniciado como **processo `bun` separado**; três instâncias disputam a
  mesma carteira contra o mesmo Postgres (start alinhado por `startAtEpochMs`): exatamente uma
  ganha o saldo contestado, uma `Idempotency-Key` compartilhada aplica uma única vez entre os três
  processos, e carteiras distintas são processadas em paralelo sem contenção cruzada.
- **Restart** (`test/concurrency/restart-recovery.spec.ts`) — uma instância real da aplicação
  (`NestFactory.createApplicationContext`, consumidor + outbox ligados) processa mensagens de uma
  fila FIFO dedicada, recebe `SIGKILL` no meio do trabalho (sem shutdown gracioso), e uma segunda
  instância assume: cada mensagem termina `PROCESSED` **uma única vez** (inbox sobrevive ao
  restart), saldo e ledger batem, `reconcile` consistente, e o outbox drena todos os eventos.

Nenhum mock de banco ou fila — as três categorias que exigem infraestrutura rodam contra os
containers do `docker-compose.yml`.

## Autenticação — não implementada

**Não implementei.** Autenticação não vale pontos (seção 2 do desafio) e é um padrão/tecnologia
com que não tenho familiaridade; o próprio núcleo do desafio já trazia tecnologias e padrões
novos para mim (MikroORM 7 com a API nova, Data Mapper, outbox/inbox, locking pessimista), e
preferi concentrar o esforço na correção da solução. O ponto de extensão está explícito no
código: `NoOpAuthGuard` em todos os controllers de negócio (os de health ficam abertos de
propósito).

**Desenho que eu adotaria:** um **Identity Provider externo com OIDC**, fluxo *client
credentials* (máquina-a-máquina — cada provedor é um client), e um `AuthGuard` do NestJS no lugar
do `NoOpAuthGuard` validando o JWT de acesso contra o JWKS do IdP (sem lookup no banco por
request). O `providerId` viria de uma claim do token e seria confrontado com o `providerId` do
corpo/mensagem, mantendo as validações de domínio que já existem.

**Qual IdP:** **Keycloak**. É o mais comum no mercado, tem OIDC completo, imagem Docker madura e
integra direto com `@nestjs/passport` + `passport-jwt` via a URL de JWKS do realm — ou seja, a
opção mais documentada e de menor risco para quem não é da área. Zitadel seria a alternativa mais
leve e *API-first* se o footprint do Compose fosse uma preocupação; para este caso o peso extra
do Keycloak não é problema.

## Trade-offs e limitações conhecidas

- **`allowGlobalContext` no fixture de teste** — os testes unitários in-process usam
  `RequestContext.create` sobre um ORM com a flag ligada. Os testes multi-processo e de restart
  (`test/concurrency/*`) sobem processos separados / o `AppModule` inteiro, sem a flag — igual a
  produção, onde o `@mikro-orm/nestjs` embrulha cada request num `RequestContext`.
- **Outbox sem teto de tentativas** — o backoff cresce até 1h e a mensagem fica pendente para
  sempre até publicar. Aceitável porque a SQS é o gargalo e uma publicação atrasada é melhor que
  um evento perdido; um alerta sobre `wager_outbox_lag_seconds` cobriria o caso patológico.
- **Publicação do outbox dentro da transação do worker** — o `markPublished` roda junto do envio
  à SQS, segurando o lock (`SKIP LOCKED`) da linha do outbox durante o I/O externo; mitigado por
  lote pequeno (10) e pelo `SKIP LOCKED`, que deixa outros publicadores pegarem linhas diferentes.
  Escala melhor separando "claim" e "publish" em duas transações, ao custo de mais complexidade.
- **Sem teste de carga** (`test:load`) — a parte opcional não foi feita.
- **Autenticação** — ver acima.
