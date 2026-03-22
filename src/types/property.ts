export type PropertyStatus = "ready" | "dirty" | "in_progress" | "vacant";

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
  tag?: string;
  primaryPhotoUrl?: string;
  photoUrls?: string[];
  assignedCleanerName?: string;
}
