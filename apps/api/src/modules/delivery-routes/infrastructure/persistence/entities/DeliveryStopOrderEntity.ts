import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'delivery_stop_orders' })
@Index('uq_delivery_stop_orders_active_order', ['orderId'], { unique: true, where: '"active" = true' })
@Unique('uq_delivery_stop_orders_stop_position', ['stopId', 'position'])
@Check('chk_delivery_stop_orders_position', '"position" >= 0')
export class DeliveryStopOrderEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'route_id', type: 'uuid' }) routeId!: string;
  @ManyToOne('DeliveryRouteEntity', { onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'route_id', referencedColumnName: 'id' },
  ]) route!: { readonly id: string };
  @Column({ name: 'stop_id', type: 'uuid' }) stopId!: string;
  @ManyToOne('DeliveryStopEntity', { onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'route_id', referencedColumnName: 'routeId' },
    { name: 'stop_id', referencedColumnName: 'id' },
  ]) stop!: { readonly id: string };
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ type: 'integer' }) position!: number;
  @ManyToOne('DeliveryOrderEntity', { onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'order_id', referencedColumnName: 'id' },
  ]) order!: { readonly id: string };
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
