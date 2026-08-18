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
  primaryResource: string;
  workOrderType: string;
  description: string;
  combinedRetailTotal: number;
  productCount: number;
  totalUnits: number;
  windows: number;
  patioDoors: number;
  doors: number;
  orderAlerts: string;
  accountName: string;
  latitude: number | null;
  longitude: number | null;
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

// --- Field Write-Ups (post-install work orders) ---

/** A single line of work requested in a write-up. */
export interface WriteUpLineItem {
  /** "preset" = picked from the preset chips, "custom" = free-typed. */
  kind: "preset" | "custom";
  label: string;
  notes?: string;
}

/** A field correction to a unit's product spec, shown as an overlay in the app. */
export interface SpecChange {
  unitLabel: string;
  /** Human-readable field name, e.g. "Exterior Color". */
  field: string;
  oldValue: string;
  newValue: string;
}

/** A trim / material line the field wants ordered, matching the install-
 *  instructions material list columns (Unit/Item/Color/Species/Lengths/Vendor). */
export interface WriteUpMaterialItem {
  /** catalog_items.id when picked from the catalog; empty for custom. */
  profileId?: string;
  item: string;
  color: string;
  species: string;
  qty: number;
  /** "PCS", "Rolls", "Tubes", etc. */
  unit: string;
  lengths: string;
  vendor: string;
  custom?: boolean;
}

/** A photo attached to a unit's write-up, stored in the writeup-photos bucket. */
export interface WriteUpPhoto {
  /** Storage path inside the writeup-photos bucket. */
  path: string;
  /** Human label, e.g. "Unit 101 photo 1 of 4". */
  name: string;
}

/** A product the field manually added because it was never programmed into the
 *  material job (e.g. an older job). Unit number is stored on the write-up's
 *  unitLabel; this holds the product spec. */
export interface WriteUpNewProduct {
  type: string; // "Double Hung", "Casement", ...
  size: string; // free text, e.g. "24 x 36"
  exteriorColor: string;
  interiorColor: string;
  intFinish: string;
  details: string;
  frame: string;
}

export type WriteUpStatus = "open" | "in_review" | "closed";

export interface FieldWorkOrder {
  id: string;
  orderNumber: string;
  workOrderNumber: string;
  jobId: string | null;
  customerName: string;
  address: string;
  /** "Unit 101" etc., or null for a whole-job write-up. */
  unitLabel: string | null;
  lineItems: WriteUpLineItem[];
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  photos: WriteUpPhoto[];
  /** Present when the field added a product that wasn't in the material job. */
  newProduct: WriteUpNewProduct | null;
  notes: string;
  status: WriteUpStatus;
  /** Phase 2 — photo support. */
  photoCount: number;
  photosUploaded: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type ViewMode = "day" | "week" | "list";

export interface Employee {
  firstName: string;
  lastName: string;
  department: string;
}

export interface TimeOffRequest {
  id: string;
  employee_name: string;
  department: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
}

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
