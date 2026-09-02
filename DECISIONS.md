# Registro de decisões (rascunho)

> Este arquivo é um rascunho de trabalho, mantido durante o desenvolvimento do desafio.
> Serve de base para escrever o `ARCHITECTURE.md` final. Cada entrada documenta uma decisão,
> a motivação e, quando relevante, as alternativas descartadas.

## Fechamento do boilerplate (tarefas 0–14)

Resumo do que existe ao final da fase de boilerplate, antes de começar a implementar lógica de
negócio:

- **Runtime:** Bun 1.4.0. **Node** (via NestJS/dependências) reportado como `v22.18.0`/`v26.3.0`
  conforme o contexto (sistema vs. Bun), mas a aplicação roda inteiramente sob Bun.
- **Framework:** NestJS 12 (`@nestjs/core@12.0.1`).
- **ORM:** MikroORM 7.1.14, API `defineEntity()`/`p` (decorators não estão mais disponíveis nesta
  versão do pacote `core` — ver seção "Camada de infraestrutura").
- **Banco:** PostgreSQL 16 (`postgres:16-alpine`, via Docker Compose), schema migrado com a
  migration inicial (`Migration20260901034558`), todas as constraints de banco da seção 5.9 do
  desafio já aplicadas.
- **Mensageria:** LocalStack 3, filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo`
  criadas automaticamente no boot dos containers, com redrive policy configurada
  (`maxReceiveCount: 5`).
- **Camadas presentes e compilando sem erros** (`tsc --noEmit` limpo em todas as tarefas):
  domain, application (placeholder), infrastructure, presentation, um único `AppModule`.
- **Endpoints mapeados:** todos os da seção 9 do desafio, mais `/health/live` e `/health/ready`
  (esses dois com lógica real, validados contra containers reais).
- **Testes:** scaffolding pronto (`test/unit/` para unidade, `test/integration/`,
  `test/concurrency/`), com um smoke test de integração real passando contra o Postgres.
- **Sem comentários no código-fonte** (convenção adotada a partir da tarefa 5, aplicada
  retroativamente a tudo o que já existia).
- **Validado do zero** (tarefa 11): containers recriados, `node_modules` reinstalado,
  migrations reaplicadas, aplicação sobe e os health checks respondem 200 — o setup é
  reproduzível a partir de um clone limpo com os comandos do `README.md`.

**O que fica para a próxima fase (desenvolvimento):** toda a lógica de negócio — `Money`,
`Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage` (hoje só
lançam `Not implemented`), os casos de uso em `application/use-cases/`, as implementações reais
dos repositórios, o worker de outbox, o consumidor SQS, o mapeamento de status HTTP no
`DomainExceptionFilter`, e os testes de fato (unidade, integração completa, concorrência).

## Bloco B — Persistência

### Tarefa 9 — migrations reversíveis + revisão de schema (implementado)

- **`Migration20260901034558` ganhou `down()`** (a migration inicial do boilerplate só tinha
  `up()`): `drop table if exists ... cascade` das 5 tabelas em ordem inversa. `cascade` remove
  constraints/índices junto.
- **`Migration20260901194833`** (nova, gerada por `migration:create` a partir do diff das
  entidades — `up()`/`down()` automáticos na v7):
  - `wager_transactions`: `+ reference_check_attempts int not null default 0`,
    `+ next_reference_check_at timestamptz null` — estado de backoff **por linha** do worker de
    reprocessamento de `PENDING_REFERENCE` (seção 7.1: "backoff exponencial" + "limite de
    tentativas ou TTL"). Optamos por rastrear tentativas na própria linha, não só um TTL por
    `created_at`, pra ter backoff exponencial real por transação.
  - `+ index (status, next_reference_check_at)` — query do worker
    (`WHERE status = 'PENDING_REFERENCE' AND next_reference_check_at <= now`).
  - `+ index (reference_transaction_id)` — checagem "referência já revertida por este kind"
    (`WHERE reference_transaction_id = ? AND kind = ?`). Sem FK self-referencial por ora: a
    unique `(wallet_id, transaction_id)` no ledger + as validações do caso de uso já barram
    dupla reversão; a FK seria defesa em profundidade e foi deixada como melhoria possível.
  - `wallet_ledger_entries`: `+ index (wallet_id, created_at, id)` — paginação keyset do
    endpoint `GET /wallets/:id/ledger` (cursor estável por `created_at`+`id`).
  - `outbox_messages`: índice `(next_attempt_at)` → `(published_at, next_attempt_at)` — casa
    com a query `findDue` (`WHERE published_at IS NULL AND next_attempt_at <= now`).
- **Ciclo validado contra o Postgres real** (containers do `docker-compose.yml`):
  `up` → `migration:check` limpo → `down` (Migration2) → `down` (Migration1, teardown total,
  sobra só `mikro_orm_migrations`) → `up` (reaplica as duas do zero) → `migration:check`
  limpo. `bun test src` (100) e `bun run test:integration` (1) verdes.

### Tarefa 10 — mapeadores Data Mapper (implementado)

`src/infrastructure/database/mappers/*.mapper.ts` — um por entidade (`wallet`,
`wagerTransaction`, `walletLedgerEntry`, `inboxMessage`, `outboxMessage`), cada um um objeto
com `toDomain(row)` / `toPersistence(entity)`:

- `toDomain` **sempre** usa a factory `rehydrate` do domínio (não revalida — regra 6.0).
- `Money` ↔ colunas separadas `amount` (string decimal, como o driver `pg` devolve `numeric`) +
  `currency`. Reconstruído com `Money.from({ amount, currency })`.
- **Conversão `null` ↔ `undefined`**: o Postgres devolve `null` em colunas nullable, o domínio
  usa `undefined`. `toDomain` faz `row.x ?? undefined`; `toPersistence` faz `entity.x ?? null`.
- Cada mapper declara uma interface `XxxRow` **estrutural** (não a classe ORM) — a instância
  `defineEntity` do MikroORM é estruturalmente compatível e é passada direto pelo repositório;
  os testes montam rows sem tocar no ORM.
- `wagerTransaction` mapeia também `referenceCheckAttempts` / `nextReferenceCheckAt` — por
  isso a `WagerTransaction` do domínio ganhou esses dois campos (state + `rehydrate` +
  getters); os **métodos** de agendamento do backoff de `PENDING_REFERENCE` ficam para a
  tarefa 14. `WagerTransactionState.referenceCheckAttempts` é opcional (`?? 0` no `rehydrate`)
  pra não quebrar chamadas existentes.

7 testes de round-trip em `mappers.spec.ts` (domínio → `toPersistence` → row → `toDomain`),
cobrindo optionals nulos, estados terminais, referência resolvida.

### Tarefas 11 e 12 — repositórios de Wallet, WagerTransaction e Ledger (implementado)

**Padrão comum de `save`** (evita acoplar o domínio ao ORM): `mapper.toPersistence(entity)` →
`em.findOne({ id })`; se existe, `em.assign(managed, row)`, senão
`em.persist(em.create(OrmEntity, row))`; depois `await em.flush()`. `flush()` dentro de um
`em.transactional` escreve na transação aberta sem commitar (o commit é do wrapper de UoW —
tarefa 14); fora dele, é autocommit. Semântica de "save" consistente nos dois casos.

- **`version`** da wallet é coluna `int` comum (não `@Version` do MikroORM) — a estratégia é
  **pessimistic locking**, o `version` é controlado pelo domínio, não pelo ORM.
- **`WalletRepository.findByIdForUpdate`** = `em.findOne(..., { lockMode:
  LockMode.PESSIMISTIC_WRITE })` → `SELECT … FOR UPDATE`. Exige transação aberta (testado
  dentro de `em.transactional`).
- **`WagerTransactionRepository.findPendingReference(now, limit)`** — assinatura da interface
  ganhou `now` (era só `limit`). Filtra `status = PENDING_REFERENCE AND (next_reference_check_at
  IS NULL OR <= now)`, ordena por `next_reference_check_at asc`. **Sem lock** aqui: é só a
  listagem de candidatos; a serialização real vem do lock pessimista da wallet + checagem de
  estado terminal no caso de uso de reprocessamento.
- **Ledger é append-only**: `save` só faz `persist(create(...))` + `flush`, nunca `assign`.
  Duplicidade `(wallet_id, transaction_id)` estoura a unique do schema (testado).
- **`WalletLedgerEntryRepository.findByWallet(walletId, cursor?, limit?)`** — paginação
  **keyset** por `(created_at, id)`: `WHERE wallet_id = ? AND (created_at > c.createdAt OR
  (created_at = c.createdAt AND id > c.id)) ORDER BY created_at, id LIMIT n`. Usa o índice
  `(wallet_id, created_at, id)` da tarefa 9. `limit` default 50, teto 200.
- **Cursor opaco** (`ledger-cursor.ts`): base64url de `{ c: createdAt ISO, i: id }`. Decode
  valida e lança `InvalidLedgerCursorError` (`DomainError`, `INVALID_LEDGER_CURSOR` → HTTP 400)
  em cursor malformado. `encodeLedgerCursor` fica disponível pro caso de uso `GetLedger`
  montar o `nextCursor`.

**Testes de integração** contra Postgres real (`test/integration/orm-fixture.ts` — init do
MikroORM + `truncate ... cascade` no `beforeEach`): round-trip, uniques
(`player_id+currency`, `idempotency_key`, `provider_id+external_transaction_id`,
`wallet_id+transaction_id`), path de update via `assign`, `findByIdForUpdate` sob transação,
`findPendingReference` filtrando, paginação por cursor em 3 páginas, cursor inválido. **14
testes de integração + 6 unitários** (`ledger-cursor.spec.ts`, `mappers` já contava).

### Tarefas 13 e 14 — repositórios de mensageria + Unit of Work (implementado) — fecha o Bloco B

- **`InboxMessageRepository`** — `findByMessageId(consumerName, messageId)` pela PK composta;
  `save` no mesmo padrão find-or-`assign`/`create` + `flush`. A unicidade real é a PK composta
  no schema (testada com `insert` cru duplicado → viola).
- **`OutboxMessageRepository.findDue(now, limit)`** — `WHERE published_at IS NULL AND
  (next_attempt_at IS NULL OR <= now) ORDER BY next_attempt_at LIMIT n` com
  `LockMode.PESSIMISTIC_PARTIAL_WRITE` (= `FOR UPDATE SKIP LOCKED`). Exige transação aberta.
  Teste de concorrência real: publisher A segura o lock de uma linha numa transação; publisher
  B, em paralelo, chama `findDue` e **recebe a outra linha** (não bloqueia, não repete).
- **Port de Unit of Work** — `TransactionRunner { run<T>(work): Promise<T> }` +
  `TRANSACTION_RUNNER` (Symbol) em `application/ports/`. Impl `MikroOrmTransactionRunner` =
  `this.em.transactional(work)`. **Descoberta validada:** dentro de `em.transactional(cb)` o
  MikroORM cria um fork e o expõe via `TransactionContext` (AsyncLocalStorage), então
  qualquer `repo` que use `this.em.*` dentro de `cb` — mesmo tendo recebido o `EntityManager`
  global por DI — resolve para o fork transacional. Não é preciso passar o `em` para os
  repositórios. Registrado no `AppModule`; app sobe limpo.
- Teste de atomicidade: `runner.run` gravando wallet + wager_tx + ledger + outbox → tudo
  commitado junto; `runner.run` que lança no meio → **rollback total** (nada persistido).

**Bloco B concluído:** migrations reversíveis validadas contra Postgres real, 5 mapeadores
Data Mapper, 5 repositórios reais, port de UoW. **111 testes unitários + 21 de integração**
(Postgres real via Docker Compose), `migration:check` limpo, `tsc`/`oxlint` limpos, `nest
start` sobe sem erro de DI.

## Bloco C — Casos de uso

### Portas de aplicação (novas)

`src/application/ports/`: `Clock` (`now()`), `IdGenerator` (`next()` → uuid), `Logger`
(`info`/`warn`/`error` com contexto). Adapters triviais em `infrastructure/` (`SystemClock`,
`UuidGenerator`, `LoggerAdapter` sobre o `StructuredLogger`). Motivo: manter `new Date()` /
`crypto.randomUUID()` fora da lógica dos casos de uso → determinismo e testabilidade (o teste
injeta um `MutableClock`). `ledger-cursor.ts` movido de `infrastructure/database/repositories/`
para `application/pagination/` — é regra de paginação pura, e tanto o repo (`decode`) quanto o
caso de uso `GetWalletLedger` (`encode` do `nextCursor`) precisam dela.

### Tarefa 15 — `CreateWalletUseCase`

Tudo dentro de `TransactionRunner.run`: checa `findByPlayerAndCurrency` (→
`WalletAlreadyExistsError`, 409), `Wallet.open` (com ids/relógio injetados), `walletRepo.save`
(se a unique `(player_id, currency)` estourar numa corrida → `PersistenceConflictError` →
convertido em `WalletAlreadyExistsError`). Se `initialBalance > 0`: cria a `WagerTransaction`
`OPENING` (`providerId: 'internal'`, `idempotencyKey: internal:opening:{walletId}`,
`markProcessed`), grava ledger `CREDIT` e **dois** eventos de outbox (`WalletBalanceChanged` +
`WagerTransactionProcessed`) — na mesma transação SQL. Retorna `{ id, playerId, balance,
version: 1 }`.

### Tarefa 16 — `SubmitWagerTransactionUseCase` (núcleo) + `WagerTransactionProcessor`

A lógica compartilhada entre HTTP/SQS/reprocessamento vive em
`application/services/WagerTransactionProcessor.process(tx, wallet, ctx)`, que **nunca lança
para rejeição de negócio** — retorna `{ status: PROCESSED | REJECTED | PENDING_REFERENCE,
balance, failureCode? }` e persiste tx + ledger + wallet + eventos conforme o caminho.

Fluxo do `Submit` (dentro de `run`):
1. `payloadHash` calculado antes da transação.
2. **Idempotência**: `findByIdempotencyKey`. Se existe e `matchesPayload` → **replay**
   (`idempotentReplay: true`), com o **saldo observado naquele momento** =
   `ledgerRepo.findByTransactionId(tx.id).balanceAfter` (ou saldo atual da wallet se a tx não
   gerou lançamento — `LOSS`/`REJECTED`/`PENDING_REFERENCE`). Se existe e **não** casa o
   payload → `IdempotencyConflictError` (409).
3. `walletRepo.findByIdForUpdate` (`SELECT … FOR UPDATE`) → serializa por `walletId`. Ausente →
   `WalletNotFoundError` (404).
4. `WagerTransaction.create` (lança `ReferenceResolutionError.required()` p/ `REFUND`/`ROLLBACK`
   sem referência → 422, **não persistido** — é payload malformado, não desfecho de negócio).
5. `processor.process`: moeda → referência → efeito no saldo → grava tudo + eventos.
6. `catch PersistenceConflictError` na corrida de idempotency key entre wallets distintas →
   re-lê e devolve replay/conflito.

**Resolução de referência** (`processor.resolveReference`): lookup por
`(providerId, referenceExternalTransactionId)`; contexto (`player`/`wallet`/`round`/`currency`)
→ `REFERENCE_CONTEXT_MISMATCH`; não-`PROCESSED` e terminal → `REFERENCE_NOT_PROCESSED`,
não-`PROCESSED` e não-terminal → tratado como **ausente** (espera); kind da referência fora do
permitido (`REFUND`→`BET`; `ROLLBACK`→`BET`/`WIN`/`REFUND`) → `REFERENCE_KIND_NOT_ALLOWED`;
valor ≠ → `AMOUNT_MISMATCH`; `findProcessedReversal(ref.id, kind)` acha uma reversão já
aplicada → `REFERENCE_ALREADY_REVERSED`.

**Efeito no saldo**: `tx.ledgerDirectionFor(reference)`; débito que estouraria o saldo →
`INSUFFICIENT_FUNDS` (`BET`) ou `REVERSAL_WOULD_OVERDRAW` (`ROLLBACK`/`REFUND`) — decidido pelo
processor via `wallet.canDebit` **antes** de mutar. `LOSS` não move saldo (só evento
`WagerTransactionProcessed`).

### Tarefa 17 — consultas

`GetWalletUseCase`, `GetWalletLedgerUseCase` (monta `nextCursor` quando a página encheu),
`GetWagerTransactionUseCase` (`byId` / `byProviderAndExternalId`). Not-found → 404
(`WalletNotFoundError` / `WagerTransactionNotFoundError`). Views em `use-cases/views.ts`
(`MoneyProps`, datas ISO).

### Tarefa 18 — `ReconcileWalletUseCase`

Recalcula o saldo iterando **todo** o ledger via cursor (páginas de 200), `Σ credit − Σ debit`.
`difference = stored − calculated` (pode ser negativo — string tipo `"-5.00"`), `consistent =
difference.isZero()`. Divergência → `logger.warn` estruturado (métrica fica pro Bloco F), nunca
corrige. Retorna `{ storedBalance, calculatedBalance, difference, consistent, checkedEntries }`.

### Tarefa 19 — `ReprocessPendingReferencesUseCase` + backoff em `WagerTransaction`

`WagerTransaction` ganhou `scheduleReferenceCheck(now)` (incrementa `referenceCheckAttempts`,
`nextReferenceCheckAt = now + backoff(attempts)` — reusa `exponentialBackoffDelayMs`, 5s base,
2×, cap 1h) e `hasExhaustedReferenceChecks(max)`. **Limite = 10 tentativas**
(≈ 5s+10s+…+2560s ≈ 85 min de janela) — justificado: cobre atrasos realistas de entrega
fora de ordem sem segurar a transação para sempre. Esgotado → `reject(REFERENCE_NOT_FOUND)` +
evento.

O caso de uso: `findPendingReference(now, batch)` → para **cada** candidato, um
`runner.run` próprio: re-`findById` (se não é mais `PENDING_REFERENCE`, outro worker já tratou →
`skipped`), `findByIdForUpdate` da wallet, `processor.process` (que detecta `isRetry` pelo
status `PENDING_REFERENCE` e faz `scheduleReferenceCheck` em vez de `markPendingReference`).

### Nota de teste — `allowGlobalContext`

Em produção o `@mikro-orm/nestjs` embrulha cada request num `RequestContext`, então `orm.em`
nos casos de uso resolve para um fork por request. Nos testes de integração, os casos de uso de
**consulta** (sem `runner.run`) rodariam no em global → o MikroORM barra. Solução no
`createTestOrm`: `allowGlobalContext: true` + `orm.em.clear()` no `beforeEach` (e no único teste
que altera o banco por fora, um `clear()` extra). Não afeta produção — `mikro-orm.config.ts`
não tem a flag.

**Bloco C:** 3 portas + 3 adapters, `WagerTransactionProcessor`, 7 casos de uso.
`PersistenceConflictError` + `persistOrConflict` nos 5 repos (unique violation → erro de
domínio). **114 testes unitários + 42 de integração**, `tsc`/`oxlint`/`migration:check`
limpos, `nest start` sobe sem erro de DI.

## Bloco D — Camada HTTP

### Tarefa 20 — controllers ligados aos casos de uso

- `WalletsController` e `WageringTransactionsController` deixam de ser stubs e recebem os casos
  de uso por injeção de construtor (classes concretas, sem token — são `@Injectable` no
  `AppModule`). DTOs já validados pelo `ValidationPipe` global viram comandos; os `*View` /
  resultados dos casos de uso são o corpo da resposta sem transformação extra.
- `POST /wallets` → 201 com `WalletView`. `POST /wallets/:id/reconciliation` → 200 (é consulta,
  não criação). `GET /wallets/:id/ledger` aceita `?cursor=` e `?limit=` (`ParseIntPipe optional`).
- Header opcional `X-Correlation-Id` propagado para os casos de uso em ambos os POST; ausente,
  o caso de uso gera um via `IdGenerator`.

### Tarefa 20.1 — `Idempotency-Key` obrigatório e status por desfecho

- `POST /wagering/transactions` lê o header `idempotency-key`; ausente ou vazio → `400`
  (`BadRequestException`, normalizado para `VALIDATION_FAILED` pelo filtro).
- O caso de uso **não lança** para rejeição de negócio (retorna `status`), então o controller
  fixa o status HTTP pelo desfecho via `@Res({ passthrough: true })`:
  `PROCESSED` → 200, `PENDING_REFERENCE` → 202, `REJECTED`/`FAILED` → 422. O corpo é sempre o
  `SubmitWagerTransactionResult` (`{ transactionId, status, balance, failureCode?, idempotentReplay }`).

### Tarefa 21 — `DomainExceptionFilter` (mapa exceção → HTTP)

Filtro global `@Catch()` (registrado como `APP_FILTER`), injeta `LOGGER`. Ordem de teste importa
porque `IdempotencyConflictError` estende `WagerRejectionError`:

| Exceção | Status | `code` no corpo |
| --- | --- | --- |
| `HttpException` 400 (ValidationPipe) | 400 | `VALIDATION_FAILED` (+ `details`) |
| `IdempotencyConflictError` | 409 | `IDEMPOTENCY_CONFLICT` |
| `WalletAlreadyExistsError`, `PersistenceConflictError` | 409 | `WALLET_ALREADY_EXISTS` / `PERSISTENCE_CONFLICT` |
| `WagerRejectionError` (demais) | 422 | o `code` + `failureCode` iguais |
| `WalletNotFoundError`, `WagerTransactionNotFoundError` | 404 | `WALLET_NOT_FOUND` / `WAGER_TRANSACTION_NOT_FOUND` |
| `InvalidLedgerCursorError`, `InvalidMoneyError` | 400 | `INVALID_LEDGER_CURSOR` / `INVALID_MONEY` |
| `LockWaitTimeoutException`, `DeadlockException`, `ConnectionException` (MikroORM) | 503 | `TRANSIENT_INFRASTRUCTURE_ERROR` |
| `WagerFailureError` / outros `DomainError` | 500 | o `code` (log de `error` com stack) |
| desconhecido | 500 | `INTERNAL_ERROR` (log com stack) |

- Corpo padronizado: `{ code, message, failureCode?, details? }`. `failureCode` só aparece em 422
  (rejeição de negócio) — os cinco casos que a seção 9 exige distinguir ficam em códigos HTTP
  distintos: 400 payload inválido, 409 conflito de idempotência, 422 rejeição de negócio,
  202 aceite pendente, 503 infra transitória.
- `RequestContext` do MikroORM validado num request HTTP real: `test/integration/http.spec.ts`
  sobe o `AppModule` inteiro com `supertest` contra o Postgres do Docker Compose — 12 casos
  cobrindo criar wallet, conflito, validação, BET, replay, conflito de idempotência,
  saldo insuficiente (422), refund pendente (202), consultas e 404. Os casos de uso de consulta
  agora rodam dentro do `RequestContext` que o `@mikro-orm/nestjs` injeta por request, sem
  precisar de `allowGlobalContext`.

**Bloco D:** 2 controllers reais, filtro de exceção com mapa completo, **114 unitários + 54 de
integração**, `tsc`/`oxlint` limpos.

## Bloco E — Mensageria

### Tarefa 22 — worker publicador do outbox

- **Fila de destino:** os eventos de integração (saída) vão para uma fila FIFO dedicada
  `integration-events.fifo` (+ `integration-events-dlq.fifo`, `maxReceiveCount 5`), **separada**
  da `wager-transactions.fifo` que é a fila de *entrada* (seção 10). Script
  `docker/localstack/init/01-create-queues.sh` refatorado numa função `create_fifo_with_dlq` e
  cria os dois pares. Novas envs: `SQS_INTEGRATION_EVENTS_QUEUE_URL` / `_DLQ_URL`,
  `OUTBOX_POLL_INTERVAL_MS` (default 1000).
- **Porta** `MessagePublisher` (`application/ports`, `OutboundMessage { id, type, body, groupId,
  deduplicationId }`) + adapter `SqsMessagePublisher` (`infrastructure/messaging`). `MessageGroupId
  = aggregateId` (ordenação por agregado), `MessageDeduplicationId = eventId` — publicação
  duplicada é absorvida pela dedup FIFO da SQS dentro da janela de 5 min, e o consumidor ainda
  deduplica pelo inbox de qualquer forma.
- **`OutboxPublisher.runOnce(batchSize = 10)`** (`application/workers`): um único `runner.run`
  → `outbox.findDue(now, batch)` (já usa `FOR UPDATE SKIP LOCKED`) → para cada mensagem:
  `publisher.publish` + `markPublished(now)` em caso de sucesso, `scheduleRetry(now)` (backoff
  exponencial, sem teto) em falha; `outbox.save` no fim. Retorna `{ claimed, published, retried }`.
- **Por que publicar dentro da transação que segura os locks:** se o processo morre no meio do
  lote, a transação inteira aborta, **todas** as linhas voltam a `pending` (mesmo as já enviadas
  à SQS) e são republicadas depois — cobre o cenário 2→5 da seção 11 (commit → morte antes de
  publicar → outra instância assume → publicação duplicada é segura). O custo é segurar os locks
  durante I/O externo; mitigado pelo `batchSize` pequeno (10) e pelo `SKIP LOCKED`, que deixa
  outros publishers pegarem linhas diferentes em paralelo.
- **Agendamento:** `OutboxPublisherScheduler` (`infrastructure/workers`,
  `OnApplicationBootstrap` / `OnModuleDestroy`) com `setInterval` (`unref`), guarda contra
  execuções sobrepostas (`running`), e no shutdown limpa o timer e espera o tick em andamento
  terminar. Sem `@nestjs/schedule` — um timer com lifecycle é suficiente e sem dependência nova.
  `OUTBOX_PUBLISHER_ENABLED=false` desliga (útil para rodar o publisher em processo separado —
  decisão da tarefa 24).
- `runner.run` (= `em.transactional`) funciona fora de um request HTTP: o `em.transactional`
  forka o EM e estabelece o contexto do callback, então os repos resolvem para o fork mesmo sem
  o `RequestContext` do `@mikro-orm/nestjs`. Validado no boot (`bun run start`: "outbox publisher
  started", sem erros de contexto) e em `test/integration/outbox-publisher.spec.ts` (4 casos:
  publica e marca, backoff em falha, dois publishers concorrentes sem perda/duplicata, mensagem
  já publicada não reenviada).

### Tarefa 23 — consumidor SQS + inbox persistente

- **Parser** `parseWagerTransactionMessage(rawBody)` (`application/messaging`): valida o envelope
  (`messageId`, `type = WagerTransactionRequested`, `data`) e os campos de negócio, monta um
  `SubmitWagerTransactionCommand` (`idempotencyKey` = campo do payload ou
  `{providerId}:{externalTransactionId}`; `correlationId` = idempotencyKey; `causationId` =
  messageId). Erro de forma → `MalformedMessageError` (permanente).
- **`InboundWagerTransactionHandler.handle(rawBody)`** (`application/messaging`): um único
  `runner.run` → checa `inbox.findByMessageId('wager-transactions-consumer', messageId)`;
  processado → `{ status: 'duplicate' }`; senão `submitUseCase.execute(command)` (o
  `em.transactional` aninhado vira **savepoint** na mesma transação — confirmado nos logs:
  `savepoint "trx1"` / `release savepoint "trx1"`), depois `InboxMessage.markProcessed` +
  `inbox.save` **no mesmo commit**. Atomicidade da seção 11 garantida: qualquer falha depois do
  savepoint desfaz tudo (transação + ledger + saldo + outbox + inbox).
- **`SqsWagerTransactionConsumer`** (`infrastructure/messaging`, `OnApplicationBootstrap` /
  `OnModuleDestroy`): loop de long-polling (`pollOnce()` extraído para teste). Classificação de
  erro no `consume(message)`:
  - sucesso (inclui rejeição de negócio, que o use case **retorna**, não lança) → `DeleteMessage` (ack);
  - `MalformedMessageError` ou `DomainError` (ex. `WalletNotFoundError`, `IdempotencyConflictError`)
    → permanente → `SendMessage` para a DLQ + `DeleteMessage` da fila principal;
  - qualquer outro erro (rede, banco, lock) → transitório → **não** deleta → a mensagem volta a
    ficar visível após o visibility timeout e é reentregue; após `maxReceiveCount = 5` a própria
    SQS faz o redrive para a DLQ.
- **`SIGTERM`:** `main.ts` chama `app.enableShutdownHooks()`. `onModuleDestroy` seta `stopping` e
  faz `await this.loop`; a mensagem em processamento termina (commit + delete) antes do loop sair;
  mensagens já recebidas no mesmo lote e ainda não iniciadas não são deletadas → voltam à
  visibilidade. Redelivery nunca duplica efeito (inbox + idempotency key).
- **Dedup/`payloadHash`:** `sha256Hex` extraído para `domain/support/sha256.ts` (reusado pelo
  `payload-hash.ts`). O inbox guarda o hash do corpo bruto da mensagem.
- Testes: `test/integration/sqs-consumer.spec.ts` (5 casos contra Postgres + LocalStack reais:
  BET aplicado uma vez, redelivery não reaplica, rejeição de negócio dá ack, malformada → DLQ,
  wallet inexistente → DLQ).

### Tarefa 24 — entrypoint de processo

- **Processo único** por padrão: a API HTTP, o publicador do outbox, o consumidor SQS e o worker
  de reprocessamento de referências rodam todos no mesmo `AppModule`. Cada worker é ligável por
  env, então dá para rodar N réplicas com papéis diferentes sem mudar código:
  `OUTBOX_PUBLISHER_ENABLED`, `SQS_CONSUMER_ENABLED`, `REFERENCE_REPROCESS_ENABLED`
  (`=false` desliga). As envs são lidas em `onApplicationBootstrap`, não no load do módulo
  (testável, e permite os testes de HTTP subirem o `AppModule` sem os workers concorrerem pelas
  filas).
- **`ReferenceReprocessScheduler`** (`infrastructure/workers`): mesmo padrão de timer com
  lifecycle do `OutboxPublisherScheduler`, chama `ReprocessPendingReferencesUseCase` a cada
  `REFERENCE_REPROCESS_INTERVAL_MS` (default 5s). O use case teve o `findPendingReference`
  inicial embrulhado num `runner.run` — fora de um request HTTP não há `RequestContext`, então
  toda leitura precisa abrir sua própria transação.

**Bloco E (22–24):** fila de saída dedicada, `OutboxPublisher` + scheduler, parser/handler/consumer
SQS com inbox atômico e classificação de erro, 4 workers no processo único ligáveis por env.
**114 unitários + 63 de integração**, `tsc`/`oxlint` limpos, boot sobe os 4 workers sem erro.

## Bloco F — Observabilidade + testes pesados

### Tarefa 26 — métricas

- **Lib:** `prom-client` (padrão de fato, histograma com buckets pronto, zero-config, roda no Bun).
- **Porta** `Metrics` (`application/ports/metrics.ts`) + adapter `PrometheusMetrics`
  (`infrastructure/observability`, `Registry` próprio por instância, método `collect()` para o
  endpoint da tarefa 27). Métricas expostas (cobrem o mínimo da seção 12):
  - `wager_transactions_settled_total{status,kind}` — transações por status
  - `wager_duplicates_detected_total{source}` — `source` = `idempotency-key` (replay no use case)
    ou `inbox` (dedup no consumidor SQS)
  - `wager_retries_scheduled_total{kind}` — `kind` = `outbox` ou `reference`
  - `wager_messages_dead_lettered_total{reason}` — mensagens para a DLQ
  - `wager_lock_conflicts_total` — `PersistenceConflictError` nos use cases +
    `LockWaitTimeout`/`Deadlock` do MikroORM no filtro
  - `wager_processing_latency_seconds{outcome}` — histograma medido em volta de
    `WagerTransactionProcessor.process` (`performance.now()`, não o `Clock` — latência é wall time
    real, não determinismo de domínio)
  - `wager_outbox_lag_seconds` — gauge, idade do evento não publicado mais antigo; setado a cada
    tick do `OutboxPublisher` via novo `IOutboxMessageRepository.oldestUnpublishedAt()`
- **DI:** `{ provide: METRICS, useExisting: PrometheusMetrics }` — a classe concreta também é
  provider, pro controller de métricas (tarefa 27) injetar e chamar `collect()`.
- Testes recebem um `noopMetrics` (em `wire-use-cases.ts`). Unit test do adapter valida o texto
  Prometheus e o isolamento por instância.

### Tarefa 27 — endpoint `/metrics` + divergência de reconciliação

- `MetricsController` (`GET /metrics`, sem guard, igual aos health) devolve `collect()` com
  `Content-Type: text/plain; version=0.0.4`.
- `ReconcileWalletUseCase` incrementa `wager_reconciliation_divergences_total` quando
  `!consistent`, junto do `logger.warn` que já existia — a seção 9 exige que divergência seja
  logada **e** contabilizada em métrica, além de sinalizada na resposta.

### Tarefa 28 — logs estruturados enriquecidos

- Porta `LogContextStore` (`application/ports/log-context.ts`) + adapter `AlsLogContextStore`
  (`AsyncLocalStorage`). `run(fields, work)` abre um escopo, `enrich(fields)` adiciona campos ao
  escopo corrente, `current()` lê. `LoggerAdapter` mescla `current()` em toda linha (o `context`
  explícito da chamada sobrescreve).
- Onde o escopo é aberto: `LogContextInterceptor` (`APP_INTERCEPTOR`) para HTTP —
  `correlationId` do header `X-Correlation-Id` ou gerado, ecoado na resposta, + `walletId`/
  `providerId` do corpo quando presentes; `SqsWagerTransactionConsumer.consume` por mensagem
  (`correlationId` gerado + `messageId` da SQS); os schedulers de outbox e de reprocessamento por
  tick (`correlationId` gerado).
- Onde é enriquecido: `InboundWagerTransactionHandler` após o parse (`messageId` do envelope,
  `correlationId`, `providerId`, `walletId`); `WagerTransactionProcessor.process`
  (`transactionId`, `walletId`, `providerId`). Assim toda linha logada dentro do processamento
  carrega os 5 campos da seção 12 sem passá-los à mão. Nenhum payload financeiro vai pro log.

### Tarefas 29–30 — testes de concorrência e ponta a ponta

- `test/concurrency/` (Postgres + LocalStack reais). Cada operação concorrente roda dentro de um
  `RequestContext.create(orm.em, work)` — é o mesmo mecanismo que o `@mikro-orm/nestjs` usa por
  request, e é o único jeito de o `em.transactional` interno e o proxy `orm.em` dos repositórios
  resolverem para o fork certo daquela operação (um `orm.em.fork()` cru não estabelece o
  `TransactionContext`, então o `SELECT ... FOR UPDATE` falha com "An open transaction is
  required"). Pool do ORM de teste subiu para `max: 40` para caber 50 transações simultâneas.
- **Bug corrigido no caminho:** `SubmitWagerTransactionUseCase` fazia o retry pós
  `PersistenceConflictError` (replay) **dentro da mesma transação já abortada** pelo unique
  violation — em Postgres toda query seguinte falha com "current transaction is aborted".
  Refatorado: `attempt()` roda a transação; se estourar `PersistenceConflictError`, o
  `executeWithRetry()` abre uma **transação nova** só para o replay. Só apareceu sob concorrência
  real (50 submissões idênticas).
  - `wager-concurrency.spec.ts`: 50 submissões idênticas em paralelo → 1 débito, 1 lançamento,
    49 replays; saldo 100 + duas apostas de 80 concorrentes → 1 PROCESSED + 1 REJECTED
    (`INSUFFICIENT_FUNDS`) + saldo 20 + 1 débito no ledger; rajada de 20 apostas concorrentes na
    mesma wallet → `reconcile` (com repos "reiniciados" = fork novo) ainda consistente; REFUND
    que chega junto do BET → segura em `PENDING_REFERENCE` e o worker de reprocessamento resolve.
  - `messaging-concurrency.spec.ts`: 15 mensagens / 3 wallets processadas por 3 consumidores
    competindo → cada uma uma vez, saldos exatos; handler commita e "morre" antes do ack →
    redelivery → segundo handler devolve `duplicate`, saldo intacto; 12 eventos no outbox / 2
    publishers concorrentes → 12 publicados, nenhum sobra, 12 na fila.
- `test/integration/e2e-flow.spec.ts`: sobe o `AppModule` inteiro (workers desligados por env),
  cobre `/health/live` + `/health/ready`, um ciclo completo por HTTP (create → BET → WIN →
  paginação do ledger por cursor → lookup por provider+external → reconciliação consistente com 3
  lançamentos) e `/metrics` refletindo trabalho processado.

**Bloco F (26–30):** `prom-client` com 8 métricas, endpoint `/metrics`, contexto de log via
`AsyncLocalStorage` com os 5 campos obrigatórios, testes de concorrência e e2e reais.

## Estrutura do projeto

- O código do desafio vive dentro desta pasta (`backend-challenge/`), que já é seu próprio
  repositório git.
- Estrutura em camadas: `domain → application → infrastructure → presentation`, inspirada em
  Clean Architecture / Ports & Adapters. A separação existe para isolar o domínio (Money,
  Wallet, WagerTransaction, etc.) de qualquer detalhe de framework, ORM ou transporte.

## ORM: MikroORM

- Escolhido em vez de TypeORM (também aceito pelo desafio) por três motivos:
  1. Segue o padrão **Data Mapper** (entidades de domínio não sabem que existe banco de dados),
     em vez de Active Record — alinhado com a exigência do README de que o domínio não dependa
     de tipos/decorators do ORM.
  2. `EntityManager.transactional()` dá uma API explícita de Unit of Work, essencial para
     garantir atomicidade entre wallet, ledger, inbox e outbox na mesma transação SQL.
  3. `LockMode` nativo (ex.: `LockMode.PESSIMISTIC_WRITE`) resolve a estratégia de concorrência
     escolhida (ver abaixo) sem precisar escrever SQL de lock manualmente.
- Não depende de módulos nativos/binários — roda sobre o driver `pg` (JS puro), o que evita
  fricção conhecida do TypeORM com o transpiler de decorators do Bun.

## Dependências principais instaladas

- HTTP/config: `@nestjs/config`, `@nestjs/terminus` (health checks).
- Validação: `class-validator`, `class-transformer`.
- Persistência: `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/nestjs`,
  `@mikro-orm/migrations` (runtime) e `@mikro-orm/cli` (dev, para gerar/rodar migrations).
- Dinheiro: `decimal.js`, usado internamente pelo VO `Money` (nunca exposto fora do domínio).
- Mensageria: `@aws-sdk/client-sqs`.

## Orquestração local: Docker Compose (Postgres + LocalStack)

- `postgres:16-alpine`, credenciais fixas de desenvolvimento local (`wagering`/`wagering`/`wagering`),
  porta `5432`, com healthcheck via `pg_isready`.
- `localstack:3` com `SERVICES=sqs`, porta `4566`, com healthcheck no endpoint de health do LocalStack.
- As duas filas do domínio (`wager-transactions.fifo` e `wager-transactions-dlq.fifo`) são criadas
  automaticamente na subida do container via hook de init do LocalStack
  (`docker/localstack/init/01-create-queues.sh`, montado em `/etc/localstack/init/ready.d`) — não é
  necessário rodar nenhum comando manual depois do `docker compose up`.
- A fila principal já nasce com `RedrivePolicy` apontando para a DLQ, `maxReceiveCount: 5`
  (mensagens que falham 5 vezes vão para a DLQ). Esse limite poderá ser revisto ao implementar a
  lógica de retry/backoff do consumidor (seção 10 do desafio).
- `ContentBasedDeduplication=false` em ambas as filas — a deduplicação é responsabilidade da
  aplicação (inbox persistente), não do broker, conforme restrição nº3 do desafio ("Não confiar
  apenas em SQS FIFO para garantir consistência").
- Credenciais/variáveis de ambiente de conexão (host, porta, usuário) para a aplicação serão
  formalizadas em `.env.example` na tarefa 13.

## Configuração do MikroORM

- `mikro-orm.config.ts` na raiz do projeto, lendo host/porta/credenciais via variáveis de
  ambiente (com defaults batendo com o `docker-compose.yml`).
- `entitiesTs` aponta para `src/infrastructure/database/entities/**/*.entity.ts` (execução via
  Bun, que interpreta TS nativamente); `entities` aponta para o equivalente em `dist/**/*.js`
  (build de produção).
- Migrations seguem o mesmo padrão dual (`migrations.path` para `dist`, `migrations.pathTs` para
  `src`), em `src/infrastructure/database/migrations`.
- **Armadilha descoberta:** `bun run <script>` que invoca o binário `mikro-orm` (via
  `node_modules/.bin`) executa o **Node do sistema**, não o Bun, porque o binário tem shebang
  `#!/usr/bin/env node` e o Bun respeita o shebang ao invés de interceptar. Isso quebra a
  resolução de `mikro-orm.config.ts`, porque o Node puro não sabe importar TypeScript.
  **Correção:** os scripts do `package.json` chamam `bun node_modules/@mikro-orm/cli/cli.js`
  diretamente, forçando o Bun a executar o arquivo (e seu carregador nativo de TS) em vez de
  deixar o shebang decidir o interpretador.
