/**
 * Hospitable CSV Parser
 * Parses Hospitable reservation export CSV and aggregates data by property and month.
 * 
 * Only extracts: Revenue, Booked Nights, Reservation Count
 * Costs are NOT imported - they come from the calculator's cost configuration.
 */

import Papa from 'papaparse';

// Raw row from Hospitable CSV
export interface HospitableReservationRow {
    checkin_date: string;
    checkout_date: string;
    property_id: string;
    property_name: string;
    status: string;
    nights: string;
    revenue: string;
    // Other columns exist but we don't need them
}

// Aggregated data per property per month
export interface HospitableMonthlyData {
    externalPropertyId: string;
    propertyName: string;
    month: number;
    year: number;
    totalRevenue: number;
    bookedNights: number;
    reservationCount: number;
}

// Parse result
export interface HospitableParseResult {
    success: boolean;
    data: HospitableMonthlyData[];
    errors: string[];
    summary: {
        totalReservations: number;
        propertiesFound: number;
        monthsFound: { month: number; year: number }[];
        dateRange: { start: string; end: string } | null;
    };
}

// Property mapping for save operation
export interface PropertyMapping {
    externalPropertyId: string;
    externalPropertyName: string;
    internalPropertyId: string | null; // null if not mapped
}

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse Hospitable CSV content and aggregate by property + month
 */
export function parseHospitableCSV(csvContent: string): HospitableParseResult {
    const errors: string[] = [];

    // Parse CSV with PapaParse
    const parseResult = Papa.parse<Record<string, string>>(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
        transform: (value) => value.trim(),
    });

    if (parseResult.errors.length > 0) {
        parseResult.errors.forEach(err => {
            errors.push(`Row ${err.row}: ${err.message}`);
        });
    }

    const rows = parseResult.data;

    if (rows.length === 0) {
        return {
            success: false,
            data: [],
            errors: ['No data rows found in CSV'],
            summary: { totalReservations: 0, propertiesFound: 0, monthsFound: [], dateRange: null },
        };
    }

    // Validate required columns
    const firstRow = rows[0];
    const requiredColumns = ['checkin_date', 'property_id', 'property_name', 'nights', 'revenue'];
    const missingColumns = requiredColumns.filter(col => !(col in firstRow));

    if (missingColumns.length > 0) {
        return {
            success: false,
            data: [],
            errors: [`Missing required columns: ${missingColumns.join(', ')}`],
            summary: { totalReservations: 0, propertiesFound: 0, monthsFound: [], dateRange: null },
        };
    }

    // Aggregate data by property_id + month/year
    const aggregatedMap = new Map<string, HospitableMonthlyData>();
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    let validReservations = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Skip cancelled reservations
        if (row.status && row.status.toLowerCase() === 'cancelled') {
            continue;
        }

        // Parse checkin date to get month/year
        const checkinDate = parseDate(row.checkin_date);
        if (!checkinDate) {
            errors.push(`Row ${i + 2}: Invalid checkin_date "${row.checkin_date}"`);
            continue;
        }

        // Track date range
        if (!minDate || checkinDate < minDate) minDate = checkinDate;
        if (!maxDate || checkinDate > maxDate) maxDate = checkinDate;

        const month = checkinDate.getMonth() + 1; // 1-12
        const year = checkinDate.getFullYear();
        const propertyId = row.property_id;
        const propertyName = row.property_name?.replace(/"/g, '') || 'Unknown Property';

        // Parse numeric values
        const nights = parseInt(row.nights, 10) || 0;
        const revenue = parseFloat(row.revenue) || 0;

        // Create aggregation key
        const key = `${propertyId}_${year}_${month}`;

        if (aggregatedMap.has(key)) {
            const existing = aggregatedMap.get(key)!;
            existing.totalRevenue += revenue;
            existing.bookedNights += nights;
            existing.reservationCount += 1;
        } else {
            aggregatedMap.set(key, {
                externalPropertyId: propertyId,
                propertyName: propertyName,
                month,
                year,
                totalRevenue: revenue,
                bookedNights: nights,
                reservationCount: 1,
            });
        }

        validReservations++;
    }

    const data = Array.from(aggregatedMap.values());

    // Get unique months
    const monthsSet = new Set<string>();
    data.forEach(d => monthsSet.add(`${d.year}-${d.month}`));
    const monthsFound = Array.from(monthsSet).map(key => {
        const [year, month] = key.split('-').map(Number);
        return { month, year };
    }).sort((a, b) => a.year - b.year || a.month - b.month);

    // Get unique properties
    const propertiesFound = new Set(data.map(d => d.externalPropertyId)).size;

    return {
        success: true,
        data,
        errors,
        summary: {
            totalReservations: validReservations,
            propertiesFound,
            monthsFound,
            dateRange: minDate && maxDate
                ? { start: formatDate(minDate), end: formatDate(maxDate) }
                : null,
        },
    };
}

/**
 * Parse a date string in YYYY-MM-DD format
 */
function parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Handle YYYY-MM-DD format
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [, year, month, day] = match;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    return null;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Get display label for a month (e.g., "Dec 2024")
 */
export function getMonthLabel(month: number, year: number): string {
    return `${MONTH_NAMES[month]} ${year}`;
}
