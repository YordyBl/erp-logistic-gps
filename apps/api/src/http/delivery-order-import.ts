import ExcelJS from 'exceljs';

import type { Customer } from '../modules/customers/domain/entities/Customer.js';
import type { DeliveryOrderDto } from '../modules/delivery-orders/application/dto/DeliveryOrderDto.js';
import { createDeliveryOrderCommandSchema } from '../modules/delivery-orders/application/use-cases/create-delivery-order/CreateDeliveryOrderCommand.js';
import type { CreateDeliveryOrderUseCase } from '../modules/delivery-orders/application/use-cases/create-delivery-order/CreateDeliveryOrderUseCase.js';
import {
  DeliveryOrderInvariantError,
  DeliveryOrderValidationError,
} from '../modules/delivery-orders/domain/errors/DeliveryOrderError.js';

export const DELIVERY_ORDER_IMPORT_HEADERS = [
  'customerCode',
  'timeWindow',
  'publicCode',
  'recipientName',
  'recipientPhone',
  'addressLine',
  'district',
  'latitude',
  'longitude',
  'packageCode',
  'packageDescription',
  'packageWeightKg',
] as const;

// Coordinates are required: every order must be placed on the map.
const REQUIRED_HEADERS = DELIVERY_ORDER_IMPORT_HEADERS.filter(
  (header) => header !== 'packageWeightKg',
);
const MAX_IMPORT_ROWS = 5_000;
const MAX_IMPORT_COLUMNS = DELIVERY_ORDER_IMPORT_HEADERS.length;

export type DeliveryOrderImportFormat = 'csv' | 'xlsx';

export interface DeliveryOrderImportRow {
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
  readonly invalidCells: readonly string[];
}

export interface DeliveryOrderImportIssue {
  readonly rowNumber: number;
  readonly field: string;
  readonly message: string;
}

export interface RejectedDeliveryOrderImportGroup {
  readonly publicCode: string | null;
  readonly rowNumbers: readonly number[];
  readonly issues: readonly DeliveryOrderImportIssue[];
}

export interface DeliveryOrderImportResult {
  readonly importedOrders: readonly DeliveryOrderDto[];
  readonly rejectedOrders: readonly RejectedDeliveryOrderImportGroup[];
}

export class DeliveryOrderImportFileError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'DELIVERY_ORDER_IMPORT_INVALID_FILE'
      | 'DELIVERY_ORDER_IMPORT_INVALID_HEADERS'
      | 'DELIVERY_ORDER_IMPORT_TOO_MANY_ROWS'
      | 'DELIVERY_ORDER_IMPORT_TOO_MANY_COLUMNS',
  ) {
    super(message);
    this.name = 'DeliveryOrderImportFileError';
  }
}

export async function parseDeliveryOrderImportFile(
  buffer: Uint8Array,
  format: DeliveryOrderImportFormat,
): Promise<readonly DeliveryOrderImportRow[]> {
  const grid = format === 'csv'
    ? parseCsv(Buffer.from(buffer).toString('utf8'))
    : await parseXlsx(buffer);
  return validateHeadersAndRows(grid);
}

export async function createDeliveryOrderImportTemplate(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Orders');
  worksheet.addRow([...DELIVERY_ORDER_IMPORT_HEADERS]);
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns = DELIVERY_ORDER_IMPORT_HEADERS.map((header) => ({
    header,
    key: header,
    width: Math.max(header.length + 2, 18),
    style: { numFmt: '@' },
  }));
  worksheet.getColumn('latitude').numFmt = '0.000000';
  worksheet.getColumn('longitude').numFmt = '0.000000';
  worksheet.getColumn('packageWeightKg').numFmt = '0.00';
  return await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer;
}

