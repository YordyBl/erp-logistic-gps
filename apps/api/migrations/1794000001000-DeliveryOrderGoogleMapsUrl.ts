import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DeliveryOrderGoogleMapsUrl1794000001000 implements MigrationInterface {
  name = 'DeliveryOrderGoogleMapsUrl1794000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "delivery_orders" ADD COLUMN "google_maps_url" varchar(2048)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "delivery_orders" DROP COLUMN "google_maps_url"');
  }
}
