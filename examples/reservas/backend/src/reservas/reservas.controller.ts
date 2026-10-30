import { Body, Controller, Get, Post } from "@nestjs/common";
import { CreateReservaDto } from "./dto/create-reserva.dto";
import { Reserva } from "./entities/reserva.entity";
import { ReservasService } from "./reservas.service";

@Controller("reservas")
export class ReservasController {
  constructor(private readonly service: ReservasService) {}

  @Get()
  findAll(): Promise<Reserva[]> {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateReservaDto): Promise<Reserva> {
    return this.service.create(dto);
  }
}