export async function importDeliveryOrderRows(input: {
  readonly organizationId: string;
  readonly rows: readonly DeliveryOrderImportRow[];
  readonly customers: readonly Customer[];
  readonly createOrder: CreateDeliveryOrderUseCase;
}): Promise<DeliveryOrderImportResult> {
  const customerByCode = new Map(
    input.customers.map((customer) => [customer.publicCode.toUpperCase(), customer]),
  );
  const groups = groupRows(input.rows);
  const importedOrders: DeliveryOrderDto[] = [];
  const rejectedOrders: RejectedDeliveryOrderImportGroup[] = [];

  for (const group of groups) {
    const issues: DeliveryOrderImportIssue[] = [];
    const [first] = group.rows;
    if (first === undefined) continue;
    for (const row of group.rows) {
      for (const field of row.invalidCells) {
        issues.push({ rowNumber: row.rowNumber, field, message: 'Formula or complex cell values are not supported.' });
      }
      if (row !== first) {
        for (const field of ORDER_LEVEL_FIELDS) {
          if (normalizedCell(row.values[field]) !== normalizedCell(first.values[field])) {
            issues.push({
              rowNumber: row.rowNumber,
              field,
              message: 'Order-level values must match across all rows of the order.',
            });
          }
        }
      }
    }

    const customerCode = normalizedCell(first.values.customerCode).toUpperCase();
    const customer = customerByCode.get(customerCode);
    if (customer === undefined) {
      issues.push({ rowNumber: first.rowNumber, field: 'customerCode', message: 'Customer code was not found in this organization.' });
    } else if (customer.status !== 'active') {
      issues.push({ rowNumber: first.rowNumber, field: 'customerCode', message: 'Customer is inactive.' });
    }

    if (group.publicCode === null) {
      issues.push({ rowNumber: first.rowNumber, field: 'publicCode', message: 'Order public code is required to group package rows.' });
    }
    if (group.rows.length > 100) {
      issues.push({ rowNumber: first.rowNumber, field: 'packageCode', message: 'An order may contain at most 100 packages.' });
    }

    const packageCodes = new Set<string>();
    for (const row of group.rows) {
      const code = normalizedCell(row.values.packageCode).toUpperCase();
      if (code !== '' && packageCodes.has(code)) {
        issues.push({ rowNumber: row.rowNumber, field: 'packageCode', message: 'Package codes must be unique within an order.' });
      }
      if (code !== '') packageCodes.add(code);
    }

    const latitude = optionalNumber(first.values.latitude, 'latitude', first.rowNumber, issues);
    const longitude = optionalNumber(first.values.longitude, 'longitude', first.rowNumber, issues);
    const packages = group.rows.map((row) => {
      const weightKg = optionalNumber(row.values.packageWeightKg, 'packageWeightKg', row.rowNumber, issues);
      return {
        code: normalizedCell(row.values.packageCode),
        description: normalizedCell(row.values.packageDescription),
        ...(weightKg === undefined ? {} : { weightKg }),
      };
    });
    const payload = {
      customerId: customer?.id ?? '',
      timeWindow: normalizedCell(first.values.timeWindow).toUpperCase(),
      publicCode: normalizedCell(first.values.publicCode),
      recipient: {
        name: normalizedCell(first.values.recipientName),
        phone: normalizedCell(first.values.recipientPhone),
      },
      deliveryAddress: {
        addressLine: normalizedCell(first.values.addressLine),
        district: normalizedCell(first.values.district),
        ...(latitude === undefined ? {} : { latitude }),
        ...(longitude === undefined ? {} : { longitude }),
      },
      packages,
    };
    const parsed = createDeliveryOrderCommandSchema.omit({ organizationId: true }).safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.map(String);
        const packageIndex = path[0] === 'packages' ? Number(path[1]) : -1;
        issues.push({
          rowNumber: group.rows[packageIndex]?.rowNumber ?? first.rowNumber,
          field: path.join('.') || 'order',
          message: issue.message,
        });
      }
    }

    if (issues.length > 0) {
      rejectedOrders.push({
        publicCode: group.publicCode,
        rowNumbers: group.rows.map((row) => row.rowNumber),
        issues: deduplicateIssues(issues),
      });
      continue;
    }

    try {
      const result = await input.createOrder.execute({
        organizationId: input.organizationId,
        ...parsed.data,
      });
      importedOrders.push(result.order);
    } catch (error) {
      if (!(error instanceof DeliveryOrderInvariantError) &&
          !(error instanceof DeliveryOrderValidationError)) {
        throw error;
      }
      rejectedOrders.push({
        publicCode: group.publicCode,
        rowNumbers: group.rows.map((row) => row.rowNumber),
        issues: [{
          rowNumber: first.rowNumber,
          field: 'publicCode',
          message: 'Order could not be created because of a validation or conflict.',
        }],
      });
    }
  }

  return { importedOrders, rejectedOrders };
}

