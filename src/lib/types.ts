export interface WorkOrder {
  id: string;
  status: string;
  orderNumber: string;
  workOrderNumber: string;
  address: string;
  bookingDate: string | null;
  customerName: string;
  orderOwner: string;
  salesRep: string;
  techMeasure: string;
  installer: string;
  serviceRep: string;
  appointmentStatus: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  contactName: string;
  email: string;
  phones: PhoneEntry[];
  workOrderType: "Install" | "Service" | "Job Site Visit";
}

export interface PhoneEntry {
  label: string;
  number: string;
}

export type ViewMode = "day" | "week" | "list";