- Também foi necessário trocar a chave `useTsNode` (não reconhecida na v7 do CLI) por `preferTs`
  no bloco `"mikro-orm"` do `package.json` — é essa flag que faz o CLI considerar caminhos
  `.ts` na busca por arquivo de configuração.
- Validado com `mikro-orm debug`: configuração encontrada e **conexão com o Postgres real
  bem-sucedida**.
- **Migration inicial adiada:** o MikroORM CLI roda descoberta completa de metadados mesmo para
  `migration:create --blank`, e falha com `MetadataError: No entities were discovered` quando não
  há nenhuma entidade registrada. Por isso a primeira migration real só pode ser gerada na
  tarefa 6, quando as entidades de domínio existirem. O smoke test desta etapa ficou restrito a
  validar a resolução de config + conexão com o banco (via `mikro-orm debug`), não uma migration
  de fato.

## Camada de infraestrutura

### Armadilha de tooling: MikroORM v7 removeu decorators do `@mikro-orm/core`

- A versão instalada (`7.1.14`) não expõe mais `@Entity()`, `@PrimaryKey()`, `@Property()` etc. no
  pacote `core` — confirmado inspecionando os `.d.ts` publicados (nenhuma dessas funções é
  exportada por `index.d.ts`, `entity/index.d.ts` ou qualquer subpasta).
