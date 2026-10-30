import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReservasModule } from "./reservas/reservas.module";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "sqlite",
      database: "reservas.db",
      entities: [__dirname + "/**/*.entity{.ts,.js}"],
      synchronize: true,
    }),
    ReservasModule,
  ],
})
export class AppModule {}
