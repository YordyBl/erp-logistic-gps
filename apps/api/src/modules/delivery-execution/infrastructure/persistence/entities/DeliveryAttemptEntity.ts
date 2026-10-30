import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'delivery_attempts' })
@Unique('uq_delivery_attempt_order_number', ['organizationId', 'orderId', 'attemptNumber'])
@Unique('uq_delivery_attempt_org_id', ['organizationId', 'id'])
@Index('idx_delivery_attempt_active_order', ['organizationId', 'orderId', 'status'])
@Check('chk_delivery_attempt_status', `"status" IN ('in_progress', 'delivered', 'failed')`)
export class DeliveryAttemptEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'route_id', type: 'uuid' })
  routeId!: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @Column({ name: 'attempt_number', type: 'integer' })
  attemptNumber!: number;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