- A API atual e recomendada é `defineEntity()` + o property builder `p`, ambos exportados de
  `@mikro-orm/postgresql` (que re-exporta de `@mikro-orm/core`). Decorators ainda existem como
  opção documentada, mas não fazem parte da superfície pública desta versão do pacote instalado.
- Padrão adotado: cada entidade de persistência é definida com `defineEntity({...})`, gerando um
  `XxxSchema`; a classe exportada (`XxxOrmEntity`) estende `XxxSchema.class` e é registrada via
  `XxxSchema.setClass(XxxOrmEntity)`. Essas classes são **entidades de persistência**, distintas
  das classes de domínio (`Wallet`, `WagerTransaction`, etc.) — mapeamento entre as duas fica a
  cargo dos repositórios (Data Mapper), preservando a exigência de que o domínio não dependa de
  tipos do ORM.
- Chave primária composta (`InboxMessage`, por `consumerName` + `messageId`): funciona marcando
  `.primary()` em cada propriedade individualmente. A opção de nível de entidade `primaryKeys:
  [...]` existe no tipo, mas gerou erro de inferência de tipos genéricos ao ser testada — marcar
  cada coluna com `.primary()` foi o caminho que funcionou e compilou sem erros.

### Constraints de banco aplicadas via migration gerada

