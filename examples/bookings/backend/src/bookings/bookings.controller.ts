import { Body, Controller, Get, Post } from "@nestjs/common";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { Booking } from "./entities/booking.entity";
import { BookingsService } from "./bookings.service";

@Controller("bookings")
export class BookingsController {
  constructor(private readonly service: BookingsService) {}

  @Get()
  findAll(): Promise<Booking[]> {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateBookingDto): Promise<Booking> {
    return this.service.create(dto);
  }
}
