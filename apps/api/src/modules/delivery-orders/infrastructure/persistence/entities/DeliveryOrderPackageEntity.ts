import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import { DeliveryOrderEntity } from './DeliveryOrderEntity.js';

/**
 * Persistence mapping for the packages value objects of a delivery order.
 *
 * Package rows exist only as children of an order: they carry a UUID primary
 * key for relational integrity but that identity is not part of the domain
 * contract. `position` preserves the order in which the aggregate holds its
 * packages, so a round trip returns the same sequence.
 */
@Entity({ name: 'delivery_order_packages' })
@Unique('uq_delivery_order_packages_order_code', ['deliveryOrderId', 'code'])
@Check(
  'chk_delivery_order_packages_weight_kg',
  '"weight_kg" IS NULL OR ("weight_kg" > 0 AND "weight_kg" <= 1000)',
)
@Check('chk_delivery_order_packages_position', '"position" >= 0')
export class DeliveryOrderPackageEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'delivery_order_id', type: 'uuid' })
  deliveryOrderId!: string;

  @ManyToOne(() => DeliveryOrderEntity, (order) => order.packages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'delivery_order_id' })
  deliveryOrder!: DeliveryOrderEntity;

  @Column({ name: 'position', type: 'integer' })
  position!: number;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  description!: string;

  @Column({
    name: 'weight_kg',
    type: 'numeric',
    precision: 10,
    scale: 3,
    nullable: true,
  })
  weightKg!: string | null;
}
