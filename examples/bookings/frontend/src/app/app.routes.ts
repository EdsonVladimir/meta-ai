import { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";
import { BookingsPageComponent } from "./bookings/bookings-page.component";

export const routes: Routes = [
  { path: "", redirectTo: "bookings", pathMatch: "full" },
  { path: "bookings", component: BookingsPageComponent, canActivate: [authGuard] },
];
