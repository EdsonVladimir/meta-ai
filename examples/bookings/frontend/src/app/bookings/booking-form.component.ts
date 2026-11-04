import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { BookingsStore } from "./bookings.store";

@Component({
  selector: "app-booking-form",
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="submit()">
      <label>
        Room
        <input name="room" [(ngModel)]="room" required />
      </label>
      <label>
        Date
        <input name="date" type="date" [(ngModel)]="date" required />
      </label>
      <label>
        Guests
        <input name="guests" type="number" [(ngModel)]="guests" min="1" required />
      </label>
      <button type="submit">Book</button>
    </form>
  `,
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
