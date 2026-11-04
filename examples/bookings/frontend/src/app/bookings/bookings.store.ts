import { computed, inject, Injectable, signal } from "@angular/core";
import { CreateBooking, Booking } from "./booking.model";
import { BookingsService } from "./bookings.service";

@Injectable({ providedIn: "root" })
export class BookingsStore {
  private readonly service = inject(BookingsService);
  readonly bookings = signal<Booking[]>([]);
  readonly loading = signal(false);
  readonly count = computed(() => this.bookings().length);

  load(): void {
    this.loading.set(true);
    this.service.list().subscribe((items) => {
      this.bookings.set(items);
      this.loading.set(false);
    });
  }

  add(dto: CreateBooking): void {
    this.service.create(dto).subscribe((item) => {
      this.bookings.update((current) => [...current, item]);
    });
  }
}