const ORDER_LEVEL_FIELDS = [
  'customerCode', 'timeWindow', 'publicCode', 'recipientName', 'recipientPhone',
  'addressLine', 'district', 'latitude', 'longitude',
] as const;

function groupRows(rows: readonly DeliveryOrderImportRow[]): { publicCode: string | null; rows: DeliveryOrderImportRow[] }[] {
  const groups = new Map<string, { publicCode: string | null; rows: DeliveryOrderImportRow[] }>();
  for (const row of rows) {
    const publicCode = normalizedCell(row.values.publicCode).toUpperCase();
    const key = publicCode === '' ? `invalid-row-${row.rowNumber}` : publicCode;
    const group = groups.get(key) ?? { publicCode: publicCode === '' ? null : publicCode, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function normalizedCell(value: string | undefined): string {
  return value?.trim() ?? '';
}

function optionalNumber(
  value: string | undefined,
  field: string,
  rowNumber: number,
  issues: DeliveryOrderImportIssue[],
): number | undefined {
  const normalized = normalizedCell(value);
  if (normalized === '') return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    issues.push({ rowNumber, field, message: 'Value must be a finite number.' });
    return Number.NaN;
  }
  return parsed;
}

function deduplicateIssues(issues: readonly DeliveryOrderImportIssue[]): DeliveryOrderImportIssue[] {
  const unique = new Map<string, DeliveryOrderImportIssue>();
  for (const issue of issues) unique.set(`${issue.rowNumber}:${issue.field}:${issue.message}`, issue);
  return [...unique.values()];
}

function parseCsv(text: string): readonly (readonly string[])[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let justClosedQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) continue;

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (justClosedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw invalidFile('CSV contains malformed quoting.');
    }
    if (character === '"') {
      if (field !== '') throw invalidFile('CSV contains malformed quoting.');
      inQuotes = true;
      continue;
    }
    if (character === ',') {
      record.push(field);
      field = '';
      justClosedQuote = false;
      continue;
    }
    if (character === '\r' || character === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      justClosedQuote = false;
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      if (records.length > MAX_IMPORT_ROWS + 1) {
        throw new DeliveryOrderImportFileError(
          `Import file exceeds ${MAX_IMPORT_ROWS} data rows.`,
          'DELIVERY_ORDER_IMPORT_TOO_MANY_ROWS',
        );
      }
      continue;
    }
    field += character;
  }

  if (inQuotes) throw invalidFile('CSV contains an unterminated quoted field.');
  if (field !== '' || record.length > 0 || input.length > 0 && !/[\r\n]$/.test(input)) {
    record.push(field);
    records.push(record);
  }
  if (records.length > MAX_IMPORT_ROWS + 1) {
    throw new DeliveryOrderImportFileError(
      `Import file exceeds ${MAX_IMPORT_ROWS} data rows.`,
      'DELIVERY_ORDER_IMPORT_TOO_MANY_ROWS',
    );
  }
  return records;
}

