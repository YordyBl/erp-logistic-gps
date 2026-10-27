import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
} from 'typeorm';

/**
 * Persistence mapping for the `Organization` tenant root.
 *
 * The check mirrors the domain rule so a hand-written insert cannot create a
 * blank organization name. Timestamps are `timestamptz` instants supplied by
 * the use case, never database defaults (ADR-007 §4).
 */
@Entity({ name: 'organizations' })
@Check('chk_organizations_name', `char_length(btrim("name")) BETWEEN 2 AND 120`)
export class OrganizationEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
