export interface Reserva {
  id: number;
  room: string;
  date: string;
  guests: number;
}

export interface CreateReserva {
  room: string;
  date: string;
  guests: number;
}