A primeira migration real (`migration:create --initial`), gerada a partir das entidades e
aplicada com sucesso contra o Postgres do `docker-compose.yml`, já materializa as garantias da
seção 5.9 do desafio diretamely no schema:

- `wallets`: unique `(player_id, currency)`; check `balance_amount >= 0`.
- `wager_transactions`: unique `idempotency_key`; unique `(provider_id, external_transaction_id)`;
  check dos valores válidos de `kind` e `status` (os enums viraram `CHECK ... IN (...)`, não
  tipos `ENUM` nativos do Postgres — comportamento padrão do MikroORM ao mapear enum TypeScript
  sem opção explícita de enum nativo).
- `wallet_ledger_entries`: unique `(wallet_id, transaction_id)` — no máximo um lançamento por
  transação por wallet.
- `inbox_messages`: chave primária composta `(consumer_name, message_id)`.
- `outbox_messages`: índice em `next_attempt_at`, usado pela query do worker publisher
  (`findDue`).

### Repositórios e adapters

- Implementações em `infrastructure/database/repositories/*` são stubs (`throw new Error('Not
  implemented')`) das interfaces de domínio — lógica real de mapeamento e persistência entra na
  fase de desenvolvimento.
- `infrastructure/messaging/sqs-client.provider.ts`: factory do `SQSClient` do AWS SDK, apontando
  para o LocalStack via `AWS_SQS_ENDPOINT`. Sem lógica de consumo/publicação ainda.
- `infrastructure/logger/structured-logger.service.ts`: implementação completa (não é stub) de um
  `LoggerService` do Nest emitindo JSON estruturado em `stdout` — é infraestrutura genérica e
  trivial, sem regra de negócio, então não há motivo para deixá-la como esqueleto.

## Camada de aplicação

- Criada apenas a pasta `application/use-cases/` (com `.gitkeep`) — sem casos de uso ainda.
  Os casos de uso (`SubmitWagerTransactionUseCase`, etc.) são lógica de negócio de orquestração
  e entram na fase de desenvolvimento, junto com `rehydrate`/`create` das entidades de domínio e
  a implementação real dos repositórios.

## Camada de apresentação

- Dois controllers cobrindo os endpoints da seção 9 (exceto health, que é a tarefa 10):
  `WalletsController` (`POST /wallets`, `GET /wallets/:walletId`,
  `GET /wallets/:walletId/ledger`, `POST /wallets/:walletId/reconciliation`) e
  `WageringTransactionsController` (`POST /wagering/transactions`,
  `GET /wagering/transactions/:transactionId`,
  `GET /providers/:providerId/wagering/transactions/:externalTransactionId`).
- Todos os métodos de controller lançam `Not implemented` e têm tipo de retorno `never` —
  idiomático em TS para uma função cujo único desfecho é lançar, sem precisar de corpo real
  ainda.
- DTOs com `class-validator`/`class-transformer` batendo com os contratos JSON do README:
  `MoneyDto` (compartilhado, valida escala fixa de 2 casas e moeda ISO-4217 de 3 letras via
  regex), `CreateWalletDto`, `SubmitWagerTransactionDto`.
- `SubmitWagerTransactionDto.kind` usa `@IsIn(...)` com a lista de kinds submissíveis excluindo
  `OPENING` — reforça a regra da seção 6.3 de que `OPENING` é interno e não pode ser submetido
  pela API.
- `NoOpAuthGuard`: sempre retorna `true`. É o ponto de extensão explícito de autenticação
  mencionado na seção 2 do README e já registrado em [[decisões]] anteriores deste documento.
