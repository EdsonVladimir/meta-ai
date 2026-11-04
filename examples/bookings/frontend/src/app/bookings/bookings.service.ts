import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../core/environment";
import { CreateBooking, Booking } from "./booking.model";

@Injectable({ providedIn: "root" })
export class BookingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl + 'bookings';

  list(): Observable<Booking[]> {
    return this.http.get<Booking[]>(this.baseUrl);
  }

  create(dto: CreateBooking): Observable<Booking> {
    return this.http.post<Booking>(this.baseUrl, dto);
  }
}
