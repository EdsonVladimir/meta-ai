import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../core/environment";
import { CreateReserva, Reserva } from "./reserva.model";

@Injectable({ providedIn: "root" })
export class ReservasService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl + 'reservas';

  list(): Observable<Reserva[]> {
    return this.http.get<Reserva[]>(this.baseUrl);
  }

  create(dto: CreateReserva): Observable<Reserva> {
    return this.http.post<Reserva>(this.baseUrl, dto);
  }
}
