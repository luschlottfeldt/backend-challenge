import { Migration } from '@mikro-orm/migrations';

export class Migration20260902135118 extends Migration {

  override name = 'Migration20260902135118';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_transaction_id_kind_unique" unique ("reference_transaction_id", "kind");`);

    this.addSql(`create or replace function "forbid_wallet_ledger_entry_mutation"() returns trigger language plpgsql as $$
begin
  raise exception 'wallet_ledger_entries is append-only: % is not permitted', tg_op using errcode = 'restrict_violation';
end;
$$;`);
    this.addSql(`create trigger "wallet_ledger_entries_forbid_update" before update on "wallet_ledger_entries" for each row execute function "forbid_wallet_ledger_entry_mutation"();`);
    this.addSql(`create trigger "wallet_ledger_entries_forbid_delete" before delete on "wallet_ledger_entries" for each row execute function "forbid_wallet_ledger_entry_mutation"();`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop trigger if exists "wallet_ledger_entries_forbid_update" on "wallet_ledger_entries";`);
    this.addSql(`drop trigger if exists "wallet_ledger_entries_forbid_delete" on "wallet_ledger_entries";`);
    this.addSql(`drop function if exists "forbid_wallet_ledger_entry_mutation"();`);

    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_reference_transaction_id_kind_unique";`);
  }

}