async function parseXlsx(buffer: Uint8Array): Promise<readonly (readonly unknown[])[]> {
  try {
    const workbook = new ExcelJS.Workbook();
    const workbookData = Uint8Array.from(buffer).buffer as ArrayBuffer;
    await workbook.xlsx.load(workbookData, { ignoreNodes: ['dataValidations'] });
    if (workbook.worksheets.length !== 1 || workbook.worksheets[0]?.name !== 'Orders') {
      throw invalidFile('Workbook must contain exactly one worksheet named Orders.');
    }
    const worksheet = workbook.worksheets[0];
    if (worksheet === undefined) throw invalidFile('Workbook has no worksheet.');
    if (worksheet.rowCount > MAX_IMPORT_ROWS + 1) {
      throw new DeliveryOrderImportFileError(
        `Import file exceeds ${MAX_IMPORT_ROWS} data rows.`,
        'DELIVERY_ORDER_IMPORT_TOO_MANY_ROWS',
      );
    }
    if (worksheet.columnCount > MAX_IMPORT_COLUMNS) {
      throw new DeliveryOrderImportFileError(
        'Workbook contains unsupported columns.',
        'DELIVERY_ORDER_IMPORT_TOO_MANY_COLUMNS',
      );
    }

    const records: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values: unknown[] = [];
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        values.push(row.getCell(column).value);
      }
      records.push(values);
    });
    return records;
  } catch (error) {
    if (error instanceof DeliveryOrderImportFileError) throw error;
    throw invalidFile('The XLSX workbook could not be read.');
  }
}

function validateHeadersAndRows(
  grid: readonly (readonly unknown[])[],
): readonly DeliveryOrderImportRow[] {
  const firstRow = grid[0];
  if (firstRow === undefined || firstRow.length === 0) {
    throw invalidHeaders('Import file has no header row.');
  }
  const headers = firstRow.map((value, index) => {
    const header = scalarToString(value);
    return index === 0 ? header.replace(/^\ufeff/, '').trim() : header.trim();
  });
  const uniqueHeaders = new Set(headers);
  const unknownHeaders = headers.filter(
    (header) => !DELIVERY_ORDER_IMPORT_HEADERS.includes(header as typeof DELIVERY_ORDER_IMPORT_HEADERS[number]),
  );
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !uniqueHeaders.has(header));
  if (
    unknownHeaders.length > 0 ||
    missingHeaders.length > 0 ||
    uniqueHeaders.size !== headers.length ||
    headers.some((header) => header === '')
  ) {
    throw invalidHeaders('Import file columns do not match the required template.');
  }

  return grid.slice(1).flatMap((record, index) => {
    if (record.every((value) => scalarToString(value).trim() === '')) return [];
    const rowNumber = index + 2;
    if (record.length > headers.length) {
      return [{
        rowNumber,
        values: {},
        invalidCells: ['The row contains values beyond the declared columns.'],
      }];
    }
    const values: Record<string, string> = {};
    const invalidCells: string[] = [];
    headers.forEach((header, column) => {
      const value = record[column];
      if (isScalar(value)) values[header] = value === null || value === undefined ? '' : String(value);
      else {
        values[header] = '';
        invalidCells.push(header);
      }
    });
    return [{ rowNumber, values, invalidCells }];
  });
}

function isScalar(value: unknown): value is string | number | boolean | Date | null | undefined {
  return value === null || value === undefined || typeof value === 'string' ||
    typeof value === 'number' || typeof value === 'boolean' || value instanceof Date;
}

function scalarToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return isScalar(value) ? String(value) : '';
}

function invalidFile(message: string): DeliveryOrderImportFileError {
  return new DeliveryOrderImportFileError(message, 'DELIVERY_ORDER_IMPORT_INVALID_FILE');
}

function invalidHeaders(message: string): DeliveryOrderImportFileError {
  return new DeliveryOrderImportFileError(message, 'DELIVERY_ORDER_IMPORT_INVALID_HEADERS');
}
