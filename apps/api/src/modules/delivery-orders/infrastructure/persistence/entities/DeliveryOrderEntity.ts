import {
  Check,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import { DeliveryOrderPackageEntity } from './DeliveryOrderPackageEntity.js';

/**
 * Persistence mapping for the `DeliveryOrder` aggregate (Data Mapper).
 *
 * This class is infrastructure-only: the domain aggregate never imports it and
 * the mapper converts between both representations (ADR-002 §2). Recipient,
 * address and package value objects are flattened into columns; no JSON blobs
 * are stored.
 *
 * Timestamps are `timestamptz` instants. Database sessions run with
 * `timezone=America/Lima` (see the data source), so operators read Lima time
 * while the stored instant stays absolute.
 */
@Entity({ name: 'delivery_orders' })
@Unique('uq_delivery_orders_organization_public_code', ['organizationId', 'publicCode'])
@Index('idx_delivery_orders_organization_id', ['organizationId'])
@Check(
  'chk_delivery_orders_status',
  `"status" IN ('created', 'planned', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled')`,
)
@Check(
  'chk_delivery_orders_public_code',
  `"public_code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'`,
)
@Check(
  'chk_delivery_orders_coordinates',
  '("latitude" IS NULL) = ("longitude" IS NULL)',
)
@Check(
  'chk_delivery_orders_latitude',
  '"latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)',
)
@Check(
  'chk_delivery_orders_longitude',
  '"longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)',
)
export class DeliveryOrderEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'public_code', type: 'varchar', length: 32 })
  publicCode!: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 120 })
  recipientName!: string;

  @Column({ name: 'recipient_phone', type: 'varchar', length: 20 })
  recipientPhone!: string;

  @Column({ name: 'delivery_address_line', type: 'varchar', length: 200 })
  deliveryAddressLine!: string;

  @Column({ name: 'delivery_district', type: 'varchar', length: 80 })
  deliveryDistrict!: string;

  @Column({
    name: 'latitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
  })
  latitude!: string | null;

  @Column({
    name: 'longitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
  })
  longitude!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'created' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(
    () => DeliveryOrderPackageEntity,
    (packageEntity) => packageEntity.deliveryOrder,
  )
  packages!: DeliveryOrderPackageEntity[];
}
