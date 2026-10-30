import { computed, inject, Injectable, signal } from "@angular/core";
import { CreateReserva, Reserva } from "./reserva.model";
import { ReservasService } from "./reservas.service";

@Injectable({ providedIn: "root" })
export class ReservasStore {
  private readonly service = inject(ReservasService);
  readonly reservas = signal<Reserva[]>([]);
  readonly loading = signal(false);
  readonly count = computed(() => this.reservas().length);

  load(): void {
    this.loading.set(true);
    this.service.list().subscribe((items) => {
      this.reservas.set(items);
      this.loading.set(false);
    });
  }

  add(dto: CreateReserva): void {
    this.service.create(dto).subscribe((item) => {
      this.reservas.update((current) => [...current, item]);
    });
  }
}
