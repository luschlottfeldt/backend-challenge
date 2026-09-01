# Distributed Wagering Processor

Serviço financeiro distribuído para processamento de apostas, construído para o desafio técnico
da Jungle Gaming. O enunciado original está em [`CHALLENGE.md`](./CHALLENGE.md); as decisões de
arquitetura tomadas durante o desenvolvimento estão em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Stack

- **Runtime / package manager / test runner:** Bun 1.x
- **Linguagem:** TypeScript (modo estrito)
- **Framework:** NestJS
- **Banco:** PostgreSQL
- **ORM:** MikroORM
- **Mensageria:** AWS SQS via LocalStack
- **Orquestração local:** Docker Compose

## Pré-requisitos

- [Bun](https://bun.sh) 1.x
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
```

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `bun run start` | Sobe a aplicação (build via Nest CLI) |
| `bun run start:dev` | Sobe a aplicação em modo watch |
| `bun run start:debug` | Modo watch com debugger |
| `bun run start:prod` | Sobe o build de produção (`dist/main.js`) |
| `bun run build` | Compila para `dist/` |
| `bun run test` | Testes unitários (`src/**/*.spec.ts`) |
| `bun run test:watch` | Testes unitários em modo watch |
| `bun run test:cov` | Testes unitários com cobertura |
| `bun run test:integration` | Testes de integração (`test/integration/`) — exige Postgres/LocalStack reais rodando |
| `bun run test:concurrency` | Testes de concorrência (`test/concurrency/`) — exige Postgres/LocalStack reais rodando |
| `bun run lint` | Lint (oxlint) |
| `bun run format` | Formata o código (prettier) |
| `bun run mikro-orm` | CLI do MikroORM |
| `bun run migration:create` | Gera uma nova migration a partir do diff de entidades |
| `bun run migration:up` | Aplica migrations pendentes |
| `bun run migration:down` | Reverte a última migration |
| `bun run migration:pending` | Lista migrations pendentes |

## Estrutura de pastas

```
src/
├── domain/          # Entidades, VOs, eventos, erros e interfaces de repositório (portas)
├── application/      # Casos de uso (orquestração)
├── infrastructure/    # MikroORM, SQS, logger — implementações concretas das portas do domínio
├── presentation/      # Controllers, DTOs, guards, filtros (NestJS)
├── app.module.ts
├── mikro-orm.config.ts
└── main.ts

test/
├── integration/     # Testes contra Postgres/LocalStack reais
└── concurrency/     # Testes de concorrência real (múltiplas instâncias/paralelismo)
```

## Estado atual

Este repositório contém o **boilerplate** do projeto: estrutura de camadas, entidades de domínio
com as assinaturas do desafio (ainda sem lógica de negócio implementada), schema de banco já
migrado, endpoints da API mapeados (ainda retornando `Not implemented`) e toda a infraestrutura
local (Postgres, SQS via LocalStack) funcionando de ponta a ponta. A lógica de negócio (`Money`,
`Wallet`, `WagerTransaction`, casos de uso, idempotência, outbox worker) é o próximo passo de
desenvolvimento.
