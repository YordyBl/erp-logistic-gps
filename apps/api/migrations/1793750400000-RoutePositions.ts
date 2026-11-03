import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RoutePositions1793750400000 implements MigrationInterface {
  name = 'RoutePositions1793750400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE route_positions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      route_id uuid NOT NULL,
      driver_id uuid NOT NULL,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      accuracy_meters double precision NOT NULL,
      speed_meters_per_second double precision NOT NULL,
      source varchar(20) NOT NULL,
      recorded_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL,
      CONSTRAINT fk_route_positions_route FOREIGN KEY (organization_id, route_id)
        REFERENCES delivery_routes (organization_id, id) ON DELETE CASCADE,
      CONSTRAINT chk_route_positions_latitude CHECK (latitude BETWEEN -90 AND 90),
      CONSTRAINT chk_route_positions_longitude CHECK (longitude BETWEEN -180 AND 180),
      CONSTRAINT chk_route_positions_accuracy CHECK (accuracy_meters > 0),
      CONSTRAINT chk_route_positions_speed CHECK (speed_meters_per_second >= 0),
      CONSTRAINT chk_route_positions_source CHECK (source IN ('simulated', 'mobile'))
    )`);
    await queryRunner.query(`CREATE INDEX idx_route_positions_route_recorded
      ON route_positions (organization_id, route_id, recorded_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_route_positions_driver_recorded
      ON route_positions (organization_id, driver_id, recorded_at DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE route_positions');
  }
}
