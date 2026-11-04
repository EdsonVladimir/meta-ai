export interface Booking {
  id: number;
  room: string;
  date: string;
  guests: number;
}

export interface CreateBooking {
  room: string;
  date: string;
  guests: number;
}
