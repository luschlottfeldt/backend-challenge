import { Migration } from '@mikro-orm/migrations';

export class Migration20260902141407 extends Migration {

  override name = 'Migration20260902141407';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" add "result_balance_amount" numeric(19,2) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop column "result_balance_amount";`);
  }

}
