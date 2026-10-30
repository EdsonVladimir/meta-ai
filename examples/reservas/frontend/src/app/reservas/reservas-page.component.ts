import { Component, inject } from "@angular/core";
import { ReservaFormComponent } from "./reserva-form.component";
import { ReservasStore } from "./reservas.store";

@Component({
  selector: "app-reservas-page",
  standalone: true,
  imports: [ReservaFormComponent],
  template: `
    <section>
      <h1>Room bookings</h1>
      <p>{{ store.count() }} bookings</p>
      @if (store.loading()) {
        <p>Loading…</p>
      } @else {
        <ul>
          @for (reserva of store.reservas(); track reserva.id) {
            <li>{{ reserva.room }} · {{ reserva.date }} · {{ reserva.guests }} guests</li>
          }
        </ul>
      }
      <app-reserva-form />
    </section>
  `,
})
export class ReservasPageComponent {
  protected readonly store = inject(ReservasStore);

  constructor() {
    this.store.load();
  }
}
