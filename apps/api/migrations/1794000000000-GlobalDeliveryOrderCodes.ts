import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GlobalDeliveryOrderCodes1794000000000 implements MigrationInterface {
  name = 'GlobalDeliveryOrderCodes1794000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SEQUENCE delivery_order_public_code_seq START WITH 1');
    await queryRunner.query('CREATE SEQUENCE delivery_order_package_code_seq START WITH 1');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SEQUENCE delivery_order_package_code_seq');
    await queryRunner.query('DROP SEQUENCE delivery_order_public_code_seq');
  }
}
