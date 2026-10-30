import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CreateReservaDto } from "./dto/create-reserva.dto";
import { Reserva } from "./entities/reserva.entity";

@Injectable()
export class ReservasService {
  constructor(
    @InjectRepository(Reserva)
    private readonly repo: Repository<Reserva>,
  ) {}

  findAll(): Promise<Reserva[]> {
    return this.repo.find();
  }

  create(dto: CreateReservaDto): Promise<Reserva> {
    const reserva = this.repo.create(dto);
    return this.repo.save(reserva);
  }
}
