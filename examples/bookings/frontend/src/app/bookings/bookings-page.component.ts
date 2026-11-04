import { Component, inject } from "@angular/core";
import { BookingFormComponent } from "./booking-form.component";
import { BookingsStore } from "./bookings.store";

@Component({
  selector: "app-bookings-page",
  standalone: true,
  imports: [BookingFormComponent],
  template: `
    <section>
      <h1>Room bookings</h1>
      <p>{{ store.count() }} bookings</p>
      @if (store.loading()) {
        <p>Loading…</p>
      } @else {
        <ul>
          @for (booking of store.bookings(); track booking.id) {
            <li>{{ booking.room }} · {{ booking.date }} · {{ booking.guests }} guests</li>
          }
        </ul>
      }
      <app-booking-form />
    </section>
  `,
})
export class BookingsPageComponent {
  protected readonly store = inject(BookingsStore);

  constructor() {
    this.store.load();
  }
}
