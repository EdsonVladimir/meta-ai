import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Booking {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  room!: string;

  @Column()
  date!: string;

  @Column()
  guests!: number;
}
