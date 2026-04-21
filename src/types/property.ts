export type PropertyStatus = "ready" | "dirty" | "in_progress" | "vacant";

export type PropertyInstructionCategory =
  | "access"
  | "trash"
  | "lawn"
  | "hot_tub"
  | "pool"
  | "parking"
  | "wifi"
  | "checkout"
  | "pets"
  | "other";

export interface PropertyInstruction {
  id: string;
  category: PropertyInstructionCategory;
  title: string;
  body: string;
  updatedAt: number;
}

export function isPropertyStatus(value: unknown): value is PropertyStatus {
  return (
    value === "ready" ||
    value === "dirty" ||
    value === "in_progress" ||
    value === "vacant"
  );
}

export interface PropertyRecord {
  _id: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  status: PropertyStatus;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  estimatedCleaningMinutes?: number;
  accessNotes?: string;
  keyLocation?: string;
  parkingNotes?: string;
  urgentNotes?: string;
  instructions?: PropertyInstruction[];
  tag?: string;
  primaryPhotoUrl?: string;
  photoUrls?: string[];
  assignedCleanerName?: string;
  nextCheckInAt?: number;
  nextCheckOutAt?: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PropertyFormValues {
  name: string;
  address: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  status: PropertyStatus;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  estimatedCleaningMinutes?: number;
  accessNotes?: string;
  keyLocation?: string;
  parkingNotes?: string;
  urgentNotes?: string;
  tag?: string;
  primaryPhotoUrl?: string;
  photoUrls?: string[];
  assignedCleanerName?: string;
}
