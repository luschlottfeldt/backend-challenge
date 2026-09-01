import { Migration } from '@mikro-orm/migrations';

export class Migration20260901194833 extends Migration {

  override name = 'Migration20260901194833';

  override up(): void | Promise<void> {
    this.addSql(`drop index "outbox_messages_next_attempt_at_index";`);
    this.addSql(`create index "outbox_messages_published_at_next_attempt_at_index" on "outbox_messages" ("published_at", "next_attempt_at");`);

    this.addSql(`alter table "wager_transactions" add "reference_check_attempts" int not null default 0, add "next_reference_check_at" timestamptz null;`);
    this.addSql(`create index "wager_transactions_status_next_reference_check_at_index" on "wager_transactions" ("status", "next_reference_check_at");`);
    this.addSql(`create index "wager_transactions_reference_transaction_id_index" on "wager_transactions" ("reference_transaction_id");`);

    this.addSql(`create index "wallet_ledger_entries_wallet_id_created_at_id_index" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "outbox_messages_published_at_next_attempt_at_index";`);
    this.addSql(`create index "outbox_messages_next_attempt_at_index" on "outbox_messages" ("next_attempt_at");`);

    this.addSql(`drop index "wager_transactions_status_next_reference_check_at_index";`);
    this.addSql(`drop index "wager_transactions_reference_transaction_id_index";`);
    this.addSql(`alter table "wager_transactions" drop column "reference_check_attempts", drop column "next_reference_check_at";`);

    this.addSql(`drop index "wallet_ledger_entries_wallet_id_created_at_id_index";`);
  }

}
