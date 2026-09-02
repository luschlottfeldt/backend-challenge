# Distributed Wagering Processor

Serviço financeiro distribuído para processamento de apostas, construído para o desafio técnico
da Jungle Gaming. O enunciado original está em [`CHALLENGE.md`](./CHALLENGE.md); a arquitetura,
os trade-offs e a decisão sobre autenticação estão em [`ARCHITECTURE.md`](./ARCHITECTURE.md)
(o rascunho detalhado, decisão a decisão, está em [`DECISIONS.md`](./DECISIONS.md)).

## Stack

- **Runtime / package manager / test runner:** Bun 1.4
- **Linguagem:** TypeScript (modo estrito)
- **Framework:** NestJS 12
- **Banco:** PostgreSQL 16
- **ORM:** MikroORM 7 (Data Mapper)
- **Mensageria:** AWS SQS via LocalStack
- **Métricas:** Prometheus (`prom-client`)
- **Orquestração local:** Docker Compose

## Pré-requisitos

- [Bun](https://bun.sh) 1.4+
- Docker e Docker Compose

## Setup

```bash
# 1. Instalar dependências
bun install

# 2. Configurar variáveis de ambiente
cp .env.example .env

# 3. Subir Postgres e LocalStack (cria as filas SQS automaticamente)
docker compose up -d

# 4. Rodar as migrations
bun run migration:up

# 5. Subir a aplicação em modo desenvolvimento
bun run start:dev
```

A aplicação sobe em `http://localhost:3000`. Verifique com:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl http://localhost:3000/metrics
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/wallets` | Cria uma carteira (saldo inicial positivo gera transação `OPENING` + lançamento) |
| `GET` | `/wallets/:walletId` | Consulta a carteira |
| `GET` | `/wallets/:walletId/ledger?cursor=&limit=` | Ledger paginado por cursor opaco |
| `POST` | `/wallets/:walletId/reconciliation` | Reconcilia saldo x lançamentos |
| `POST` | `/wagering/transactions` | Submete uma transação — header `Idempotency-Key` obrigatório |
| `GET` | `/wagering/transactions/:transactionId` | Consulta por id |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta por provedor + id externo |
| `GET` | `/health/live` · `/health/ready` | Liveness / readiness (abertos) |
| `GET` | `/metrics` | Métricas no formato Prometheus |

Autenticação **não** foi implementada — ver `ARCHITECTURE.md`. Os controllers de negócio têm um
`NoOpAuthGuard` como ponto de extensão.

## Workers

API HTTP e os três workers rodam no mesmo processo. Cada worker é ligável por variável de
ambiente (default: ligado), o que permite escalar réplicas com papéis diferentes:

| Variável | Worker |
|---|---|
| `OUTBOX_PUBLISHER_ENABLED` | Publica os eventos pendentes do outbox na `integration-events.fifo` |
| `SQS_CONSUMER_ENABLED` | Consome `wager-transactions.fifo` (inbox + dedup) |
| `REFERENCE_REPROCESS_ENABLED` | Reprocessa transações `PENDING_REFERENCE` com backoff |

## Testes

```bash
bun run test              # unidade (test/unit/) — domínio puro, sem I/O
bun run test:integration  # integração (test/integration/) — exige Postgres + LocalStack
bun run test:concurrency  # concorrência (test/concurrency/) — races, 3+ processos reais, restart pós-SIGKILL; exige Postgres + LocalStack
```

Os testes de integração e concorrência rodam contra os containers do `docker-compose.yml` — não
há mock de banco ou de fila. Teste de carga (`test:load`) não foi implementado.

## Scripts

| Script | Descrição |
|---|---|
| `bun run start` / `start:dev` / `start:debug` / `start:prod` | Sobe a aplicação |
| `bun run build` | Compila para `dist/` |
| `bun run lint` | Lint (oxlint) |
| `bun run format` | Formata (prettier) |
| `bun run migration:up` / `migration:down` / `migration:pending` | Migrations |
| `bun run migration:create` | Gera migration a partir do diff de entidades |

## Estrutura de pastas

```
src/
├── domain/          # Entidades, VOs, máquina de estados, eventos, erros, portas de repositório
├── application/     # Casos de uso, WagerTransactionProcessor, portas (Clock, Metrics, ...)
├── infrastructure/  # MikroORM, SQS, logger, métricas, workers — adapters concretos
├── presentation/    # Controllers, DTOs, filtro de exceção, interceptor, guard
├── app.module.ts
├── mikro-orm.config.ts
└── main.ts

test/
├── unit/            # Testes de unidade (espelham a árvore de src/)
├── integration/     # Testes contra Postgres + LocalStack reais
└── concurrency/     # Races, multi-processo e restart (harness/ sobe instâncias como processos separados)
```
