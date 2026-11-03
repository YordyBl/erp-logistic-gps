import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'route_positions' })
@Index('idx_route_positions_route_recorded', ['organizationId', 'routeId', 'recordedAt'])
@Index('idx_route_positions_driver_recorded', ['organizationId', 'driverId', 'recordedAt'])
@Check('chk_route_positions_latitude', '"latitude" BETWEEN -90 AND 90')
@Check('chk_route_positions_longitude', '"longitude" BETWEEN -180 AND 180')
@Check('chk_route_positions_accuracy', '"accuracy_meters" > 0')
@Check('chk_route_positions_speed', '"speed_meters_per_second" >= 0')
@Check('chk_route_positions_source', `"source" IN ('simulated', 'mobile')`)
export class RoutePositionEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'route_id', type: 'uuid' }) routeId!: string;
  @Column({ name: 'driver_id', type: 'uuid' }) driverId!: string;
  @Column({ type: 'double precision' }) latitude!: number;
  @Column({ type: 'double precision' }) longitude!: number;
  @Column({ name: 'accuracy_meters', type: 'double precision' }) accuracyMeters!: number;
  @Column({ name: 'speed_meters_per_second', type: 'double precision' }) speedMetersPerSecond!: number;
  @Column({ type: 'varchar', length: 20 }) source!: 'simulated' | 'mobile';
  @Column({ name: 'recorded_at', type: 'timestamptz' }) recordedAt!: Date;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt!: Date;
}
