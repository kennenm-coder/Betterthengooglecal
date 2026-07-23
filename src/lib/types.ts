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
  serviceDescription: string;
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
  [key: string]: any;
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
  // Actual DB field names from material list app
  unitType?: string;
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
  summaryQty?: number;
  description?: string;
  location?: string;
  species?: string;
  trimStyle?: string;
  casingProfile?: string;
  finishType?: string;
  finish?: string;
  jambDepthWhole?: string | number | null;
  jambDepthFrac?: number | null;
  jambSpecies?: string;
  jambMaterial?: string;
  specDescription?: string;
  deepEJ?: boolean;
  stool5_4?: boolean;
  nsprGlassS1?: string;
  nsprGlassS2?: string;
  nsprGrilleType?: string;
  nsprGrillePattern?: string;
  nsprScreenType?: string;
  nsprFrameType?: string;
  nsprSashOp?: string;
}

export type ViewMode = "day" | "week" | "list";

export interface ActionPerson {
  name: string;
  email: string;
}

export interface ActionLogEntry {
  id: string;
  timestamp: string;
  actionType: string;
  person: ActionPerson;
  notes: string;
  customerName: string;
  orderNumber: string;
  workOrderNumber: string;
  workOrderType: string;
  address: string;
}
