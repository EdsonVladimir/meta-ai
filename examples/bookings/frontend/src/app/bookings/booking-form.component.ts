import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { BookingsStore } from "./bookings.store";

@Component({
  selector: "app-booking-form",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./booking-form.component.html",
  styleUrl: "./booking-form.component.css",
})
export class BookingFormComponent {
  private readonly store = inject(BookingsStore);
  protected room = "";
  protected date = "";
  protected guests = 1;

  protected submit(): void {
    this.store.add({ room: this.room, date: this.date, guests: this.guests });
  }
}
