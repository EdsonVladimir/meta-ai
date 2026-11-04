import { Component, inject } from "@angular/core";
import { BookingFormComponent } from "./booking-form.component";
import { BookingsStore } from "./bookings.store";

@Component({
  selector: "app-bookings-page",
  standalone: true,
  imports: [BookingFormComponent],
  templateUrl: "./bookings-page.component.html",
  styleUrl: "./bookings-page.component.css",
})
export class BookingsPageComponent {
  protected readonly store = inject(BookingsStore);

  constructor() {
    this.store.load();
  }
}
