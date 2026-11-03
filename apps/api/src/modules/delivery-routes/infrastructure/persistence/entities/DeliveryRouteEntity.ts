import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';

/** Infrastructure mapping; driver, vehicle and organization are referenced by id. */
@Entity({ name: 'delivery_routes' })
@Unique('uq_delivery_routes_organization_id', ['organizationId', 'id'])
@Unique('uq_delivery_routes_organization_public_code', ['organizationId', 'publicCode'])
@Check('chk_delivery_routes_status', `"status" IN ('planned', 'in_progress', 'completed', 'cancelled')`)
@Check('chk_delivery_routes_origin', `("origin_address_line" IS NULL AND "origin_latitude" IS NULL AND "origin_longitude" IS NULL) OR ("origin_address_line" IS NOT NULL AND "origin_latitude" IS NOT NULL AND "origin_longitude" IS NOT NULL)`)
@Index('uq_delivery_routes_active_driver', ['driverId'], {
  unique: true, where: `"status" IN ('planned', 'in_progress')`,
})
@Index('uq_delivery_routes_active_vehicle', ['vehicleId'], {
  unique: true, where: `"status" IN ('planned', 'in_progress')`,
})
export class DeliveryRouteEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne('OrganizationEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' }) organization!: { readonly id: string };
  @Column({ name: 'public_code', type: 'varchar', length: 32 }) publicCode!: string;
  @Column({ name: 'planned_date', type: 'date' }) plannedDate!: string;
  @Column({ name: 'driver_id', type: 'uuid' }) driverId!: string;
  @ManyToOne('DriverEntity', { onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'driver_id', referencedColumnName: 'id' },
  ]) driver!: { readonly id: string };
  @Column({ name: 'vehicle_id', type: 'uuid' }) vehicleId!: string;
  @ManyToOne('VehicleEntity', { onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'vehicle_id', referencedColumnName: 'id' },
  ]) vehicle!: { readonly id: string };
  @Column({ type: 'varchar', length: 20 }) status!: string;
  @Column({ name: 'origin_address_line', type: 'varchar', length: 200, nullable: true })
  originAddressLine!: string | null;
  @Column({ name: 'origin_latitude', type: 'numeric', precision: 9, scale: 6, nullable: true })
  originLatitude!: string | null;
  @Column({ name: 'origin_longitude', type: 'numeric', precision: 9, scale: 6, nullable: true })
  originLongitude!: string | null;
  @Column({ name: 'simulated_completion_enabled', type: 'boolean', default: false })
  simulatedCompletionEnabled!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt!: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt!: Date | null;
}
