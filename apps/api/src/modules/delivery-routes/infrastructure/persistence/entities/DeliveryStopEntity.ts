import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'delivery_stops' })
@Unique('uq_delivery_stops_organization_route_id', ['organizationId', 'routeId', 'id'])
@Unique('uq_delivery_stops_route_sequence', ['routeId', 'sequence'])
@Check('chk_delivery_stops_sequence', '"sequence" > 0')
@Check('chk_delivery_stops_coordinates', '("latitude" IS NULL) = ("longitude" IS NULL)')
export class DeliveryStopEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'route_id', type: 'uuid' }) routeId!: string;
  @ManyToOne('DeliveryRouteEntity', { onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'route_id', referencedColumnName: 'id' },
  ]) route!: { readonly id: string };
  @Column({ type: 'integer' }) sequence!: number;
  @Column({ name: 'address_line', type: 'varchar', length: 200 }) addressLine!: string;
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true }) latitude!: string | null;
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true }) longitude!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'pending' }) status!: string;
  @Column({ name: 'planned_arrival_at', type: 'timestamptz', nullable: true }) plannedArrivalAt!: Date | null;
}
