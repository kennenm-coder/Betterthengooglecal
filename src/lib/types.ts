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
  materialJob?: MaterialJobData | null;
}

export interface PhoneEntry {
  label: string;
  number: string;
}

export interface MaterialJobData {
  id: string;
  job: {
    customerName: string;
    address: string;
    poNumber: string;
    techMeasurer: string;
    date: string;
    installNotes: string;
    leadPaint?: boolean;
    prefinishNotes: string;
    extraMaterials: any[];
    additionalMaterials: any[];
    universalFinish: string;
    vendorAssignments?: Record<string, any>;
    unitSummaryRows?: any[];
    globalMaterials?: any[];
    bayMaterials?: any[];
    pfWindowsNeeded?: boolean;
    pfWindowsList?: string;
  };
  units: MaterialUnit[];
  globalTrim: {
    species: string;
    trimStyle: string;
    casingProfile: string;
    finishType: string;
    stain: string;
    paint: string;
    jambDepthWhole: string;
    jambDepthFrac: number;
  };
  submitted: boolean;
  status: string;
  savedAt: string;
}

export interface MaterialUnit {
  label: string;
  type: string;
  qty: number;
  widthWhole: string;
  widthFrac: number;
  heightWhole: string;
  heightFrac: number;
  extColor: string;
  intColor: string;
  intFinish: string;
  grilles: boolean;
  tempered: boolean;
  isMisc?: boolean;
  approved?: boolean;
  // Fields from material list app (actual DB field names)
  exteriorColor?: string;
  interiorColor?: string;
  abbrev?: string;
  subType?: string;
  frame?: string;
  summaryAbbrev?: string;
  summaryExterior?: string;
  summaryInterior?: string;
  summarySubType?: string;
  summaryFrameType?: string;
  description?: string;
}

export type ViewMode = "day" | "week" | "list";
