import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Route codes are generated like order codes: one global sequence, formatted as RUT-00000001. */
export class DeliveryRouteCodes1794200000000 implements MigrationInterface {
  name = 'DeliveryRouteCodes1794200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SEQUENCE delivery_route_public_code_seq START WITH 1');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SEQUENCE delivery_route_public_code_seq');
  }
}