- `DomainExceptionFilter`: filtro global stub (`@Catch()`), ainda sem o mapeamento de exceção →
  status HTTP — essa é uma decisão de negócio (seção 9: "a API precisa distinguir com clareza...
  payload inválido, conflito de idempotência, rejeição por regra de negócio, aceite com
  processamento pendente e falha transitória de infraestrutura") que fica pra fase de
  desenvolvimento, não pro boilerplate.
- O endpoint de reconciliação não tem DTO de request — o JSON da seção 9 é o formato de
  **resposta**; a única entrada é o `walletId` do path.

## Módulo único (AppModule)

- Removido o scaffold "Hello World" do Nest (`app.controller.ts`, `app.service.ts`,
  `app.controller.spec.ts`, `test/app.e2e-spec.ts`) — substituído pelos controllers reais da
  tarefa 8. `test/` ficou temporariamente vazio (`.gitkeep`); o scaffolding de testes de verdade é
  a tarefa 12.
- `AppModule` único (decisão da seção correspondente deste documento) registra:
  `ConfigModule.forRoot({ isGlobal: true })`, `MikroOrmModule.forRoot(mikroOrmConfig)`, os dois
  controllers, os 5 repositórios ligados aos seus tokens de domínio, o `StructuredLogger` e o
  `DomainExceptionFilter` como `APP_FILTER` global.
- Tokens de injeção dos repositórios (`WALLET_REPOSITORY`, etc.) ficam em
  `domain/repositories/tokens.ts` como `Symbol`s — o domínio define o token junto da porta que ele
  identifica, sem depender do NestJS (um `Symbol` é só um primitivo JS).
- `main.ts` ganhou `app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))`
  — necessário para os DTOs com `class-validator` da tarefa 8 realmente validarem as requisições.

### Armadilha de tooling: `mikro-orm.config.ts` precisou mover pra dentro de `src/`

- Com o arquivo na raiz do projeto (onde foi criado na tarefa 4), `nest start`/`nest build`
  falhava com `TS6059: File ... is not under 'rootDir' './src'` ao tentar importá-lo de dentro do
  `AppModule` — o `tsconfig.build.json` do Nest restringe a compilação a `src/`.
- **Correção:** mover o arquivo para `src/mikro-orm.config.ts` (que já era, inclusive, o primeiro
  caminho de busca padrão do próprio MikroORM CLI) e atualizar o `configPaths` do
  `package.json` e o import no `AppModule`. Os globs internos (`entitiesTs`, `migrations.pathTs`)
  continuaram funcionando sem alteração — são resolvidos relativos ao diretório de execução do
  processo, não ao diretório do arquivo de configuração.
- Validado com `mikro-orm debug` (configuração e conexão OK) e com a aplicação real: MikroORM
  descobriu as 5 entidades e todas as rotas dos controllers foram mapeadas corretamente no boot.

### Smoke test manual

Com Postgres e LocalStack rodando via Docker Compose, `bun run start` sobe a aplicação sem
erros de wiring. Testado `GET /wallets/:id` e `POST /wagering/transactions` (corpo inválido de
propósito): a requisição passa pelo guard, pelo `ValidationPipe` e chega ao controller, que lança
`Not implemented` — capturado pelo `DomainExceptionFilter`, que (por ser stub) também lança
`Not implemented`, resultando em 500 com stack trace. Esse é o comportamento esperado nesta fase:
prova que guard, pipe, DI do MikroORM e filtro global estão todos conectados corretamente: nenhum
erro de configuração ou DI, só os stubs intencionais se manifestando.

## Health checks

- `HealthController` (`GET /health/live`, `GET /health/ready`) usa `@nestjs/terminus` v12, cuja
  API atual é o `HealthIndicatorService` (builder `.check(key).up()/.down()`), não a antiga classe
  abstrata `HealthIndicator` de versões anteriores.
- `/health/live` não verifica nenhuma dependência — só confirma que o processo Nest está de pé.
- `/health/ready` roda dois indicators reais (não stub, por serem infra trivial sem regra de
  negócio, mesmo raciocínio já aplicado ao `StructuredLogger`):
  - `DatabaseHealthIndicator`: executa `select 1` via `EntityManager.getConnection()` do MikroORM.
  - `SqsHealthIndicator`: chama `ListQueuesCommand` no `SQSClient` do LocalStack.
- `SQS_CLIENT` virou provider do Nest (`{ provide: SQS_CLIENT, useFactory: createSqsClient }`) no
  `AppModule`, permitindo injeção via `@Inject(SQS_CLIENT)` — antes só existia como função factory
  solta.
- `HealthController` não tem `@UseGuards(NoOpAuthGuard)` — fica aberto por padrão, atendendo à
  seção 2 do desafio ("os endpoints de health ficam abertos").
- Validado contra Postgres e LocalStack reais (via `docker-compose.yml`): `/health/live` retorna
  `200 {"status":"ok",...}`; `/health/ready` retorna `200` com `database` e `sqs` ambos `"up"`.

## Validação ponta a ponta do boilerplate (do zero)

Simulado o fluxo completo que um dev novo teria ao clonar o repositório:

1. `docker compose down -v` + `docker compose up -d` — Postgres e LocalStack recriados do zero
   (volumes removidos antes), ambos `healthy`; filas SQS recriadas automaticamente pelo hook de
   init.
2. `rm -rf node_modules` + `bun install` — reinstalação completa (343 pacotes), sem erros.
3. `bun run migration:up` — migration inicial aplicada com sucesso contra o Postgres novo.
4. `bun run start:dev` — aplicação sobe em modo watch; `GET /health/live` e `GET /health/ready`
   retornam `200`, com `database` e `sqs` reportando `up`.
5. `tsc --noEmit` limpo (zero erros) e containers seguem `healthy` ao final.

Nenhum passo manual além dos comandos documentados foi necessário — o boilerplate é
reproduzível a partir de um clone limpo.

## Scaffolding de testes

- Testes unitários ficam em **`test/unit/`**, espelhando a árvore de `src/` (ex.
  `test/unit/domain/entities/money.spec.ts` testa `src/domain/entities/money.ts`), importando o
  código de produção por caminho relativo até `src/`. `src/` fica só com código de produção.
  (Até o Bloco E os specs ficavam colocados em `src/**/*.spec.ts`; migrados para `test/unit/`
  depois, sem mudança de conteúdo — só os imports relativos foram reescritos.)
  `tsconfig.build.json` já exclui `test` e `**/*spec.ts`, então o build de produção não os toca.
- `test/` na raiz é reservado para as duas categorias que exigem infraestrutura real — Postgres e
  LocalStack em containers, nunca mocks completos (restrição eliminatória do desafio, seção 14):
  - `test/integration/`
  - `test/concurrency/` (`.gitkeep`, vazio por enquanto — cenários de concorrência real exigem
    lógica de domínio funcionando, que ainda não existe)
- Scripts do `package.json` renomeados para bater com a taxonomia exata da seção 13 do desafio
  (Unidade / Integração / Concorrência), substituindo o `test:e2e` genérico do scaffold original
  do Nest: `test` (unidade, `test/unit/`), `test:integration`, `test:concurrency`.
- Smoke test real criado em `test/integration/database-connectivity.spec.ts`: inicializa o
  MikroORM com a config real do projeto e roda `select 1` contra o Postgres do
  `docker-compose.yml` — prova que a categoria "integração" já está funcionalmente conectada à
  infra real, não é só uma pasta vazia.
  - **Armadilha de API:** `orm.isConnected()` e `orm.checkConnection()` retornam falso/"Connection
    not established" logo após `MikroORM.init()`, porque a conexão é estabelecida de forma lazy
    (só no primeiro uso). O jeito confiável de verificar conectividade é rodar uma query real via
    `orm.em.getConnection().execute(...)` — a mesma abordagem já usada no `DatabaseHealthIndicator`
    da tarefa 10.

## Convenção: sem comentários no código

- Decisão: nenhum comentário no código-fonte, incluindo os que apareciam nos blocos de código
  originais do `CHALLENGE.md`. Nomes de classes, métodos e variáveis devem ser suficientes para
  comunicar intenção — alinhado com o princípio de "clean code" adotado para o projeto.
- Aplica-se a todas as camadas daqui em diante, não só ao domínio.

## Camada de domínio (esqueleto)

- Criadas as classes de `domain/entities` (`Money`, `Wallet`, `WagerTransaction`,
  `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`) exatamente com as assinaturas do README,
  método por método lançando `throw new Error('Not implemented')` — a lógica de negócio real
  entra na fase de desenvolvimento, não no boilerplate.
- `domain/enums`: `WagerTransactionKind`, `WagerTransactionStatus`, `LedgerDirection`.
  `FailureCode` ficou como `type FailureCode = string` — a taxonomia real (seção 7.2) ainda não
  foi definida.
- `domain/events`: `IntegrationEvent<T>` abstrata + `WalletBalanceChanged` como subclasse de
  exemplo, conforme seção 11.
- `domain/errors`: `DomainError` (base) e duas primeiras exceções concretas,
  `InvalidTransactionStateError` e `CurrencyMismatchError` — essas têm corpo real (não são
  stub), por serem estruturais/triviais (formatação de mensagem), não lógica de negócio.
- `domain/repositories`: interfaces (`IWalletRepository`, `IWagerTransactionRepository`,
  `IWalletLedgerEntryRepository`, `IInboxMessageRepository`, `IOutboxMessageRepository`) — são as
  "portas" que a infraestrutura vai implementar (tarefa 6).

### Decisão em aberto preenchida: assinatura de `Wallet.debit`/`Wallet.credit`

O README deixa essa assinatura como decisão do candidato ("Assinatura e retorno são decisão
sua"). Decidido: `debit(money: Money, transactionId: string): WalletLedgerEntry` e
`credit(money: Money, transactionId: string): WalletLedgerEntry` — cada chamada já retorna o
lançamento de ledger correspondente, reforçando a invariante "toda alteração de saldo tem um
lançamento correspondente" no próprio tipo de retorno do método.

### Tarefa 4 — `Wallet` (implementado) — revisa a assinatura de `debit`/`credit`

A decisão anterior (`debit(money, transactionId): WalletLedgerEntry`) foi **revista**: a
aritmética do lançamento precisa de `id` e `createdAt` do próprio lançamento, e a factory
`WalletLedgerEntry.create` exige ambos. Assinatura final:

```
debit(money: Money, ctx: WalletMovementContext): WalletLedgerEntry
credit(money: Money, ctx: WalletMovementContext): WalletLedgerEntry
// WalletMovementContext = { transactionId, ledgerEntryId, occurredAt }
```

O aggregate não gera ids nem lê o relógio — o caso de uso injeta tudo por `ctx`, mantendo o
domínio determinístico e testável.

- **`open`** retorna `{ wallet, openingEntry: WalletLedgerEntry | null }`. A wallet nasce já
  com `initialBalance` e `version = 1`; se o saldo inicial for positivo, `openingEntry` é o
  lançamento `CREDIT` de `0 → initialBalance`. **`version` continua `1`** mesmo com abertura
  com saldo — bate com o exemplo de resposta da seção 9 (`POST /wallets` com `1000.00` →
  `version: 1`). Interpretação adotada: a abertura é gênese da wallet, não uma "alteração de
  saldo" no sentido do versionamento; movimentações posteriores (`debit`/`credit`) é que
  incrementam.
- **`debit`** rejeita overdraft com `InsufficientFundsError` (código default para `BET`). Para
  `ROLLBACK`/`REFUND` que estouraria o saldo, o caso de uso chama `wallet.canDebit(money)`
  **antes** e lança `ReversalWouldOverdrawError` — assim o aggregate mantém a invariante
  "saldo nunca negativo" sem precisar saber o `kind` da operação, e o código de falha
  distinto (seção 7.9) fica na camada que conhece o contexto.
- `debit`/`credit` sempre incrementam `version` (movem saldo por definição — valor positivo
  obrigatório, senão `InvalidLedgerEntryError`). Moeda divergente → `CurrencyMismatchError`.
- `rehydrate` reconstrói sem validar (regra 6.0).

9 testes em `src/domain/entities/wallet.spec.ts` (versão, entrada de abertura balanceada,
overdraft, débito exato até zero, conflito de moeda, sequência de movimentos, reidratação).

### Tarefa 5 — `WagerTransaction` (implementado)

Máquina de estados como tabela `TRANSITIONS: Record<Status, readonly Status[]>` dentro da
classe (decisão já registrada em "Máquina de estados de `WagerTransaction`"). `transitionTo`
consulta a tabela e lança `InvalidTransactionStateError(atual, tentado)` em transição
inválida. `isTerminal()` = `TRANSITIONS[status].length === 0` (uma única fonte da verdade).

Transições válidas:

- `PENDING` → `PROCESSED` | `PENDING_REFERENCE` | `REJECTED` | `FAILED`
- `PENDING_REFERENCE` → `PROCESSED` | `REJECTED` | `FAILED`
- `PROCESSED` / `REJECTED` / `FAILED` → ∅ (terminais)

Decisão: **`PENDING_REFERENCE` → `PENDING_REFERENCE` não é permitido**. O worker de
reprocessamento não "re-marca" uma pendência ainda irresolvível — só age quando resolve
(`markProcessed`) ou quando esgota o limite/TTL (`reject(REFERENCE_NOT_FOUND)`); enquanto isso
a linha é deixada intacta.

- `create` nasce `PENDING` e valida **só** a exigência de referência por kind
  (`REFUND`/`ROLLBACK` sem `referenceExternalTransactionId` → `ReferenceResolutionError.required()`).
  As demais validações de referência (contexto, kind da referência, valor, já-revertida)
  dependem de I/O e ficam no caso de uso, não na factory.
- `affectsBalance()` é puramente por kind: `kind !== LOSS` (inclui `OPENING`). Status não
  entra — uma transação `REJECTED` "não afeta saldo" por status, o que é problema do caso de
  uso, não desta consulta.
- `ledgerDirectionFor(reference?)`: `BET`→`DEBIT`; `WIN`/`REFUND`/`OPENING`→`CREDIT`;
  `ROLLBACK`→inverso da direção da referência (exige `reference`, senão
  `InvalidLedgerEntryError`); `LOSS`→`InvalidLedgerEntryError` (não produz movimento — o
  caso de uso checa `affectsBalance()` antes).
- `markProcessed(referenceTransactionId?, at)` grava o **id interno** da referência resolvida
  e `processedAt`. `reject`/`fail` gravam `failureCode` (sem timestamp — auditoria via
  `createdAt` + `occurredAt` do evento de outbox).
- `rehydrate` não revalida (regra 6.0) — reconstrói inclusive estados terminais.

15 testes em `src/domain/entities/wager-transaction.spec.ts`.

### Tarefa 6 — eventos de integração (implementado)

- `IntegrationEvent.toJSON()` retorna `IntegrationEventEnvelope<T>` (tipo nomeado, reusado pela
  outbox): `eventId`, `eventType`, `aggregateId`, `correlationId`, `causationId?`,
  `occurredAt` (ISO-8601 via `toISOString()`), `version`, `data`. `causationId` fica no objeto
  como `undefined` quando ausente e é **omitido na serialização** por `JSON.stringify` — sem
  ramo condicional.
- `EventContext` movido de `wallet-balance-changed.event.ts` para `events/event-context.ts` e
  **expandido**: `{ eventId, correlationId, causationId?, occurredAt }`. O caso de uso gera
  `eventId` (uuid) e fixa um único `occurredAt` para todos os eventos emitidos na mesma
  transação — mantém o domínio determinístico (nada de `randomUUID()`/`new Date()` dentro das
  factories de evento).
- 4 subclasses concretas, uma por arquivo, `eventType` + `version` **no tipo** (não string no
  call site): `WalletBalanceChanged.from(wallet, entry, ctx)`,
  `WagerTransactionProcessed.from(tx, ctx)` (com `affectedBalance`),
  `WagerTransactionRejected.from(tx, failureCode, ctx)`,
  `WagerTransactionPendingReference.from(tx, ctx)`.
- `data` de todo evento carrega `MoneyProps` (string decimal via `Money.toJSON()`), nunca a
  instância `Money` — payload JSON estável e versionável (seção 11).

10 testes em `src/domain/events/integration-event.spec.ts`.

### Tarefa 7 — `InboxMessage` / `OutboxMessage` (implementado)

**Backoff** extraído para `src/domain/support/exponential-backoff.ts` (função pura,
reutilizável pelo worker de `PENDING_REFERENCE` depois): `delay = min(base·factor^(n-1), max)`,
default `base = 5s`, `factor = 2`, `max = 1h`. Determinístico (sem jitter) — os workers da
outbox usam `SELECT … FOR UPDATE SKIP LOCKED`, então thundering herd não é problema; jitter
fica como melhoria possível.

**`InboxMessage`** — só dedup + marcador de processamento. `receive` cria não-processada;
`markProcessed(at)` grava o timestamp e lança `InvalidMessageStateError` se já processada
(erro de programação — o PK `(consumer_name, message_id)` + transação impedem
reprocessamento). Sem campos de retry: redelivery/backoff do consumidor é responsabilidade do
SQS (visibility timeout) e da DLQ (`maxReceiveCount = 5`, já configurado na fila).

**`OutboxMessage`**:
- `enqueue(event)` usa **`event.eventId` como `id` da linha** → reenfileirar o mesmo evento
  colide no PK, dedup natural na produção. `payload` = envelope serializado via
  `JSON.parse(JSON.stringify(event.toJSON()))` — objeto plano, sem `undefined`, canônico.
  `nextAttemptAt` nasce = `occurredAt` (due imediatamente).
- `isDue(now)` = pendente **e** (`nextAttemptAt` indefinido ou `<= now`). O worker consulta
  `WHERE published_at IS NULL AND next_attempt_at <= now`.
- `scheduleRetry(now)` incrementa `attempts` e empurra `nextAttemptAt` pelo backoff.
  `markPublished`/`scheduleRetry` lançam `InvalidMessageStateError` se já publicada.
- **Sem teto de tentativas** na outbox — um evento já commitado **não pode ser descartado**
  (invariante "não perder eventos confirmados"); retenta para sempre com backoff capado em 1h.
  DLQ é conceito do lado do consumidor (inbox), não da outbox.

`InvalidMessageStateError` (`INVALID_MESSAGE_STATE`) — um erro compartilhado pelos dois guards.

22 testes (`inbox-message.spec.ts`, `outbox-message.spec.ts`, `exponential-backoff.spec.ts`).

### Tarefa 8 — `payloadHash` (implementado) — fecha o Bloco A

`src/domain/support/canonical-json.ts` — `canonicalJsonStringify(value)`:

1. ordena as chaves de todo objeto lexicograficamente, **recursivamente**;
2. descarta `undefined` (não é JSON válido); mantém `null`;
3. preserva a ordem de arrays;
4. `JSON.stringify` sem espaços.

`src/domain/support/payload-hash.ts` — `hashWagerTransactionPayload(payload)`:

- monta um objeto **explícito** só com os campos de negócio: `providerId`,
  `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`,
  `referenceExternalTransactionId?`. Como os campos são listados um a um, qualquer campo extra
  na entrada (`idempotencyKey`, `messageId`, `occurredAt`, envelope de transporte) **não
  entra** no hash — atende a seção 9 ("o header e metadados de transporte não entram no hash");
- `money` é normalizado por `Money.from(...).toJSON()` → `"25.0"` e `"25.00"` produzem o mesmo
  hash (escala fixa 2);
- `sha256(canonicalJsonStringify(normalized))` em hex (64 chars), via `node:crypto`
  (`createHash`) — primitivo de plataforma, não framework, então o domínio continua limpo.

Uso: o caso de uso calcula o `payloadHash` na entrada (HTTP e SQS), grava na
`wager_transactions`; replay = mesma `idempotencyKey` **e** mesmo `payloadHash`; mesma key com
hash diferente = `IDEMPOTENCY_CONFLICT` (seção 9, `matchesPayload` na `WagerTransaction`).

11 testes (`canonical-json.spec.ts`, `payload-hash.spec.ts`).

---

## Bloco A concluído — resumo

Domínio puro completo e testável sem infraestrutura: **100 testes unitários**, `tsc --noEmit`
e `oxlint` limpos. `Money`, `Wallet`, `WalletLedgerEntry`, `WagerTransaction` (state machine),
os 4 eventos de integração, `InboxMessage`/`OutboxMessage` (backoff), taxonomia de
`FailureCode` + hierarquia de erros, e os utilitários `exponential-backoff` / `canonical-json`
/ `payload-hash`. Nenhuma dependência de NestJS, MikroORM ou AWS SDK na camada `domain/`.

### Armadilha de tooling: `decimal.js` + `"type": "module"` + `moduleResolution: nodenext`

- Com `"type": "module"` no `package.json` (necessário para o projeto), `import Decimal from
  'decimal.js'` (default import) quebra a checagem de tipos com
  `TS2709: Cannot use namespace 'Decimal' as a type`. Causa: a declaração de tipos do
  `decimal.js` mescla classe + função + namespace sob o nome `Decimal`, e a interop de
  default-import de um pacote CJS sob resolução `nodenext`/ESM não preserva essa mescla
  corretamente.
- **Correção:** usar import nomeado — `import { Decimal } from 'decimal.js'` — que referencia a
  declaração mesclada diretamente, sem passar pelo caminho de interop do default export.

## Estratégia de concorrência: pessimistic locking

- A unidade de concorrência é a `walletId`. Ao processar uma transação, a wallet é lida com
  `SELECT ... FOR UPDATE` (via `LockMode.PESSIMISTIC_WRITE` do MikroORM).
- Motivo: alta contenção esperada no cenário obrigatório do desafio (duas apostas disputando o
  mesmo saldo simultaneamente). Pessimistic locking evita a necessidade de lógica de retry manual
  que o optimistic locking exigiria, reduzindo superfície de erro.
- O lock é por linha (`walletId`), nunca global — wallets diferentes continuam sendo processadas
  em paralelo sem bloqueio cruzado.
- Trade-off aceito: operações concorrentes na **mesma** wallet são serializadas (uma espera a
  outra). Aceitável porque é exatamente essa a unidade de concorrência definida pelo domínio.

## Máquina de estados de `WagerTransaction`

- Implementada como uma tabela de transições (`Record<Status, Status[]>`) encapsulada dentro da
  própria classe `WagerTransaction`, validada em cada método de transição
  (`markProcessed`, `reject`, `fail`, `markPendingReference`).
- Decisão deliberada de não criar uma abstração genérica de state machine reutilizável — o
  domínio tem 5 estados e regras simples; uma classe genérica seria over-engineering.

## Autenticação: não implementada (ponto de extensão)

- Conforme seção 2 do README, autenticação não vale pontos na avaliação e não deve competir com
  correção financeira, concorrência e idempotência.
- Decisão: não implementar autenticação real neste desafio. Um `AuthGuard` no-op é deixado como
  ponto de extensão explícito, documentado aqui e no `ARCHITECTURE.md` final.
- Caso fosse implementado, a expectativa seria integrar um Identity Provider externo
  (Keycloak ou Zitadel), nunca uma tabela própria de usuários com hash de senha.

## Estrutura de módulos NestJS: módulo único

- Decisão: um único `AppModule`, sem quebrar em módulos por bounded context
  (`WalletModule`, `WageringModule`, etc.).
- Motivo: `Wallet` e `WagerTransaction` não são bounded contexts diferentes — são o mesmo
  contexto (o ledger financeiro). Toda operação de wagering sempre mexe na wallet, então separar
  em módulos Nest distintos geraria import cruzado entre eles sem ganho real de isolamento.
- A separação de responsabilidades já é garantida pela estrutura em camadas
  (`domain/application/infrastructure/presentation`), que é independente da granularidade de
  módulos do Nest.
- A quantidade de módulos Nest não é um critério avaliado pelo desafio — é uma decisão de
  organização de código, não de arquitetura de domínio.
- Não descartado por completo: se a camada de mensageria (outbox worker) precisar rodar como um
  entrypoint de processo separado, ela pode ganhar seu próprio módulo — a ser avaliado quando
  chegarmos nessa etapa.

## Fase de desenvolvimento

### Tarefa 1 — `Money` (implementado)

- Valor interno é `Decimal` (`decimal.js`), nunca exposto fora do VO. Escala fixa de 2 casas
  (`SCALE = 2`), aplicada em toda operação via `toDecimalPlaces(2)`.
- `Money.from` valida a string de entrada com regex `^-?\d+(\.\d+)?$` **antes** de passar ao
  `Decimal` — é o regex que barra `NaN`, `Infinity`, notação científica (`1e5`), sinal de `+`
  à esquerda, ponto sem dígitos (`25.`), espaços e string vazia. Depois: rejeita mais de 2 casas
  decimais e (em contratos de entrada) valores negativos. Moeda validada com `^[A-Z]{3}$`.
- Entradas com menos de 2 casas (`"25"`, `"25.5"`) são **aceitas e normalizadas** para escala 2 —
  a lista de rejeições do desafio (seção 6.1) não inclui "menos de 2 casas"; a serialização
  (`toString`/`toJSON`) é sempre `toFixed(2)`.
- Toda falha de validação lança `InvalidMoneyError` (novo `DomainError`, code `INVALID_MONEY`).
  Conflito de moeda em `add`/`subtract`/`isLessThan` lança `CurrencyMismatchError` (já existia).
- `equals` compara moeda **e** valor sem lançar em moeda diferente (é um predicado, não uma
  operação aritmética) — retorna `false`.
- `negate()` pode produzir `Money` negativo: é uso interno (direção de ledger / `ROLLBACK`),
  não passa pela validação de contrato de entrada de `from`.
- 27 testes unitários em `src/domain/entities/money.spec.ts` (escala, normalização, entradas
  inválidas, drift de ponto flutuante `0.10 + 0.20 == 0.30`, imutabilidade, predicados,
  conflito de moeda, round-trip `toJSON`). `bun test`, `tsc --noEmit` e `oxlint` limpos.

### Tarefa 2 — taxonomia de `FailureCode` + erros de domínio (implementado)

`src/domain/enums/failure-code.ts` (renomeado de `failure-code.type.ts`): objeto `const` +
tipo união derivado (`(typeof FailureCode)[keyof typeof FailureCode]`) em vez de `enum` TS —
evita reverse-mapping e mantém o valor persistido como string simples na coluna
`wager_transactions.failure_code`. Helper `isFailureCode(string)` para validar valores vindos
do banco na reidratação.

Taxonomia (12 códigos), todos estáveis e legíveis por máquina (seção 7.2):

| code | quando | ação típica do provedor |
|---|---|---|
| `INSUFFICIENT_FUNDS` | `BET` sem saldo | não reenviar — saldo do jogador insuficiente |
| `REVERSAL_WOULD_OVERDRAW` | `REFUND`/`ROLLBACK` deixaria saldo negativo (seção 7.9 — distinto de `INSUFFICIENT_FUNDS`) | investigar — estado inconsistente |
| `CURRENCY_MISMATCH` | moeda da operação ≠ moeda da wallet | corrigir payload |
| `IDEMPOTENCY_CONFLICT` | mesma `Idempotency-Key`, `payloadHash` diferente | corrigir payload ou a key |
| `REFERENCE_REQUIRED` | `REFUND`/`ROLLBACK` sem `referenceExternalTransactionId` | corrigir payload |
| `REFERENCE_NOT_FOUND` | referência não chegou dentro do TTL/limite de tentativas (seção 7.1) | reenviar a transação referenciada primeiro |
| `REFERENCE_NOT_PROCESSED` | referência existe mas não está `PROCESSED` | aguardar / reenviar referência |
| `REFERENCE_KIND_NOT_ALLOWED` | `REFUND`→não-`BET`, ou `ROLLBACK`→kind fora de {BET,WIN,REFUND} (regra 3) | corrigir payload |
| `REFERENCE_CONTEXT_MISMATCH` | referência é de outro provider/player/wallet/currency/round (regra 2) | corrigir payload |
| `REFERENCE_ALREADY_REVERSED` | referência já revertida pelo mesmo tipo de operação (regra 4) | não reenviar — já processado |
| `AMOUNT_MISMATCH` | valor de `REFUND`/`ROLLBACK` ≠ valor da referência (regra 5, parcial fora de escopo) | corrigir payload |
| `PERMANENT_INFRASTRUCTURE_ERROR` | erro permanente de infra ao aplicar (status `FAILED`, auditável) | acionar suporte |

Hierarquia de erros:

- `DomainError` (base, já existia) — erro de domínio genérico, tem `code: string`.
- `WagerRejectionError extends DomainError` — marcador para **violação de regra de negócio**;
  `code` estreitado para `FailureCode`. O caso de uso faz `catch (e) { if (e instanceof
  WagerRejectionError) tx.reject(e.code) }` → status `REJECTED` → HTTP 422.
  Concretos: `CurrencyMismatchError` (rebaseado), `InsufficientFundsError`,
  `ReversalWouldOverdrawError`, `IdempotencyConflictError`, `ReferenceResolutionError`
  (uma classe com factories estáticas `required()/notFound()/notProcessed()/kindNotAllowed()/
  contextMismatch()/alreadyReversed()/amountMismatch()` — a família de resolução de referência
  compartilha comportamento, só muda o code e a mensagem).
- `WagerFailureError extends DomainError` — marcador para **erro permanente de infraestrutura**;
  → `tx.fail(code)` → status `FAILED`. Concreto: `PermanentInfrastructureError`.
- `InvalidMoneyError` e `InvalidTransactionStateError` **não** são rejeições — o primeiro é
  payload inválido (HTTP 400), o segundo é erro de programação (transição a partir de estado
  terminal); ambos seguem `DomainError` puro.

23 testes em `src/domain/errors/wager-rejection.error.spec.ts`. `bun test`/`tsc`/`oxlint` limpos.

### Tarefa 3 — `WalletLedgerEntry` (implementado)

Lançamento imutável: só `readonly`, sem métodos de transição (imutabilidade estrutural,
seção 6.4).

- `create` valida: (1) `money` estritamente positivo — a direção carrega o sinal, o valor é
  sempre magnitude absoluta; operações sem efeito no saldo não geram lançamento, então valor
  zero é inválido; (2) `isBalanced()` — `balanceBefore − money === balanceAfter` para `DEBIT`,
  `+` para `CREDIT`. Qualquer falha → `InvalidLedgerEntryError` (`DomainError`,
  `INVALID_LEDGER_ENTRY`) — é violação de invariante / erro de programação, não rejeição de
  negócio.
- `isBalanced()` é um predicado puro que **não lança**: se as três moedas (`money`,
  `balanceBefore`, `balanceAfter`) não baterem, retorna `false` (e `create` converte isso em
  `InvalidLedgerEntryError`), em vez de deixar vazar `CurrencyMismatchError` do `Money`.
- `rehydrate` **não** revalida (regra 6.0) — reconstrói via `Money.from` de cada `MoneyProps`.
  Teste cobre reidratar um estado aritmeticamente "quebrado" para provar que a factory de
  reidratação não rejeita.
- Sem checagem de não-negatividade de `balanceAfter` aqui: é invariante da `Wallet`
  (`REVERSAL_WOULD_OVERDRAW` / `INSUFFICIENT_FUNDS` são rejeitados antes de gerar lançamento).

6 testes em `src/domain/entities/wallet-ledger-entry.spec.ts`.

## Runtime: Bun

- Exigência obrigatória do desafio (seção 4). MikroORM e o driver `pg` são compatíveis sem
  necessidade de shims, por não dependerem de APIs nativas do Node nem de módulos binários.
- Versão instalada e usada no projeto: **Bun 1.4.0** (instalada via `curl -fsSL https://bun.sh/install | bash`).
- Test runner: `bun test` (nativo do Bun), substituindo o Vitest gerado por padrão pelo
  `@nestjs/cli` 12 — necessário para atender a exigência de que Bun seja também o test runner.

## Revisão pós-entrega — Bloco A: garantias no schema (restrição 9)

Uma revisão crítica final apontou que duas garantias da seção 6 estavam aplicadas **só em
código de aplicação**, enquanto a restrição inviolável nº9 exige que unicidade, imutabilidade e
não-negatividade sejam aplicadas **no schema do banco**. Não-negatividade
(`check (balance_amount >= 0)`) e as uniques de identidade já estavam no schema; faltavam:

### Imutabilidade do ledger no schema

`Migration20260902135118` adiciona a função `forbid_wallet_ledger_entry_mutation()` e dois
triggers `BEFORE UPDATE` / `BEFORE DELETE` em `wallet_ledger_entries` que sempre lançam
(`restrict_violation`). Antes, o append-only só era garantido por o repositório não ter caminho
de `UPDATE`/`DELETE`. Agora qualquer tentativa — inclusive SQL cru fora da aplicação — falha no
banco. `TRUNCATE ... CASCADE` (usado no teardown dos testes) não dispara triggers de linha,
então a limpeza dos testes continua funcionando.

### Reversão única por tipo no schema (regra 7.4)

A regra "uma referência não pode ser revertida duas vezes pelo mesmo tipo de operação" era
garantida só pelo lock pessimista da wallet + a checagem `findProcessedReversal` no
`WagerTransactionProcessor`. Adicionada a unique `(reference_transaction_id, kind)` em
`wager_transactions`. Como `reference_transaction_id` só é preenchido em transações
`REFUND`/`ROLLBACK` **`PROCESSED`** (o `markProcessed` grava; `reject`/`markPendingReference`
não), e o Postgres trata `NULL` como distinto em índice único, a constraint não afeta `BET`,
`WIN`, `LOSS`, `OPENING` nem transações rejeitadas — atinge exatamente o caso da regra 7.4.
`REFUND` e `ROLLBACK` da mesma referência coexistem (kinds diferentes na chave).

`WagerTransactionRepository.save` traduz a violação dessa unique
(`PersistenceConflictError` com `constraint === 'wager_transactions_reference_transaction_id_kind_unique'`)
em `ReferenceResolutionError.alreadyReversed()` → HTTP 422 / `failureCode`
`REFERENCE_ALREADY_REVERSED`, igual ao caminho de checagem em código. Esse caminho é
defesa em profundidade: sob o lock da wallet a segunda reversão é serializada e barrada em
código antes de chegar ao banco; a constraint cobre o cenário de o lock ser removido ou falhar.

### MikroORM x triggers

MikroORM 7 introspecta triggers/rotinas e o diff do schema tentaria dropar os triggers
hand-written (não espelhados em `defineEntity`). Resolvido com
`schemaGenerator: { ignoreTriggers: true, ignoreRoutines: true }` no `mikro-orm.config.ts` —
triggers declarados continuam sendo criados, os existentes nunca são dropados pelo diff.
`migration:check` fica limpo. A unique `(referenceTransactionId, kind)` foi declarada no
`WagerTransactionSchema` (`uniques`), então essa parte é gerenciada normalmente pelo diff.

### Validação

`migration:up` → `migration:check` limpo → `down`×3 (teardown total) → `up`×3 → `migration:check`
limpo, contra o Postgres do `docker-compose.yml`. Triggers e constraint confirmados via `psql`.
`test/integration/schema-constraints.spec.ts` (6 casos): `UPDATE`/`DELETE` cru no ledger lança
`/append-only/` e não remove a linha; segunda reversão `PROCESSED` do mesmo `(reference, kind)`
→ `ReferenceResolutionError` com `code = REFERENCE_ALREADY_REVERSED`; kinds diferentes
coexistem; `BET` com `reference` nulo não é constrangido.

**Suítes após o Bloco A:** 116 unitários, 72 de integração (+6), 7 de concorrência — todos verdes.
`tsc --noEmit` e `oxlint` limpos.

## Revisão pós-entrega — Bloco B: concorrência multi-processo e restart

A seção 13 (testes obrigatórios) pede "≥ 3 processos/instâncias simultâneos" e "reinício do
serviço com comprovação da consistência final". A suíte tinha paralelismo real contra Postgres,
mas dentro de **um** processo (objetos compartilhando um pool). Adicionados testes com processos
de SO de verdade.

### Harness — `test/concurrency/harness/instance.ts`

Um entrypoint `bun` iniciado via `Bun.spawn`. Dois modos por env:

- `INSTANCE_MODE=submit` — inicializa o MikroORM com a config real (`debug: false` para não
  poluir o stdout), monta os casos de uso via `wireUseCases`, espera até `startAtEpochMs`
  (alinhamento de largada entre processos) e submete a lista de transações do `INSTANCE_JOB`,
  emitindo uma linha JSON por resultado. Sem `allowGlobalContext`: cada submit roda em
  `RequestContext.create`, igual a um request HTTP.
- `INSTANCE_MODE=consume` — sobe uma instância real da aplicação com
  `NestFactory.createApplicationContext(AppModule)` (sem HTTP; os workers ligam no
  `onApplicationBootstrap`). Fila e workers configuráveis por env passada ao processo filho.

### `multi-process.spec.ts` (3 processos, 1 Postgres)

- **Saldo contestado** — carteira `100.00`, três processos apostando `80.00` ao mesmo tempo →
  exatamente 1 `PROCESSED`, 2 `REJECTED`/`INSUFFICIENT_FUNDS`, saldo `20.00`, 1 débito no ledger,
  `reconcile` consistente. O `SELECT ... FOR UPDATE` serializa entre processos, não só entre
  fibras.
- **`Idempotency-Key` compartilhada** — 3 processos submetem a mesma key 10× cada (30 no total)
  → 1 aplicação real, 29 replays, 1 débito, saldo `975.00`. A idempotência é do banco, então
  atravessa a fronteira de processo.
- **Carteiras distintas em paralelo** — 3 processos, 1 carteira cada, sem contenção cruzada.

### `restart-recovery.spec.ts` (SIGKILL no meio do trabalho)

Fila FIFO dedicada criada no teste com `VisibilityTimeout=2` (redelivery rápido). Instância A
(consumidor + outbox, `SQS_CONSUMER_BATCH_SIZE=1`) processa mensagens; ao ver ≥1 `PROCESSED`,
o teste manda `SIGKILL` (sem `onModuleDestroy`, sem drain). Instância B assume. Invariante final
verificada: cada mensagem termina `PROCESSED` **uma vez** (o inbox persistido sobrevive ao
restart e a mensagem em voo no momento do kill é reentregue e deduplicada), `M` débitos no
ledger, saldo `stored == inicial − Σ`, `reconcile.consistent`, `M` linhas de inbox, e o outbox
drena para zero pendentes (a instância B republica o que a transação abortada de A reverteu).

`NODE_ENV=production` nos filhos: silencia o SQL debug do MikroORM e reflete um deploy real.

### Contagens `PROCESSED` nos asserts

`wager_transactions` `PROCESSED` inclui a transação `OPENING` da criação da carteira — os polls
filtram por `kind = 'BET'` para contar só o trabalho da fila.

**Suítes após o Bloco B:** 116 unitários, 72 de integração, **11 de concorrência** (+4:
3 multi-processo, 1 restart) — todos verdes. `tsc`/`oxlint` limpos.

## Revisão pós-entrega — Bloco C: saldo observado no replay (seção 7.7)

A seção 7.7 exige que repetir uma operação já processada devolva "o resultado original,
incluindo o saldo observado naquele momento". A implementação só acertava isso quando a
transação tinha lançamento no ledger (`balanceAfter`). Para `LOSS` (que é `PROCESSED` e **não**
move saldo), `REJECTED` e `PENDING_REFERENCE`, o replay caía num fallback que lia o **saldo
atual** da carteira — que pode ter mudado entre o processamento e o replay.

### Coluna `result_balance_amount`

`Migration20260902141407` adiciona `result_balance_amount numeric(19,2) null` em
`wager_transactions`. Guarda só o valor; a moeda é a mesma coluna `currency` da transação
(carteira mono-moeda, moeda validada contra a da carteira antes de qualquer desfecho).

`WagerTransaction` ganhou `_resultBalance?: Money`, o getter `resultBalance`, o setter
`recordResultBalance(balance)` e o campo em `WagerTransactionState`/`rehydrate`. Optou-se por um
**setter dedicado** em vez de estender as assinaturas de `markProcessed`/`reject`/
`markPendingReference`: é um dado de auditoria/observabilidade, não uma transição de estado, e
manter as assinaturas evita mexer nos 15 testes da máquina de estados e na criação de `OPENING`
no `CreateWalletUseCase`. Não é set-once — no caminho `PENDING_REFERENCE → PROCESSED` o valor é
sobrescrito com o saldo pós-crédito (o último desfecho é o que vale).

### Gravação

`WagerTransactionProcessor` chama `transaction.recordResultBalance(wallet.balance)` imediatamente
antes de persistir, nos três caminhos terminais: `runProcess` (após mutar a carteira, ou o saldo
inalterado no caso de `LOSS`), `holdForReference` e `reject`.

### Leitura

`SubmitWagerTransactionUseCase.balanceObservedFor(existing)` passou a checar `resultBalance`
primeiro; o lookup de lançamento e o saldo atual da carteira ficam como fallback para linhas
antigas gravadas antes da migration.

### Testes

- Unit: `WagerTransaction` carrega o saldo gravado por persistência; mapper faz round-trip de
  `result_balance_amount` (valor e `null`).
- Integração (`use-cases.spec.ts`): replay de `LOSS` após um `BET` mover o saldo devolve o saldo
  de quando o `LOSS` foi processado, não o atual; idem para um `BET` rejeitado por saldo
  insuficiente após um `WIN` posterior.

`migration:up` → `check` limpo → `down`/`up` → `check` limpo. **118 unitários (+2), 74 de
integração (+2), 11 de concorrência** — verdes. `tsc`/`oxlint` limpos.

### Nota — gerador de migration e triggers

`migration:create` volta a emitir DDL espúria de recriação dos triggers do ledger no `down()`
(mesmo com `schemaGenerator.ignoreTriggers`, que só cobre o `up`). A migration foi editada à mão
para conter apenas o `add`/`drop column`. `migration:check` permanece limpo.

## Revisão pós-entrega — Bloco D: limpezas

- **Nível de log `info`** — `StructuredLogger.log()` emitia `"level":"log"` (nome do nível de
  info no NestJS). Passou a emitir `"level":"info"`, mais convencional para um consumidor de logs
  estruturados. `warn`/`error`/`debug`/`verbose` inalterados. `write` agora tipa `level` como
  `string` (o valor `'info'` não faz parte do union `LogLevel` do Nest).
- **Parágrafo de mensageria do ARCHITECTURE.md** — reescrito: deixava implícito que a publicação
  do outbox roda dentro da transação que segura o lock **da carteira**. Na verdade a transação de
  negócio (que segura o lock da carteira) só grava as linhas em `outbox_messages`; o worker
  publica depois, em transação própria, segurando apenas o lock (`SKIP LOCKED`) da linha do
  outbox durante o envio à SQS. Restrição 4 (não publicar antes do commit) é respeitada.
- **`IDEMPOTENCY_CONFLICT` vs `PERSISTENCE_CONFLICT` — não alterado.** Os dois já mapeiam para
  `409` e a API distingue as cinco situações da seção 9 por **status HTTP**, não pelo `code`. Um
  `PersistenceConflictError` cru só escapa quando o replay pós-conflito não encontra a linha (a
  transação concorrente abortou) — situação retriável, onde `PERSISTENCE_CONFLICT` é mais honesto
  que `IDEMPOTENCY_CONFLICT` ("corrija a key"). Trocar seria cosmético e potencialmente pior.

## Revisão pós-entrega — Bloco E: fechamento de observabilidade (seção 12)

Uma segunda revisão independente apontou três lacunas contra a seção 12 ("logs estruturados JSON"
+ "sem payloads financeiros nos logs"), todas corrigidas:

- **Logger da aplicação** — `main.ts` não instalava o `StructuredLogger`; logs do framework Nest,
  exceções não tratadas e MikroORM saíam no logger colorido default. Agora
  `NestFactory.create(AppModule, { bufferLogs: true })` + `app.useLogger(app.get(StructuredLogger))`
  — **todo** o output é JSON (confirmado no boot).
- **Valores monetários no log de reconciliação** — `reconcile-wallet.use-case.ts` logava
  `storedBalance`/`calculatedBalance`/`difference`. Agora o `warn` registra só `walletId`,
  `checkedEntries` e `direction` (`stored-below-ledger` / `stored-above-ledger`). Os montantes
  continuam na **resposta** da API e a divergência continua contabilizada na métrica — a seção 9
  exige sinalização, não que os valores estejam no log.
- **SQL debug do MikroORM** — era `debug: process.env.NODE_ENV !== 'production'` (ligado em dev,
  logando SQL com valores). Agora `debug: process.env.MIKRO_ORM_DEBUG === 'true'` — desligado por
  padrão, opt-in explícito. Documentado em `.env.example`.

Também corrigido o `ARCHITECTURE.md`: `version` era descrito como "optimistic-friendly", mas
nunca é verificado em nenhum `UPDATE` — é um contador monotônico de alterações de saldo (exposto
na API e no evento `WalletBalanceChanged`); o controle de concorrência é 100% pessimista.

**Suítes após o Bloco E:** 118 unitários, 74 de integração, 11 de concorrência — verdes.
`tsc`/`oxlint` limpos. Boot confirma output 100% JSON, sem SQL debug.

## Revisão pós-entrega — Bloco F1: deploy containerizado multi-instância

O desafio centra em "solução correta com múltiplas instâncias". Havia `docker-compose.yml` só
da infra; agora a própria aplicação é containerizada e o compose sobe N réplicas.

### `Dockerfile` multi-stage

`deps` (só `package.json` + `bun.lock` → `bun install --frozen-lockfile`, camada cacheável) →
`build` (copia `src` + tsconfigs → `bun run build` → `dist/`) → `runtime` (`oven/bun:1-alpine`,
`NODE_ENV=production`, `bun install --frozen-lockfile --production`, copia `dist/` + `src/`,
`HEALTHCHECK` em `/health/live`, `CMD bun dist/main.js`). `src/` vai junto no runtime só para o
`mikro-orm.config.ts` e os globs `entitiesTs`/`migrations.pathTs` resolverem — a app roda pelo
`dist/`.

### Compose — profile `app`

`docker compose up -d` (sem profile) continua subindo **só** Postgres + LocalStack (dev e testes
inalterados). O profile `app` adiciona:

- **`migrate`** — one-shot (`target: build`, tem o `@mikro-orm/cli`), roda `migration:up` e sai.
- **`app`** — `deploy.replicas: 3`, `target: runtime`, `depends_on` migrate
  (`service_completed_successfully`) + infra healthy. Cada réplica roda API + os 3 workers.
- **`gateway`** — nginx `1.27-alpine` com `resolver 127.0.0.11` re-resolvendo `app:3000` por
  request → round-robin real entre as réplicas. Publica `3000:80`.

Env compartilhada via anchor YAML (`x-app-env`); as URLs de fila usam path-style
`http://localstack:4566/000000000000/<queue>` (o host `localhost.localstack.cloud` resolveria
para 127.0.0.1 dentro do container).

Por que gateway em vez de `ports: "3000-3005:3000"`: o Compose v2 só publica **uma** réplica
quando se combina range de porta no host com `deploy.replicas` — o nginx dá o balanceamento de
verdade e a história "N instâncias stateless atrás de um LB" fica explícita.

### Validação

`docker compose --profile app up -d --build`: 3 réplicas `healthy`, `migrate` completou, os 3
workers logados em cada réplica. Cenário obrigatório da seção 8 pelo gateway (3 `BET` de 80
concorrentes numa carteira de 100) → 1 `PROCESSED`, 2 `REJECTED`/`INSUFFICIENT_FUNDS`, saldo 20,
`reconcile` consistente — agora entre containers de SO distintos, não fibras num processo.
Suítes locais inalteradas: 118 / 74 / 11 verdes, `tsc`/`oxlint` limpos.
