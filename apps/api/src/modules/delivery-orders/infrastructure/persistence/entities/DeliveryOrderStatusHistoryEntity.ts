import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { DeliveryOrderEntity } from './DeliveryOrderEntity.js';

/** Append-only status audit rows, committed with the corresponding order update. */
@Entity({ name: 'delivery_order_status_history' })
@Index('idx_delivery_order_status_history_order', ['orderId', 'occurredAt'])
export class DeliveryOrderStatusHistoryEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => DeliveryOrderEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order!: DeliveryOrderEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 20 })
  fromStatus!: string;

  @Column({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
