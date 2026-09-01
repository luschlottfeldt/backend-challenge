import { Migration } from '@mikro-orm/migrations';

export class Migration20260901034558 extends Migration {

  override name = 'Migration20260901034558';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_messages" ("consumer_name" varchar(255) not null, "message_id" varchar(255) not null, "payload_hash" varchar(255) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("consumer_name", "message_id"));`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" varchar(255) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "published_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "outbox_messages_next_attempt_at_index" on "outbox_messages" ("next_attempt_at");`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(255) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "kind" text not null, "amount" numeric(19,2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(255) null, "created_at" timestamptz not null, "status" text not null, "reference_transaction_id" uuid null, "failure_code" varchar(255) null, "processed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" varchar(3) not null, "balance_amount" numeric(19,2) not null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);
    this.addSql(`alter table "wallets" add constraint "wallets_balance_amount_check" check (balance_amount >= 0);`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" text not null, "amount" numeric(19,2) not null, "currency" varchar(3) not null, "balance_before_amount" numeric(19,2) not null, "balance_after_amount" numeric(19,2) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_transaction_id_unique" unique ("wallet_id", "transaction_id");`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT'));`);
  }

}
