import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { Booking } from "./entities/booking.entity";

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly repo: Repository<Booking>,
  ) {}

  findAll(): Promise<Booking[]> {
    return this.repo.find();
  }

  create(dto: CreateBookingDto): Promise<Booking> {
    const booking = this.repo.create(dto);
    return this.repo.save(booking);
  }
}
