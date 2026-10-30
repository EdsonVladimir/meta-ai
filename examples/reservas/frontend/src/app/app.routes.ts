import { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";
import { ReservasPageComponent } from "./reservas/reservas-page.component";

export const routes: Routes = [
  { path: "", redirectTo: "reservas", pathMatch: "full" },
  { path: "reservas", component: ReservasPageComponent, canActivate: [authGuard] },
];
